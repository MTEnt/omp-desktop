use super::{frame_id, frame_type, parse_frame};
use crate::error::{AppError, AppResult};
use crate::settings;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, watch, Mutex};
use tokio::time::{timeout, Duration};

const MAX_RPC_FRAME_BYTES: usize = 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const PROCESS_EXIT_TIMEOUT: Duration = Duration::from_secs(2);

type PendingRequests = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;
type SharedChild = Arc<Mutex<Child>>;

#[derive(Debug)]
pub struct RpcClient {
    _child: SharedChild,
    _pid: Option<u32>,
    stdin: Arc<Mutex<ChildStdin>>,
    next_id: AtomicU64,
    pending: PendingRequests,
    ready: watch::Receiver<bool>,
    events: Option<mpsc::UnboundedReceiver<Value>>,
}

impl RpcClient {
    pub async fn spawn<P, I, S>(program: P, args: I) -> AppResult<Self>
    where
        P: AsRef<OsStr>,
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let program = program.as_ref();
        let mut command = Command::new(program);
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true);
        if let Some(path) = settings::runtime_command_path(Path::new(program)) {
            command.env("PATH", path);
        }
        let mut child = command.spawn()?;
        let pid = child.id();
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::from("RPC child stdin was not piped"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::from("RPC child stdout was not piped"))?;
        let child = Arc::new(Mutex::new(child));

        let pending: PendingRequests = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = Arc::clone(&pending);
        let reader_child = Arc::clone(&child);
        let (events_tx, events) = mpsc::unbounded_channel();
        let (ready_tx, ready) = watch::channel(false);

        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = Vec::with_capacity(8 * 1024);
            loop {
                match read_rpc_frame(&mut reader, &mut line).await {
                    Ok(true) => {}
                    Ok(false) => break,
                    Err(error) => {
                        log::warn!("failed reading OMP RPC stdout: {error}");
                        let _ = events_tx.send(json!({
                            "type": "rpc_frame_error",
                            "error": error.to_string(),
                        }));
                        break;
                    }
                }

                let text = match std::str::from_utf8(&line) {
                    Ok(text) => text,
                    Err(error) => {
                        log::warn!("ignored non-UTF-8 OMP RPC frame: {error}");
                        continue;
                    }
                };
                let frame = match parse_frame(text) {
                    Ok(frame) => frame,
                    Err(error) => {
                        log::warn!("ignored invalid OMP RPC frame: {error}");
                        continue;
                    }
                };

                if frame_type(&frame) == Some("response") {
                    let response_id = frame_id(&frame).map(str::to_owned);
                    let responder = match response_id {
                        Some(id) => reader_pending.lock().await.remove(&id),
                        None => None,
                    };
                    if let Some(responder) = responder {
                        let _ = responder.send(frame);
                        continue;
                    }
                }

                if frame_type(&frame) == Some("ready") {
                    let _ = ready_tx.send(true);
                }
                let _ = events_tx.send(frame);
            }

            reader_pending.lock().await.clear();
            terminate_child(&reader_child).await;
        });

        Ok(Self {
            _child: child,
            _pid: pid,
            stdin: Arc::new(Mutex::new(stdin)),
            next_id: AtomicU64::new(0),
            pending,
            ready,
            events: Some(events),
        })
    }

    pub fn take_events(&mut self) -> Option<mpsc::UnboundedReceiver<Value>> {
        self.events.take()
    }

    pub async fn wait_ready(&self, wait_timeout: Duration) -> AppResult<()> {
        let mut ready = self.ready.clone();
        if *ready.borrow() {
            return Ok(());
        }

        timeout(wait_timeout, async {
            loop {
                ready
                    .changed()
                    .await
                    .map_err(|_| AppError::from("OMP RPC exited before ready"))?;
                if *ready.borrow() {
                    return Ok(());
                }
            }
        })
        .await
        .map_err(|_| AppError::from("timed out waiting for OMP RPC ready"))?
    }

    pub async fn request(&self, command_type: &str, params: Value) -> AppResult<Value> {
        let id = format!("req_{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let mut command = match params {
            Value::Object(command) => command,
            _ => return Err(AppError::from("RPC request params must be a JSON object")),
        };
        insert_command_metadata(&mut command, &id, command_type);
        let line = encode_rpc_frame(&Value::Object(command))?;

        let (response_tx, response_rx) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), response_tx);

        let write_result = async {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(&line).await?;
            stdin.flush().await
        }
        .await;
        if let Err(error) = write_result {
            self.pending.lock().await.remove(&id);
            return Err(error.into());
        }

        match timeout(REQUEST_TIMEOUT, response_rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => {
                self.pending.lock().await.remove(&id);
                Err(AppError::from(format!(
                    "OMP RPC closed before responding to {id}"
                )))
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(AppError::from(format!(
                    "timed out waiting for OMP RPC response to {id}"
                )))
            }
        }
    }

    pub async fn send_frame(&self, frame: Value) -> AppResult<()> {
        let line = encode_rpc_frame(&frame)?;
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(&line).await?;
        stdin.flush().await?;
        Ok(())
    }
}

