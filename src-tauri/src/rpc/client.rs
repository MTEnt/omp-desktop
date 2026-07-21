use super::{frame_id, frame_type, parse_frame};
use crate::error::{AppError, AppResult};
use crate::settings;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, watch, Mutex};
use tokio::time::{timeout, Duration};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

type PendingRequests = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

#[derive(Debug)]
pub struct RpcClient {
    _child: Child,
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
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::from("RPC child stdin was not piped"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::from("RPC child stdout was not piped"))?;

        let pending: PendingRequests = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = Arc::clone(&pending);
        let (events_tx, events) = mpsc::unbounded_channel();
        let (ready_tx, ready) = watch::channel(false);

        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                let line = match lines.next_line().await {
                    Ok(Some(line)) => line,
                    Ok(None) => break,
                    Err(error) => {
                        log::warn!("failed reading OMP RPC stdout: {error}");
                        break;
                    }
                };

                let frame = match parse_frame(&line) {
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
        });

        Ok(Self {
            _child: child,
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

        let mut line = serde_json::to_vec(&Value::Object(command))?;
        line.push(b'\n');

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
        let mut line = serde_json::to_vec(&frame)?;
        line.push(b'\n');
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(&line).await?;
        stdin.flush().await?;
        Ok(())
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
        let pid = client._child.id().unwrap();

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
