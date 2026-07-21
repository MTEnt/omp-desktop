use crate::error::{AppError, AppResult};
use crate::memory;
use crate::rpc::RpcClient;
use crate::settings::{self, AppSettings, ApprovalMode};
use crate::ssh::{self, RemoteSessionInfo, RemoteTarget};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::Duration;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub cwd: PathBuf,
    pub profile: Option<String>,
    pub status: SessionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<RemoteSessionInfo>,
}

impl SessionInfo {
    pub fn project_key(&self) -> String {
        let Some(remote) = &self.remote else {
            return memory::project_key(&self.cwd);
        };
        let remote_root = remote.remote_cwd.trim();
        let remote_root = if remote_root.is_empty() {
            "~"
        } else {
            remote_root
        };
        let separator = if remote_root.starts_with('/') {
            ""
        } else {
            "/"
        };
        format!("ssh://{}{separator}{remote_root}", remote.host_name)
    }

    pub fn project_label(&self) -> String {
        let Some(remote) = &self.remote else {
            return memory::project_label(&self.cwd);
        };
        let folder = remote
            .remote_cwd
            .trim_end_matches('/')
            .rsplit('/')
            .find(|part| !part.is_empty())
            .unwrap_or("~");
        format!("{}:{folder}", remote.host_name)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Starting,
    Ready,
    Error,
    Exited,
}

#[derive(Debug, Default)]
struct SessionArtifacts {
    paths: Vec<PathBuf>,
}

impl SessionArtifacts {
    fn track(&mut self, path: PathBuf) {
        self.paths.push(path);
    }
}

impl Drop for SessionArtifacts {
    fn drop(&mut self) {
        for path in self.paths.iter().rev() {
            if path.is_dir() {
                let _ = fs::remove_dir_all(path);
            } else {
                let _ = fs::remove_file(path);
            }
        }
    }
}

#[derive(Debug)]
pub struct SessionTab {
    pub info: SessionInfo,
    pub rpc: RpcClient,
    _artifacts: SessionArtifacts,
}

#[derive(Debug)]
pub struct SessionManager {
    tabs: HashMap<String, SessionTab>,
    settings: AppSettings,
    omp_bin: PathBuf,
}

impl SessionManager {
    pub fn new(settings: AppSettings, omp_bin: PathBuf) -> Self {
        Self {
            tabs: HashMap::new(),
            settings,
            omp_bin,
        }
    }

    pub async fn create_session(
        &mut self,
        cwd: PathBuf,
        resume: Option<String>,
        remote: Option<RemoteTarget>,
    ) -> AppResult<SessionInfo> {
        settings::require_supported_omp_runtime(&self.omp_bin).await?;
        let id = Uuid::new_v4().to_string();
        let mut session_cwd = cwd;
        let mut artifacts = SessionArtifacts::default();
        let mut remote_info = None;
        if let Some(target) = remote.as_ref() {
            let workspace = ssh::prepare_remote_workspace(&id, target)?;
            artifacts.track(workspace.clone());
            session_cwd = workspace;
            remote_info = Some(ssh::to_remote_session_info(
                target,
                Some(target.remote_cwd.clone()),
            ));
        }
        let overlay_path = std::env::temp_dir().join(format!("omp-desktop-memory-{id}.yml"));
        artifacts.track(overlay_path.clone());
        memory::write_mnemopi_overlay(&overlay_path)?;
        let args = build_omp_args(
            &session_cwd,
            &self.settings,
            resume.as_deref(),
            Some(&overlay_path),
        );
        let rpc = RpcClient::spawn(&self.omp_bin, &args).await?;
        rpc.wait_ready(Duration::from_secs(30)).await?;

        let title = if let Some(remote) = &remote_info {
            remote.label.clone()
        } else {
            session_cwd
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("session")
                .into()
        };

        let info = SessionInfo {
            id: id.clone(),
            title,
            cwd: session_cwd,
            profile: self.settings.default_profile.clone(),
            status: SessionStatus::Ready,
            remote: remote_info,
        };
        self.tabs.insert(
            id,
            SessionTab {
                info: info.clone(),
                rpc,
                _artifacts: artifacts,
            },
        );
        Ok(info)
    }

    pub async fn prompt(
        &mut self,
        session_id: &str,
        message: String,
        streaming_behavior: Option<String>,
    ) -> AppResult<Value> {
        let mut params = Map::new();
        params.insert("message".into(), Value::String(message));
        if let Some(streaming_behavior) = streaming_behavior {
            params.insert(
                "streamingBehavior".into(),
                Value::String(streaming_behavior),
            );
        }
        self.rpc_command(session_id, "prompt", Value::Object(params))
            .await
    }

    pub async fn abort(&mut self, session_id: &str) -> AppResult<Value> {
        self.rpc_command(session_id, "abort", Value::Object(Map::new()))
            .await
    }

    pub async fn get_state(&mut self, session_id: &str) -> AppResult<Value> {
        self.rpc_command(session_id, "get_state", Value::Object(Map::new()))
            .await
    }