impl Drop for RpcClient {
    fn drop(&mut self) {
        if let Ok(mut child) = self._child.try_lock() {
            let _ = child.start_kill();
            return;
        }
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let child = Arc::clone(&self._child);
            runtime.spawn(async move {
                terminate_child(&child).await;
            });
        }
    }
}

fn encode_rpc_frame(frame: &Value) -> AppResult<Vec<u8>> {
    let mut line = serde_json::to_vec(frame)?;
    line.push(b'\n');
    if line.len() > MAX_RPC_FRAME_BYTES {
        return Err(AppError::from(format!(
            "OMP RPC frame exceeded the {MAX_RPC_FRAME_BYTES}-byte transport limit"
        )));
    }
    Ok(line)
}

async fn read_rpc_frame<R>(reader: &mut R, frame: &mut Vec<u8>) -> AppResult<bool>
where
    R: AsyncBufRead + Unpin,
{
    frame.clear();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(!frame.is_empty());
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |index| index + 1);
        if frame.len().saturating_add(consumed) > MAX_RPC_FRAME_BYTES {
            return Err(AppError::from(format!(
                "OMP RPC frame exceeded the {MAX_RPC_FRAME_BYTES}-byte transport limit"
            )));
        }
        frame.extend_from_slice(&available[..consumed]);
        reader.consume(consumed);
        if newline.is_some() {
            frame.pop();
            if frame.last() == Some(&b'\r') {
                frame.pop();
            }
            return Ok(true);
        }
    }
}

async fn terminate_child(child: &SharedChild) {
    let mut child = child.lock().await;
    match child.try_wait() {
        Ok(Some(_)) => return,
        Ok(None) => {}
        Err(error) => {
            log::warn!("failed checking OMP RPC child status: {error}");
        }
    }
    if let Err(error) = child.start_kill() {
        log::warn!("failed terminating OMP RPC child: {error}");
        return;
    }
    if timeout(PROCESS_EXIT_TIMEOUT, child.wait()).await.is_err() {
        log::warn!("timed out reaping OMP RPC child");
    }
}

fn insert_command_metadata(command: &mut Map<String, Value>, id: &str, command_type: &str) {
    command.insert("id".into(), Value::String(id.into()));
    command.insert("type".into(), Value::String(command_type.into()));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rpc::{frame_id, frame_type};
    use serde_json::json;
    #[cfg(unix)]
    use tokio::time::sleep;
    use tokio::time::{timeout, Duration};

    const MOCK_NODE: &str = r#"
const readline = require("readline");
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
send({ type: "ready" });
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "extension_ui_response") {
    send({ type: "observed_extension_ui_response", frame: message });
    return;
  }
  if (message.message === "echo-event") {
    send({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hi" }
    });
  }
  if (message.id) {
    const respond = () => send({
      id: message.id,
      type: "response",
      command: message.type,
      success: true
    });
    if (message.message === "slow") {
      setTimeout(respond, 30);
    } else {
      respond();
    }
  }
});
"#;

    #[cfg(unix)]
    const STUBBORN_NODE: &str = r#"
process.stdout.write('{"type":"ready"}\n');
process.stdin.resume();
setInterval(() => {}, 1000);
"#;

    #[cfg(unix)]
    const OVERSIZED_NODE: &str = r#"
