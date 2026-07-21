use crate::error::AppError;
use crate::memory::{self, JobCard, MemoryStore, PersistentAgent, RoleMemoryNote, RoleScratchpad};
use crate::omp_config::{self, AvailableModel, ModelRolesSnapshot};
use crate::pty::{PtyManager, PtyOutput};
use crate::session::{SessionInfo, SessionManager};
use crate::session_history;
use crate::settings::{self, AppSettings};
use crate::ssh::{self, RemoteDirListing, RemoteTarget, SshHostInfo, SshProbeResult, SshRecent};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

pub struct AppState {
    pub sessions: Mutex<SessionManager>,
    pub ptys: Mutex<PtyManager>,
    pub settings: Mutex<AppSettings>,
    pub memory: Mutex<MemoryStore>,
    pub config_dir: PathBuf,
}

pub fn initialize_app_state() -> Result<AppState, AppError> {
    let config_dir = settings::default_config_dir()?;
    let app_settings = settings::load_settings(&config_dir)?;
    let omp_binary = omp_binary_or_fallback(&app_settings);
    let sessions = SessionManager::new(app_settings.clone(), omp_binary);
    let memory_path = memory::default_memory_db_path()?;
    let memory = MemoryStore::open(memory_path)?;

    Ok(AppState {
        sessions: Mutex::new(sessions),
        ptys: Mutex::new(PtyManager::default()),
        settings: Mutex::new(app_settings),
        memory: Mutex::new(memory),
        config_dir,
    })
}

