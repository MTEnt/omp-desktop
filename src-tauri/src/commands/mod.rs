use crate::error::AppError;
use crate::memory::{self, JobCard, MemoryStore, PersistentAgent, RoleMemoryNote, RoleScratchpad};
use crate::omp_config::{self, AvailableModel, ModelRolesSnapshot};
use crate::pty::{PtyManager, PtyOutput};
use crate::session::{SessionInfo, SessionManager};
use crate::session_history;
use crate::settings::{self, AppSettings};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
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
    settings::save_settings(&state.config_dir, &settings)?;
    state.sessions.lock().await.set_settings(settings.clone());
    *state.settings.lock().await = settings;
    Ok(())
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
) -> Result<SessionInfo, AppError> {
    let mut sessions = state.sessions.lock().await;
    let info = sessions.create_session(PathBuf::from(cwd), resume).await?;
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
        let project = PathBuf::from(&info.cwd);
        let key = memory::project_key(&project);
        let label = memory::project_label(&project);
        let _ = memory.ensure_role_roster(&key, &label);
        let _ = memory.ensure_default_agent_for_session(
            &info.id,
            &key,
            &label,
            "default",
        );
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
        let _ = event_app.emit("omp-session-exit", session_id);
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
    let output_session_id = session_id.clone();
    state
        .ptys
        .lock()
        .await
        .open_pty(&session_id, &PathBuf::from(cwd), move |data| {
            let _ = app.emit(
                "pty-output",
                PtyOutput::new(output_session_id.clone(), data),
            );
        })?;
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
    state.memory.lock().await.get_scratchpad(&role, &project_key)
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
    if summary.trim().len() > 0 && summary != "Turn complete" {
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
        let mut settings = AppSettings::default();
        settings.omp_binary = Some("/definitely/missing/omp".into());

        assert_eq!(omp_binary_or_fallback(&settings), PathBuf::from("omp"));
    }
}