process.stdout.write('{"type":"ready"}\n');
process.stdout.write(JSON.stringify({
  type: "message_update",
  payload: "x".repeat(1024 * 1024)
}) + "\n");
process.stdin.resume();
setInterval(() => {}, 1000);
"#;

    async fn spawn_mock() -> RpcClient {
        RpcClient::spawn("node", ["-e", MOCK_NODE]).await.unwrap()
    }

    #[cfg(unix)]
    async fn process_exited(pid: u32) {
        let pid = pid.to_string();
        loop {
            let status = Command::new("kill")
                .args(["-0", &pid])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .unwrap();
            if !status.success() {
                return;
            }
            sleep(Duration::from_millis(10)).await;
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_client_terminates_child() {
        let client = RpcClient::spawn("node", ["-e", STUBBORN_NODE])
            .await
            .unwrap();
        client.wait_ready(Duration::from_secs(2)).await.unwrap();
        let pid = client._pid.unwrap();

        drop(client);

        let exited = timeout(Duration::from_millis(500), process_exited(pid))
            .await
            .is_ok();
        if !exited {
            let _ = Command::new("kill")
                .args(["-9", &pid.to_string()])
                .status()
                .await;
        }
        assert!(exited, "RPC child {pid} survived RpcClient drop");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn oversized_frame_is_reported_and_child_is_reaped() {
        let mut client = RpcClient::spawn("node", ["-e", OVERSIZED_NODE])
            .await
            .unwrap();
        client.wait_ready(Duration::from_secs(2)).await.unwrap();
        let pid = client._pid.unwrap();
        let mut events = client.take_events().expect("event receiver");

        let frame = timeout(Duration::from_secs(2), async {
            loop {
                let frame = events.recv().await.expect("event channel closed");
                if frame_type(&frame) == Some("rpc_frame_error") {
                    break frame;
                }
            }
        })
        .await
        .expect("oversized frame was not rejected");

        assert_eq!(
            frame["error"],
            "OMP RPC frame exceeded the 1048576-byte transport limit"
        );
        assert!(timeout(Duration::from_secs(2), events.recv())
            .await
            .expect("event channel did not close")
            .is_none());
        assert!(
            timeout(Duration::from_secs(2), process_exited(pid))
                .await
                .is_ok(),
            "RPC child {pid} survived output reader failure"
        );
    }

    #[tokio::test]
    async fn rejects_oversized_outbound_frames() {
        let client = spawn_mock().await;
        client.wait_ready(Duration::from_secs(2)).await.unwrap();

        let error = client
            .send_frame(json!({
                "type": "extension_ui_response",
                "id": "too-large",
                "value": "x".repeat(1024 * 1024),
            }))
            .await
            .expect_err("oversized outbound frame should be rejected");

        assert!(error
            .to_string()
            .contains("OMP RPC frame exceeded the 1048576-byte transport limit"));
    }

    #[tokio::test]
    async fn wait_ready_succeeds() {
        let client = spawn_mock().await;

        client.wait_ready(Duration::from_secs(2)).await.unwrap();
    }

    #[tokio::test]
    async fn request_correlates_responses_by_id() {
        let client = spawn_mock().await;
        client.wait_ready(Duration::from_secs(2)).await.unwrap();

        let (slow, fast) = tokio::join!(
            client.request("prompt", json!({ "message": "slow" })),
            client.request("prompt", json!({ "message": "fast" })),
        );

        let slow = slow.unwrap();
        let fast = fast.unwrap();
        assert_eq!(frame_id(&slow), Some("req_0"));
        assert_eq!(frame_id(&fast), Some("req_1"));
        assert_eq!(frame_type(&slow), Some("response"));
        assert_eq!(frame_type(&fast), Some("response"));
    }

    #[tokio::test]
    async fn sends_extension_ui_responses_without_request_correlation() {
        let mut client = spawn_mock().await;
        client.wait_ready(Duration::from_secs(2)).await.unwrap();
        let mut events = client.take_events().expect("event receiver");

        client
            .send_frame(json!({
                "type": "extension_ui_response",
                "id": "approval-1",
                "value": "Approve",
            }))
            .await
            .unwrap();

        let observed = timeout(Duration::from_secs(2), async {
            loop {
                let frame = events.recv().await.expect("event channel closed");
                if frame_type(&frame) == Some("observed_extension_ui_response") {
                    break frame;
                }
            }
        })
        .await
        .expect("extension UI response timed out");
        assert_eq!(observed["frame"]["id"], "approval-1");
        assert_eq!(observed["frame"]["value"], "Approve");
    }

    #[tokio::test]
    async fn forwards_non_response_frames_as_events() {
        let mut client = spawn_mock().await;
        client.wait_ready(Duration::from_secs(2)).await.unwrap();
        let mut events = client.take_events().expect("event receiver");
        assert!(client.take_events().is_none());
        client
            .request("prompt", json!({ "message": "echo-event" }))
            .await
            .unwrap();

        let event = timeout(Duration::from_secs(2), async {
            loop {
                let frame = events.recv().await.expect("event channel closed");
                if frame_type(&frame) == Some("message_update") {
                    break frame;
                }
            }
        })
        .await
        .expect("message_update event timed out");

        assert_eq!(event["assistantMessageEvent"]["delta"], "hi");
    }
}
