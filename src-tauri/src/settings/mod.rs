use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalMode {
    Yolo,
    Write,
    AlwaysAsk,
}

impl Default for ApprovalMode {
    fn default() -> Self {
        Self::Yolo
    }
}

impl ApprovalMode {
    pub fn as_cli_value(&self) -> &'static str {
        match self {
            Self::Yolo => "yolo",
            Self::Write => "write",
            Self::AlwaysAsk => "always-ask",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub approval_mode: ApprovalMode,
    pub omp_binary: Option<String>,
    pub default_model: Option<String>,
    pub default_thinking: Option<String>,
    pub default_profile: Option<String>,
    pub theme: String,
    /// First-launch walkthrough finished. Missing field on legacy settings
    /// files is treated as completed so existing installs are not interrupted.
    #[serde(default)]
    pub onboarding_completed: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            approval_mode: ApprovalMode::Yolo,
            omp_binary: None,
            default_model: None,
            default_thinking: None,
            default_profile: None,
            theme: "dark".into(),
            onboarding_completed: false,
        }
    }
}

pub fn settings_path_for(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

pub fn load_settings(config_dir: &Path) -> AppResult<AppSettings> {
    let path = settings_path_for(config_dir);
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(path)?;
    let value: serde_json::Value = serde_json::from_str(&raw)?;
    let mut settings: AppSettings = serde_json::from_value(value.clone())?;
    // Legacy settings.json without the field: do not force the walkthrough again.
    if value.get("onboardingCompleted").is_none() {
        settings.onboarding_completed = true;
    }
    Ok(settings)
}

pub fn save_settings(config_dir: &Path, settings: &AppSettings) -> AppResult<()> {
    fs::create_dir_all(config_dir)?;
    let path = settings_path_for(config_dir);
    let raw = serde_json::to_string_pretty(settings)?;
    fs::write(path, raw)?;
    Ok(())
}

pub fn resolve_omp_binary(settings: &AppSettings) -> AppResult<PathBuf> {
    if let Some(p) = &settings.omp_binary {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Ok(path);
        }
        return Err(AppError::Msg(format!(
            "omp binary not found at {}",
            path.display()
        )));
    }
    which::which("omp")
        .map_err(|_| AppError::Msg("omp not found on PATH; set omp binary path in Settings".into()))
}

pub fn default_config_dir() -> AppResult<PathBuf> {
    let base = dirs::config_dir().ok_or_else(|| AppError::Msg("no config dir".into()))?;
    Ok(base.join("omp-desktop"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_dir() -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("omp-desktop-settings-{n}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn default_is_yolo() {
        assert_eq!(AppSettings::default().approval_mode, ApprovalMode::Yolo);
        assert_eq!(ApprovalMode::Yolo.as_cli_value(), "yolo");
    }

    #[test]
    fn round_trip_settings() {
        let dir = tmp_dir();
        let mut s = AppSettings::default();
        s.default_model = Some("opus".into());
        s.approval_mode = ApprovalMode::Write;
        save_settings(&dir, &s).unwrap();
        let loaded = load_settings(&dir).unwrap();
        assert_eq!(loaded, s);
        let _ = fs::remove_dir_all(dir);
    }
}