    pub fn remote_target(&self, session_id: &str) -> Option<RemoteTarget> {
        self.tabs
            .get(session_id)
            .and_then(|tab| tab.info.remote.as_ref())
            .map(|remote| remote.to_target())
    }

    pub async fn rpc_command(
        &mut self,
        session_id: &str,
        command: &str,
        params: Value,
    ) -> AppResult<Value> {
        self.get_mut(session_id)?.rpc.request(command, params).await
    }
    pub async fn respond_extension_ui(
        &mut self,
        session_id: &str,
        request_id: &str,
        response: Value,
    ) -> AppResult<()> {
        let mut frame = response
            .as_object()
            .cloned()
            .ok_or_else(|| AppError::from("extension UI response must be a JSON object"))?;
        frame.insert("type".into(), Value::String("extension_ui_response".into()));
        frame.insert("id".into(), Value::String(request_id.into()));
        self.get_mut(session_id)?
            .rpc
            .send_frame(Value::Object(frame))
            .await
    }

    pub async fn close(&mut self, session_id: &str) -> AppResult<()> {
        self.tabs
            .remove(session_id)
            .map(drop)
            .ok_or_else(|| Self::not_found(session_id))
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        self.tabs.values().map(|tab| tab.info.clone()).collect()
    }

    pub fn mark_exited(&mut self, session_id: &str) {
        if let Some(tab) = self.tabs.get_mut(session_id) {
            tab.info.status = SessionStatus::Exited;
        }
    }

    pub fn take_events(&mut self, session_id: &str) -> Option<UnboundedReceiver<Value>> {
        self.tabs
            .get_mut(session_id)
            .and_then(|tab| tab.rpc.take_events())
    }

    pub fn set_settings(&mut self, settings: AppSettings, omp_bin: PathBuf) {
        self.settings = settings;
        self.omp_bin = omp_bin;
    }

    fn get_mut(&mut self, session_id: &str) -> AppResult<&mut SessionTab> {
        self.tabs
            .get_mut(session_id)
            .ok_or_else(|| Self::not_found(session_id))
    }

