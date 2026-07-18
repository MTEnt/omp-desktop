use crate::error::AppError;
use crate::pty::{PtyManager, PtyOutput};
use crate::session::{SessionInfo, SessionManager};
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
    pub config_dir: PathBuf,
}

pub fn initialize_app_state() -> Result<AppState, AppError> {
    let config_dir = settings::default_config_dir()?;
    let app_settings = settings::load_settings(&config_dir)?;
    let omp_binary = omp_binary_or_fallback(&app_settings);
    let sessions = SessionManager::new(app_settings.clone(), omp_binary);

    Ok(AppState {
        sessions: Mutex::new(sessions),
        ptys: Mutex::new(PtyManager::default()),
        settings: Mutex::new(app_settings),
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
