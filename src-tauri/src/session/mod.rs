use crate::error::{AppError, AppResult};
use crate::rpc::RpcClient;
use crate::settings::{AppSettings, ApprovalMode};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Starting,
    Ready,
    Error,
    Exited,
}

#[derive(Debug)]
pub struct SessionTab {
    pub info: SessionInfo,
    pub rpc: RpcClient,
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
    ) -> AppResult<SessionInfo> {
        let id = Uuid::new_v4().to_string();
        let args = build_omp_args(&cwd, &self.settings, resume.as_deref());
        let rpc = RpcClient::spawn(&self.omp_bin, &args).await?;
        rpc.wait_ready(Duration::from_secs(30)).await?;

        let info = SessionInfo {
            id: id.clone(),
            title: cwd
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("session")
                .into(),
            cwd,
            profile: self.settings.default_profile.clone(),
            status: SessionStatus::Ready,
        };
        self.tabs.insert(
            id,
            SessionTab {
                info: info.clone(),
                rpc,
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

    pub async fn rpc_command(
        &mut self,
        session_id: &str,
        command: &str,
        params: Value,
    ) -> AppResult<Value> {
        self.get_mut(session_id)?.rpc.request(command, params).await
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

    pub fn take_events(&mut self, session_id: &str) -> Option<UnboundedReceiver<Value>> {
        self.tabs
            .get_mut(session_id)
            .and_then(|tab| tab.rpc.take_events())
    }

    pub fn set_settings(&mut self, settings: AppSettings) {
        self.settings = settings;
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

pub fn build_omp_args(cwd: &Path, settings: &AppSettings, resume: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "--mode".into(),
        "rpc".into(),
        "--cwd".into(),
        cwd.display().to_string(),
        "--approval-mode".into(),
        settings.approval_mode.as_cli_value().into(),
    ];
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
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::time::{timeout, Duration};

    #[test]
    fn yolo_args_include_auto_approve() {
        let settings = AppSettings::default();
        let args = build_omp_args(Path::new("/tmp/proj"), &settings, None);

        assert!(args.windows(2).any(|args| args == ["--mode", "rpc"]));
        assert!(args
            .windows(2)
            .any(|args| args == ["--approval-mode", "yolo"]));
        assert!(args.iter().any(|arg| arg == "--auto-approve"));
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

        let args = build_omp_args(Path::new("/tmp/proj"), &settings, Some("session-1"));

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
    #[tokio::test]
    async fn manager_supervises_session_rpc() {
        let root = temp_dir();
        let cwd = root.join("my-project");
        fs::create_dir(&cwd).unwrap();
        let mut manager = SessionManager::new(AppSettings::default(), mock_omp(&root));
        let mut settings = AppSettings::default();
        settings.default_profile = Some("work".into());
        manager.set_settings(settings);

        let info = manager
            .create_session(cwd.clone(), Some("previous-session".into()))
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
        assert_eq!(generic["command"], "set_model");
        assert_eq!(generic["data"]["model"], "opus");

        manager.close(&info.id).await.unwrap();
        assert!(manager.list().is_empty());
        assert!(manager.take_events(&info.id).is_none());
        assert!(manager.get_state(&info.id).await.is_err());

        fs::remove_dir_all(root).unwrap();
    }
}