    fn not_found(session_id: &str) -> AppError {
        AppError::Msg(format!("session not found: {session_id}"))
    }
}

pub fn build_omp_args(
    cwd: &Path,
    settings: &AppSettings,
    resume: Option<&str>,
    memory_overlay: Option<&Path>,
) -> Vec<String> {
    let mut args = vec![
        "--mode".into(),
        "rpc".into(),
        "--cwd".into(),
        cwd.display().to_string(),
        "--approval-mode".into(),
        settings.approval_mode.as_cli_value().into(),
    ];
    if let Some(overlay) = memory_overlay {
        args.extend(["--config".into(), overlay.display().to_string()]);
    }
    if settings.approval_mode == ApprovalMode::Yolo {
        args.push("--auto-approve".into());
    }
    if let Some(profile) = &settings.default_profile {
        args.extend(["--profile".into(), profile.clone()]);
    }
    if let Some(model) = &settings.default_model {
        args.extend(["--model".into(), model.clone()]);
    }
    if let Some(thinking) = &settings.default_thinking {
        args.extend(["--thinking".into(), thinking.clone()]);
    }
    if let Some(resume) = resume {
        args.extend(["--resume".into(), resume.into()]);
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[cfg(unix)]
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    #[cfg(unix)]
    use std::time::{SystemTime, UNIX_EPOCH};
    #[cfg(unix)]
    use tokio::time::{timeout, Duration};

    #[test]
    fn safe_default_does_not_auto_approve_commands() {
        let settings = AppSettings::default();
        let args = build_omp_args(Path::new("/tmp/proj"), &settings, None, None);

        assert!(args.windows(2).any(|args| args == ["--mode", "rpc"]));
        assert!(args
            .windows(2)
            .any(|args| args == ["--approval-mode", "write"]));
        assert!(!args.iter().any(|arg| arg == "--auto-approve"));
    }

    #[test]
    fn optional_args_follow_settings_and_resume() {
        let settings = AppSettings {
            approval_mode: ApprovalMode::Write,
            default_profile: Some("work".into()),
            default_model: Some("claude-opus".into()),
            default_thinking: Some("high".into()),
            ..AppSettings::default()
        };

        let args = build_omp_args(Path::new("/tmp/proj"), &settings, Some("session-1"), None);

        assert_eq!(
            args,
            [
                "--mode",
                "rpc",
                "--cwd",
                "/tmp/proj",
                "--approval-mode",
                "write",
                "--profile",
                "work",
                "--model",
                "claude-opus",
                "--thinking",
                "high",
                "--resume",
                "session-1",
            ]
        );
    }

    #[test]
    fn session_types_serialize_as_camel_case() {
        let info = SessionInfo {
            id: "session-1".into(),
            title: "project".into(),
            cwd: PathBuf::from("/tmp/project"),
            profile: None,
            status: SessionStatus::Ready,
            remote: None,
        };

        assert_eq!(
            serde_json::to_value(info).unwrap(),
            json!({
                "id": "session-1",
                "title": "project",
                "cwd": "/tmp/project",
                "profile": null,
                "status": "ready",
            })
        );
    }

    #[test]
    fn remote_project_identity_ignores_ephemeral_workspace() {
        let info = SessionInfo {
            id: "session-remote".into(),
            title: "production".into(),
            cwd: PathBuf::from("/tmp/omp-desktop/remote-sessions/random"),
            profile: None,
            status: SessionStatus::Ready,
            remote: Some(RemoteSessionInfo {
                host_name: "production".into(),
                host: "example.com".into(),
                user: Some("deploy".into()),
                port: Some(22),
                key_path: None,
                remote_cwd: "/srv/apps/website".into(),
                label: "deploy@example.com:/srv/apps/website".into(),
            }),
        };

        assert_eq!(info.project_key(), "ssh://production/srv/apps/website");
        assert_eq!(info.project_label(), "production:website");
    }

    #[cfg(unix)]
    fn temp_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("omp-desktop-session-{unique}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[cfg(unix)]
    fn mock_omp(root: &Path) -> PathBuf {
        let path = root.join("mock-omp");
        fs::write(
            &path,
            r#"#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("omp/17.0.6\n");
  process.exit(0);
}
const readline = require("readline");
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
send({ type: "ready", argv: process.argv.slice(2) });
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const command = JSON.parse(line);
  send({
    id: command.id,
    type: "response",
    command: command.type,
    success: true,
    data: command
  });
});
"#,
        )
        .unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[cfg(unix)]
    fn outdated_mock_omp(root: &Path) -> PathBuf {
        let path = root.join("outdated-omp");
        fs::write(
            &path,
            r#"#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("omp/17.0.5\n");
  process.exit(0);
}
process.stdout.write('{"type":"ready"}\n');
process.stdin.resume();
"#,
        )
        .unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn manager_supervises_session_rpc() {
        let root = temp_dir();
        let cwd = root.join("my-project");
        fs::create_dir(&cwd).unwrap();
        let omp_bin = mock_omp(&root);
        let mut manager = SessionManager::new(AppSettings::default(), omp_bin.clone());
        manager.set_settings(
            AppSettings {
                default_profile: Some("work".into()),
                ..AppSettings::default()
            },
            omp_bin,
        );

        let info = manager
            .create_session(cwd.clone(), Some("previous-session".into()), None)
            .await
            .unwrap();

        assert_eq!(info.title, "my-project");
        assert_eq!(info.cwd, cwd);
        assert_eq!(info.profile.as_deref(), Some("work"));
        assert_eq!(info.status, SessionStatus::Ready);
        assert_eq!(manager.list(), vec![info.clone()]);

        let mut events = manager.take_events(&info.id).expect("event receiver");
        assert!(manager.take_events(&info.id).is_none());
        let ready = timeout(Duration::from_secs(2), events.recv())
            .await
            .unwrap()
            .unwrap();
        let argv = ready["argv"].as_array().unwrap();
        assert!(argv.windows(2).any(|args| args == ["--profile", "work"]));
        assert!(argv
            .windows(2)
            .any(|args| args == ["--resume", "previous-session"]));

        let prompt = manager
            .prompt(&info.id, "hello".into(), Some("followUp".into()))
            .await
            .unwrap();
        assert_eq!(prompt["command"], "prompt");
        assert_eq!(prompt["data"]["message"], "hello");
        assert_eq!(prompt["data"]["streamingBehavior"], "followUp");

        let abort = manager.abort(&info.id).await.unwrap();
        assert_eq!(abort["command"], "abort");
        let state = manager.get_state(&info.id).await.unwrap();
        assert_eq!(state["command"], "get_state");
        let generic = manager
            .rpc_command(&info.id, "set_model", json!({ "model": "opus" }))
            .await
            .unwrap();
        manager.mark_exited(&info.id);
        assert_eq!(
            manager
                .list()
                .into_iter()
                .find(|session| session.id == info.id)
                .map(|session| session.status),
            Some(SessionStatus::Exited),
        );

        assert_eq!(generic["command"], "set_model");
        assert_eq!(generic["data"]["model"], "opus");

        let overlay = std::env::temp_dir().join(format!("omp-desktop-memory-{}.yml", info.id));
        assert!(overlay.is_file());

        manager.close(&info.id).await.unwrap();
        assert!(!overlay.exists());
        assert!(manager.list().is_empty());
        assert!(manager.take_events(&info.id).is_none());
        assert!(manager.get_state(&info.id).await.is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn manager_rejects_outdated_omp_runtime() {
        let root = temp_dir();
        let cwd = root.join("my-project");
        fs::create_dir(&cwd).unwrap();
        let omp_bin = outdated_mock_omp(&root);
        let mut manager = SessionManager::new(AppSettings::default(), omp_bin);

        let error = manager
            .create_session(cwd, None, None)
            .await
            .expect_err("OMP 17.0.5 should be rejected");

        assert!(error
            .to_string()
            .contains("OMP Desktop requires OMP 17.0.6 or newer"));
        assert!(manager.list().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
