use crate::error::{AppError, AppResult};
use crate::settings::{self, AppSettings};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoginProvider {
    pub id: String,
    pub name: String,
}

fn resolve_omp(settings: &AppSettings) -> AppResult<PathBuf> {
    settings::resolve_omp_binary(settings)
}

fn configure_command(command: &mut Command, omp_bin: &Path, hide_window: bool) {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(path) = settings::runtime_command_path(omp_bin) {
        command.env("PATH", path);
    }
    // Keep list/logout quiet; login may need to launch the system browser.
    #[cfg(windows)]
    if hide_window {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn combine_output(stdout: &[u8], stderr: &[u8]) -> String {
    let mut parts = Vec::new();
    let out = String::from_utf8_lossy(stdout).trim().to_string();
    let err = String::from_utf8_lossy(stderr).trim().to_string();
    if !out.is_empty() {
        parts.push(out);
    }
    if !err.is_empty() {
        parts.push(err);
    }
    parts.join("\n")
}

pub async fn list_login_providers(settings: &AppSettings) -> AppResult<Vec<LoginProvider>> {
    let omp_bin = resolve_omp(settings)?;
    let mut command = Command::new(&omp_bin);
    command.args(["auth-broker", "list", "--json"]);
    configure_command(&mut command, &omp_bin, true);

    let output = command
        .output()
        .await
        .map_err(|error| AppError::Msg(format!("failed to run omp auth-broker list: {error}")))?;

    if !output.status.success() {
        let detail = combine_output(&output.stdout, &output.stderr);
        return Err(AppError::Msg(if detail.is_empty() {
            "omp auth-broker list failed".into()
        } else {
            format!("omp auth-broker list failed\n{detail}")
        }));
    }

    let value: Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        AppError::Msg(format!("invalid auth-broker list JSON: {error}"))
    })?;
    let array = value
        .as_array()
        .ok_or_else(|| AppError::Msg("auth-broker list JSON must be an array".into()))?;

    let mut providers = Vec::new();
    for item in array {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let id = obj
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if id.is_empty() {
            continue;
        }
        let name = obj
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(id.as_str())
            .to_string();
        providers.push(LoginProvider { id, name });
    }
    Ok(providers)
}

pub async fn login_provider(settings: &AppSettings, provider_id: &str) -> AppResult<()> {
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        return Err(AppError::Msg("provider id is required".into()));
    }

    let omp_bin = resolve_omp(settings)?;
    let mut command = Command::new(&omp_bin);
    command.args(["auth-broker", "login", provider_id]);
    configure_command(&mut command, &omp_bin, false);

    let output = timeout(LOGIN_TIMEOUT, command.output())
        .await
        .map_err(|_| {
            AppError::Msg(format!(
                "timed out waiting for omp auth-broker login ({provider_id})"
            ))
        })?
        .map_err(|error| {
            AppError::Msg(format!("failed to run omp auth-broker login: {error}"))
        })?;

    if output.status.success() {
        return Ok(());
    }

    let detail = combine_output(&output.stdout, &output.stderr);
    Err(AppError::Msg(if detail.is_empty() {
        format!("omp auth-broker login failed for {provider_id}")
    } else {
        format!("omp auth-broker login failed for {provider_id}\n{detail}")
    }))
}

pub async fn logout_provider(settings: &AppSettings, provider_id: &str) -> AppResult<()> {
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        return Err(AppError::Msg("provider id is required".into()));
    }

    let omp_bin = resolve_omp(settings)?;
    let mut command = Command::new(&omp_bin);
    command.args(["auth-broker", "logout", provider_id]);
    configure_command(&mut command, &omp_bin, true);

    let output = command
        .output()
        .await
        .map_err(|error| AppError::Msg(format!("failed to run omp auth-broker logout: {error}")))?;

    if output.status.success() {
        return Ok(());
    }

    let detail = combine_output(&output.stdout, &output.stderr);
    Err(AppError::Msg(if detail.is_empty() {
        format!("omp auth-broker logout failed for {provider_id}")
    } else {
        format!("omp auth-broker logout failed for {provider_id}\n{detail}")
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_provider_array() {
        let raw = json!([
            { "id": "anthropic", "name": "Anthropic (Claude Pro/Max)" },
            { "id": "cursor", "name": "Cursor" },
            { "id": "", "name": "skip" },
            { "name": "missing-id" }
        ]);
        let array = raw.as_array().unwrap();
        let mut providers = Vec::new();
        for item in array {
            let Some(obj) = item.as_object() else {
                continue;
            };
            let id = obj
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            if id.is_empty() {
                continue;
            }
            let name = obj
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(id.as_str())
                .to_string();
            providers.push(LoginProvider { id, name });
        }
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].id, "anthropic");
        assert_eq!(providers[1].id, "cursor");
    }
}