fn omp_binary_or_fallback(settings: &AppSettings) -> PathBuf {
    settings::resolve_omp_binary(settings).unwrap_or_else(|error| {
        log::warn!("{error}; using `omp` as the deferred executable path");
        PathBuf::from("omp")
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEventEnvelope {
    session_id: String,
    event: Value,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_model_roles() -> Result<ModelRolesSnapshot, AppError> {
    omp_config::load_model_roles()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_model_role(
    role: String,
    selector: String,
) -> Result<ModelRolesSnapshot, AppError> {
    omp_config::set_model_role(&role, &selector)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_available_models(
    state: State<'_, AppState>,
) -> Result<Vec<AvailableModel>, AppError> {
    use crate::rpc::RpcClient;
    use crate::settings;
    use serde_json::Map;
    use tokio::time::Duration;

    let settings = state.settings.lock().await.clone();
    let omp_bin = settings::resolve_omp_binary(&settings).unwrap_or_else(|_| PathBuf::from("omp"));
    let cwd = std::env::temp_dir();
    let args = vec![
        "--mode".into(),
        "rpc".into(),
        "--cwd".into(),
        cwd.display().to_string(),
        "--no-session".into(),
    ];
    let client = RpcClient::spawn(&omp_bin, &args).await?;
    client.wait_ready(Duration::from_secs(30)).await?;
    let response = client
        .request("get_available_models", Value::Object(Map::new()))
        .await?;
    Ok(omp_config::parse_available_models_response(&response))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, AppError> {
    Ok(state.settings.lock().await.clone())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), AppError> {
    let omp_bin = settings::resolve_omp_binary(&settings)?;
    settings::save_settings(&state.config_dir, &settings)?;
    state
        .sessions
        .lock()
        .await
        .set_settings(settings.clone(), omp_bin);
    *state.settings.lock().await = settings;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub omp_found: bool,
    pub omp_path: Option<String>,
    pub omp_version: Option<String>,
    pub impeccable_skill_present: bool,
    pub impeccable_skill_path: Option<String>,
    pub impeccable_rules_present: bool,
    pub onboarding_completed: bool,
    pub home_dir: Option<String>,
}

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

fn which_omp(settings: &AppSettings) -> Option<PathBuf> {
    settings::resolve_omp_binary(settings).ok()
}

fn read_omp_version(bin: &Path) -> Option<String> {
    let mut command = std::process::Command::new(bin);
    command.arg("--version");
    if let Some(path) = settings::runtime_command_path(bin) {
        command.env("PATH", path);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        None
    } else {
        Some(line.to_string())
    }
}

fn impeccable_skill_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(home) = home_dir() {
        out.push(home.join(".agents/skills/impeccable/SKILL.md"));
        out.push(home.join(".omp/agent/skills/impeccable/SKILL.md"));
        out.push(home.join(".claude/skills/impeccable/SKILL.md"));
    }
    out
}

fn first_existing(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|p| p.is_file()).cloned()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_setup_status(state: State<'_, AppState>) -> Result<SetupStatus, AppError> {
    let settings = state.settings.lock().await.clone();
    let omp_path = which_omp(&settings);
    let omp_version = omp_path.as_ref().and_then(|p| read_omp_version(p));
    let skill = first_existing(&impeccable_skill_candidates());
    let rules = home_dir().map(|h| h.join(".omp/agent/RULES.md"));
    let rules_present = rules
        .as_ref()
        .map(|p| {
            p.is_file()
                && fs::read_to_string(p)
                    .map(|c| c.to_ascii_lowercase().contains("impeccable"))
                    .unwrap_or(false)
        })
        .unwrap_or(false);

    Ok(SetupStatus {
        omp_found: omp_path.is_some(),
        omp_path: omp_path.map(|p| p.display().to_string()),
        omp_version,
        impeccable_skill_present: skill.is_some(),
        impeccable_skill_path: skill.map(|p| p.display().to_string()),
        impeccable_rules_present: rules_present,
        onboarding_completed: settings.onboarding_completed,
        home_dir: home_dir().map(|p| p.display().to_string()),
    })
}

fn run_npx(args: &[&str]) -> std::io::Result<std::process::ExitStatus> {
    #[cfg(windows)]
    {
        // npx is typically a .cmd shim; run through cmd.exe for CreateProcess compatibility.
        let mut command = std::process::Command::new("cmd");
        command.arg("/C").arg("npx");
        if let Some(path) = settings::runtime_command_path(Path::new("npx")) {
            command.env("PATH", path);
        }
        for arg in args {
            command.arg(arg);
        }
        command.status()
    }
    #[cfg(not(windows))]
    {
        let mut command = std::process::Command::new("npx");
        if let Some(path) = settings::runtime_command_path(Path::new("npx")) {
            command.env("PATH", path);
        }
        for arg in args {
            command.arg(arg);
        }
        command.status()
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn install_impeccable() -> Result<SetupStatus, AppError> {
    let home = home_dir().ok_or_else(|| AppError::Msg("home directory unavailable".into()))?;
    let agents_skill = home.join(".agents/skills/impeccable");
    let omp_skills = home.join(".omp/agent/skills");
    let omp_skill_link = omp_skills.join("impeccable");
    let rules_path = home.join(".omp/agent/RULES.md");
    let agents_rules = home.join(".agents/rules");

    if !agents_skill.join("SKILL.md").is_file() {
        let status = run_npx(&[
            "--yes",
            "impeccable@3.2.1",
            "install",
            "--yes",
            "--scope=global",
            "--providers=agents,claude",
            "--no-hooks",
        ])
        .map_err(|error| AppError::Msg(format!("failed to run npx impeccable: {error}")))?;
        if !status.success() {
            return Err(AppError::Msg(
                "impeccable install failed — ensure Node.js/npm are installed and network is available"
                    .into(),
            ));
        }
    }

    if !agents_skill.join("SKILL.md").is_file() {
        return Err(AppError::Msg(
            "impeccable skill still missing after install".into(),
        ));
    }

    fs::create_dir_all(&omp_skills)
        .map_err(|error| AppError::Msg(format!("create omp skills dir: {error}")))?;
    let _ = fs::remove_file(&omp_skill_link);
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&agents_skill, &omp_skill_link).map_err(|error| {
            AppError::Msg(format!("link impeccable into ~/.omp/agent/skills: {error}"))
        })?;
    }
    #[cfg(not(unix))]
    {
        if omp_skill_link.exists() {
            let _ = fs::remove_dir_all(&omp_skill_link);
        }
        copy_dir_all(&agents_skill, &omp_skill_link)?;
    }

    fs::create_dir_all(home.join(".omp/agent"))
        .map_err(|error| AppError::Msg(format!("create omp agent dir: {error}")))?;
    let rules = "# Harness rules (always apply)\n\n## Impeccable design standard (default)\n\nFor any UI / frontend / visual / UX work, agents MUST follow Impeccable (https://impeccable.style/docs/).\n\n1. Read skill://impeccable before designing or editing UI.\n2. Run: node <skill-base-dir>/scripts/context.mjs once per session (cwd = project).\n3. Load skill://impeccable/reference/<command>.md for craft/shape/polish/critique/audit/layout/typeset/animate/etc.\n4. Obey absolute bans (no AI-slop defaults).\n5. Prefer PRODUCT.md + DESIGN.md when present.\n\nNon-UI tasks are exempt; mixed changes apply Impeccable to the UI portion.\n";
    let should_write_rules = !rules_path.is_file()
        || fs::read_to_string(&rules_path)
            .map(|c| !c.to_ascii_lowercase().contains("impeccable"))
            .unwrap_or(true);
    if should_write_rules {
        fs::write(&rules_path, rules)
            .map_err(|error| AppError::Msg(format!("write RULES.md: {error}")))?;
    }

    fs::create_dir_all(&agents_rules)
        .map_err(|error| AppError::Msg(format!("create agents rules dir: {error}")))?;
    let agents_rule = agents_rules.join("impeccable.md");
    if !agents_rule.is_file() {
        fs::write(
            &agents_rule,
            "---\ndescription: Require Impeccable for all UI/frontend work\nalwaysApply: true\n---\n\n# Impeccable (always apply for UI)\n\nBefore any UI/frontend/visual change, read `skill://impeccable` and follow https://impeccable.style/docs/.\n",
        )
        .map_err(|error| AppError::Msg(format!("write agents rule: {error}")))?;
    }

    let skill = first_existing(&impeccable_skill_candidates());
    Ok(SetupStatus {
        omp_found: which::which("omp").is_ok(),
        omp_path: which::which("omp").ok().map(|p| p.display().to_string()),
        omp_version: which::which("omp").ok().and_then(|p| read_omp_version(&p)),
        impeccable_skill_present: skill.is_some(),
        impeccable_skill_path: skill.map(|p| p.display().to_string()),
        impeccable_rules_present: rules_path.is_file()
            && fs::read_to_string(&rules_path)
                .map(|c| c.to_ascii_lowercase().contains("impeccable"))
                .unwrap_or(false),
        onboarding_completed: false,
        home_dir: Some(home.display().to_string()),
    })
}

#[cfg(not(unix))]
fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), AppError> {
    fs::create_dir_all(dst).map_err(|e| AppError::Msg(format!("mkdir: {e}")))?;
    for entry in fs::read_dir(src).map_err(|e| AppError::Msg(format!("read_dir: {e}")))? {
        let entry = entry.map_err(|e| AppError::Msg(format!("dir entry: {e}")))?;
        let ty = entry
            .file_type()
            .map_err(|e| AppError::Msg(format!("file_type: {e}")))?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), to).map_err(|e| AppError::Msg(format!("copy: {e}")))?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: String,
}

fn parse_skill_frontmatter(raw: &str) -> (Option<String>, Option<String>) {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return (None, None);
    }
    let rest = &trimmed[3..];
    let Some(end) = rest.find("\n---") else {
        return (None, None);
    };
    let fm = &rest[..end];
    let mut name = None;
    let mut description = None;
    for line in fm.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("name:") {
            name = Some(v.trim().trim_matches('"').to_string());
        } else if let Some(v) = line.strip_prefix("description:") {
            let v = v.trim().trim_matches('"');
            description = Some(v.to_string());
        }
    }
    (name, description)
}

fn scan_skills_dir(
    dir: &Path,
    source: &str,
    out: &mut Vec<SkillInfo>,
    seen: &mut std::collections::HashSet<String>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&skill_md) else {
            continue;
        };
        let folder = path.file_name().and_then(|s| s.to_str()).unwrap_or("skill");
        let (name, description) = parse_skill_frontmatter(&raw);
        let name = name.unwrap_or_else(|| folder.to_string());
        if !seen.insert(name.clone()) {
            continue;
        }
        out.push(SkillInfo {
            name,
            description: description.unwrap_or_default(),
            path: skill_md.display().to_string(),
            source: source.to_string(),
        });
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_skills() -> Result<Vec<SkillInfo>, AppError> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    if let Some(home) = dirs::home_dir() {
        scan_skills_dir(
            &home.join(".omp/agent/skills"),
            "omp-user",
            &mut out,
            &mut seen,
        );
        scan_skills_dir(
            &home.join(".agents/skills"),
            "agents-user",
            &mut out,
            &mut seen,
        );
        scan_skills_dir(
            &home.join(".claude/skills"),
            "claude-user",
            &mut out,
            &mut seen,
        );
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionInfo>, AppError> {
    Ok(state.sessions.lock().await.list())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_session(
    app: AppHandle,
    state: State<'_, AppState>,
    cwd: String,
    resume: Option<String>,
    remote: Option<RemoteTarget>,
) -> Result<SessionInfo, AppError> {
    let mut sessions = state.sessions.lock().await;
    let info = sessions
        .create_session(PathBuf::from(cwd), resume, remote)
        .await?;
    let mut events = sessions.take_events(&info.id).ok_or_else(|| {
        AppError::Msg(format!(
            "event receiver unavailable for session {}",
            info.id
        ))
    })?;
    drop(sessions);

    // Persist agent + job card for the job board.
    {
        let memory = state.memory.lock().await;
        let key = info.project_key();
        let label = info.project_label();
        let _ = memory.ensure_role_roster(&key, &label);
        let _ = memory.ensure_default_agent_for_session(&info.id, &key, &label, "default");
    }

    let event_app = app.clone();
    let session_id = info.id.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            let _ = event_app.emit(
                "omp-event",
                SessionEventEnvelope {
                    session_id: session_id.clone(),
                    event,
                },
            );
        }
        event_app
            .state::<AppState>()
            .sessions
            .lock()
            .await
            .mark_exited(&session_id);
        let _ = event_app.emit("omp-session-exit", session_id);
    });

    Ok(info)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_ssh_hosts(state: State<'_, AppState>) -> Result<Vec<SshHostInfo>, AppError> {
    let settings = state.settings.lock().await.clone();
    let omp = omp_binary_or_fallback(&settings);
    ssh::list_hosts(&omp)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_ssh_host(
    name: String,
    host: String,
    user: Option<String>,
    port: Option<u16>,
    key_path: Option<String>,
    description: Option<String>,
) -> Result<SshHostInfo, AppError> {
    ssh::add_user_host(
        &name,
        &host,
        user.as_deref(),
        port,
        key_path.as_deref(),
        description.as_deref(),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn test_ssh_connection(remote: RemoteTarget) -> Result<SshProbeResult, AppError> {
    // Run blocking ssh probe off the async runtime.
    tokio::task::spawn_blocking(move || ssh::probe_connection(&remote))
        .await
        .map_err(|e| AppError::Msg(format!("ssh probe join error: {e}")))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_remote_dir(
    remote: RemoteTarget,
    path: Option<String>,
) -> Result<RemoteDirListing, AppError> {
    let path = path.unwrap_or_else(|| remote.remote_cwd.clone());
    tokio::task::spawn_blocking(move || ssh::list_remote_dir(&remote, &path))
        .await
        .map_err(|e| AppError::Msg(format!("remote ls join error: {e}")))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_ssh_recents() -> Result<Vec<SshRecent>, AppError> {
    ssh::load_recents()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_ssh_session(
    app: AppHandle,
    state: State<'_, AppState>,
    remote: RemoteTarget,
) -> Result<SessionInfo, AppError> {
    // Probe first so we fail fast with a clear error.
    let probe = {
        let remote = remote.clone();
        tokio::task::spawn_blocking(move || ssh::probe_connection(&remote))
            .await
            .map_err(|e| AppError::Msg(format!("ssh probe join error: {e}")))??
    };
    if !probe.ok {
        return Err(AppError::Msg(format!(
            "SSH connection failed: {}",
            probe.message
        )));
    }

    let mut target = remote;
    if let Some(cwd) = probe.remote_cwd {
        target.remote_cwd = cwd;
    }
    let _ = ssh::push_recent(&target);

    // Local cwd is a generated workspace stub; remote work uses ssh:// + OMP hosts.
    let local_placeholder = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .display()
        .to_string();

    let mut sessions = state.sessions.lock().await;
    let info = sessions
        .create_session(PathBuf::from(local_placeholder), None, Some(target.clone()))
        .await?;
    let mut events = sessions.take_events(&info.id).ok_or_else(|| {
        AppError::Msg(format!(
            "event receiver unavailable for session {}",
            info.id
        ))
    })?;
    drop(sessions);

    {
        let memory = state.memory.lock().await;
        let key = info.project_key();
        let label = info.project_label();
        let _ = memory.ensure_role_roster(&key, &label);
        let _ = memory.ensure_default_agent_for_session(&info.id, &key, &label, "default");
    }

    let app_handle = app.clone();
    let session_id = info.id.clone();
    tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            let _ = app_handle.emit(
                "omp-event",
                SessionEventEnvelope {
                    session_id: session_id.clone(),
                    event,
                },
            );
        }
        app_handle
            .state::<AppState>()
            .sessions
            .lock()
            .await
            .mark_exited(&session_id);
        let _ = app_handle.emit("omp-session-exit", session_id);
    });

    Ok(info)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn close_session(state: State<'_, AppState>, session_id: String) -> Result<(), AppError> {
    if let Err(error) = state.ptys.lock().await.close_pty(&session_id) {
        log::warn!("unable to close PTY for session {session_id}: {error}");
    }
    state.sessions.lock().await.close(&session_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_pty(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
) -> Result<(), AppError> {
    let remote = state.sessions.lock().await.remote_target(&session_id);
    let output_session_id = session_id.clone();
    state.ptys.lock().await.open_pty(
        &session_id,
        &PathBuf::from(cwd),
        remote.as_ref(),
        move |data| {
            let _ = app.emit(
                "pty-output",
                PtyOutput::new(output_session_id.clone(), data),
            );
        },
    )?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn write_pty(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), AppError> {
    state.ptys.lock().await.write_pty(&session_id, &data)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn resize_pty(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    state.ptys.lock().await.resize_pty(&session_id, cols, rows)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn close_pty(state: State<'_, AppState>, session_id: String) -> Result<(), AppError> {
    state.ptys.lock().await.close_pty(&session_id)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn prompt(
    state: State<'_, AppState>,
    session_id: String,
    message: String,
    streaming_behavior: Option<String>,
) -> Result<Value, AppError> {
    state
        .sessions
        .lock()
        .await
        .prompt(&session_id, message, streaming_behavior)
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn abort(state: State<'_, AppState>, session_id: String) -> Result<Value, AppError> {
    state.sessions.lock().await.abort(&session_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_state(state: State<'_, AppState>, session_id: String) -> Result<Value, AppError> {
    state.sessions.lock().await.get_state(&session_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rewrite_assistant_message(
    state: State<'_, AppState>,
    session_id: String,
    text: String,
    response_id: Option<String>,
) -> Result<session_history::RewriteResult, AppError> {
    let mut sessions = state.sessions.lock().await;
    let snapshot = sessions.get_state(&session_id).await?;
    if snapshot.get("success").and_then(|v| v.as_bool()) == Some(false) {
        return Err(AppError::Msg(
            snapshot
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("get_state failed")
                .to_string(),
        ));
    }
    let data = snapshot.get("data").cloned().unwrap_or(snapshot);
    let session_file = data
        .get("sessionFile")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Msg("session file unavailable from omp state".into()))?;
    let result = session_history::rewrite_assistant_text(
        PathBuf::from(session_file).as_path(),
        response_id.as_deref(),
        &text,
    )?;
    // Reload so in-memory OMP history matches the rewritten file.
    let reload = sessions
        .rpc_command(
            &session_id,
            "switch_session",
            serde_json::json!({ "sessionPath": result.session_file.clone() }),
        )
        .await?;
    if reload.get("success").and_then(|v| v.as_bool()) == Some(false) {
        return Err(AppError::Msg(format!(
            "rewrote session file but failed to reload omp: {}",
            reload
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("switch_session failed")
        )));
    }
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rpc_command(
    state: State<'_, AppState>,
    session_id: String,
    command: String,
    params: Value,
) -> Result<Value, AppError> {
    state
        .sessions
        .lock()
        .await
        .rpc_command(&session_id, &command, params)
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn respond_extension_ui(
    state: State<'_, AppState>,
    session_id: String,
    request_id: String,
    response: Value,
) -> Result<(), AppError> {
    state
        .sessions
        .lock()
        .await
        .respond_extension_ui(&session_id, &request_id, response)
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_role_notes(
    state: State<'_, AppState>,
    role: String,
    project_key: String,
) -> Result<Vec<RoleMemoryNote>, AppError> {
    state
        .memory
        .lock()
        .await
        .list_role_notes(&role, &project_key, 100)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_role_note(
    state: State<'_, AppState>,
    role: String,
    project_key: String,
    kind: String,
    title: String,
    body: String,
    source_session_id: Option<String>,
) -> Result<RoleMemoryNote, AppError> {
    state.memory.lock().await.add_role_note(
        &role,
        &project_key,
        &kind,
        &title,
        &body,
        source_session_id.as_deref(),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_role_note(state: State<'_, AppState>, id: i64) -> Result<(), AppError> {
    state.memory.lock().await.delete_role_note(id)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_role_scratchpad(
    state: State<'_, AppState>,
    role: String,
    project_key: String,
) -> Result<RoleScratchpad, AppError> {
    state
        .memory
        .lock()
        .await
        .get_scratchpad(&role, &project_key)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_role_scratchpad(
    state: State<'_, AppState>,
    role: String,
    project_key: String,
    content: String,
) -> Result<RoleScratchpad, AppError> {
    state
        .memory
        .lock()
        .await
        .save_scratchpad(&role, &project_key, &content)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_agents(
    state: State<'_, AppState>,
    project_key: Option<String>,
) -> Result<Vec<PersistentAgent>, AppError> {
    state
        .memory
        .lock()
        .await
        .list_agents(project_key.as_deref())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_jobs(
    state: State<'_, AppState>,
    project_key: Option<String>,
) -> Result<Vec<JobCard>, AppError> {
    state.memory.lock().await.list_jobs(project_key.as_deref())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "camelCase")]
pub async fn upsert_job(
    state: State<'_, AppState>,
    id: String,
    project_key: String,
    project_label: String,
    title: String,
    detail: String,
    status: String,
    assignee_agent_id: Option<String>,
    assignee_role: Option<String>,
    session_id: Option<String>,
) -> Result<JobCard, AppError> {
    state.memory.lock().await.upsert_job(
        &id,
        &project_key,
        &project_label,
        &title,
        &detail,
        &status,
        assignee_agent_id.as_deref(),
        assignee_role.as_deref(),
        session_id.as_deref(),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn post_turn_housekeeping(
    state: State<'_, AppState>,
    session_id: String,
    project_key: String,
    project_label: String,
    role: Option<String>,
    summary: Option<String>,
) -> Result<(), AppError> {
    let role = role.unwrap_or_else(|| "default".into());
    let summary = summary.unwrap_or_else(|| "Turn complete".into());
    let memory = state.memory.lock().await;
    let _ = memory.ensure_role_roster(&project_key, &project_label);
    memory.mark_session_turn(&session_id, &project_key, &project_label, &role, &summary)?;
    // Capture a lightweight interaction note for this role (non-blocking intent: caller fires after turn).
    if !summary.trim().is_empty() && summary != "Turn complete" {
        let _ = memory.add_role_note(
            &role,
            &project_key,
            "interaction",
            "Recent turn",
            &summary,
            Some(&session_id),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::AppSettings;
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn event_envelope_serializes_session_id_as_camel_case() {
        let envelope = SessionEventEnvelope {
            session_id: "session-1".into(),
            event: json!({ "type": "message_update" }),
        };

        assert_eq!(
            serde_json::to_value(envelope).unwrap(),
            json!({
                "sessionId": "session-1",
                "event": { "type": "message_update" },
            })
        );
    }

    #[test]
    fn unresolved_omp_binary_falls_back_to_command_name() {
        let settings = AppSettings {
            omp_binary: Some("/definitely/missing/omp".into()),
            ..AppSettings::default()
        };

        assert_eq!(omp_binary_or_fallback(&settings), PathBuf::from("omp"));
    }
}
