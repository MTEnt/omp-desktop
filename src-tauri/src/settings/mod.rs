use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalMode {
    Yolo,
    #[default]
    Write,
    AlwaysAsk,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRolePreset {
    pub name: String,
    pub roles: std::collections::BTreeMap<String, String>,
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
    /// Named role→selector bundles for the Agents panel.
    #[serde(default)]
    pub model_role_presets: Vec<ModelRolePreset>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            approval_mode: ApprovalMode::Write,
            omp_binary: None,
            default_model: None,
            default_thinking: None,
            default_profile: None,
            theme: "dark".into(),
            onboarding_completed: false,
            model_role_presets: Vec::new(),
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
    if let Some(p) = settings
        .omp_binary
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        let path = if let Some(rest) = p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
            dirs::home_dir()
                .map(|home| home.join(rest))
                .unwrap_or_else(|| PathBuf::from(p))
        } else {
            PathBuf::from(p)
        };
        if path.is_file() {
            return Ok(path);
        }
        if path.components().count() == 1 {
            if let Ok(path) = which::which(&path) {
                return Ok(path);
            }
            let command_name = path.to_string_lossy();
            if ["omp", "omp.cmd", "omp.exe", "omp.bat"]
                .iter()
                .any(|name| command_name.eq_ignore_ascii_case(name))
            {
                let home = dirs::home_dir();
                let app_data = std::env::var_os("APPDATA").map(PathBuf::from);
                let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
                if let Some(path) = first_existing_omp(known_omp_candidates(
                    home.as_deref(),
                    app_data.as_deref(),
                    local_app_data.as_deref(),
                )) {
                    return Ok(path);
                }
            }
        }
        // Windows users often pass a path without the .cmd/.exe suffix.
        #[cfg(windows)]
        {
            for ext in [".cmd", ".exe", ".bat"] {
                let candidate = PathBuf::from(format!("{}{ext}", path.display()));
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
        return Err(AppError::Msg(format!(
            "omp binary not found at {}; choose the installed binary in Settings",
            path.display()
        )));
    }

    if let Ok(path) = which_omp() {
        return Ok(path);
    }

    let home = dirs::home_dir();
    let app_data = std::env::var_os("APPDATA").map(PathBuf::from);
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    first_existing_omp(known_omp_candidates(
        home.as_deref(),
        app_data.as_deref(),
        local_app_data.as_deref(),
    ))
    .ok_or_else(|| {
        AppError::Msg(
            "omp not found on PATH or in standard install locations; install OMP or set its binary path in Settings"
                .into(),
        )
    })
}

fn first_existing_omp(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn known_omp_candidates(
    home: Option<&Path>,
    app_data: Option<&Path>,
    local_app_data: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let names: &[&str] = if cfg!(windows) {
        &["omp.cmd", "omp.exe", "omp.bat", "omp"]
    } else {
        &["omp"]
    };
    let mut add_dir = |dir: PathBuf| {
        candidates.extend(names.iter().map(|name| dir.join(name)));
    };

    if let Some(home) = home {
        add_dir(home.join(".bun/bin"));
        add_dir(home.join(".local/bin"));
        add_dir(home.join(".local/share/pnpm"));
    }
    if let Some(app_data) = app_data {
        add_dir(app_data.join("npm"));
    }
    if let Some(local_app_data) = local_app_data {
        add_dir(local_app_data.join("Microsoft/WinGet/Links"));
    }
    for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
        add_dir(PathBuf::from(directory));
    }
    candidates
}

pub fn runtime_command_path(binary: &Path) -> Option<OsString> {
    let home = dirs::home_dir();
    let app_data = std::env::var_os("APPDATA").map(PathBuf::from);
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let inherited = std::env::var_os("PATH");
    runtime_command_path_for(
        binary,
        home.as_deref(),
        app_data.as_deref(),
        local_app_data.as_deref(),
        inherited.as_deref(),
    )
}

fn runtime_command_path_for(
    binary: &Path,
    home: Option<&Path>,
    app_data: Option<&Path>,
    local_app_data: Option<&Path>,
    inherited: Option<&OsStr>,
) -> Option<OsString> {
    let mut paths = Vec::new();
    let mut add = |path: PathBuf| {
        if path.is_dir() && !paths.contains(&path) {
            paths.push(path);
        }
    };

    if let Some(parent) = binary.parent().filter(|path| !path.as_os_str().is_empty()) {
        add(parent.to_path_buf());
    }
    if let Some(home) = home {
        add(home.join(".bun/bin"));
        add(home.join(".local/bin"));
        add(home.join(".local/share/pnpm"));
        add(home.join(".volta/bin"));
        add(home.join(".cargo/bin"));

        let nvm_root = home.join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(nvm_root) {
            let mut node_bins: Vec<_> = entries
                .flatten()
                .map(|entry| entry.path().join("bin"))
                .filter(|path| path.is_dir())
                .collect();
            node_bins.sort_by(|left, right| right.cmp(left));
            for path in node_bins {
                add(path);
            }
        }
    }
    if let Some(app_data) = app_data {
        add(app_data.join("npm"));
    }
    if let Some(local_app_data) = local_app_data {
        add(local_app_data.join("Microsoft/WinGet/Links"));
    }
    for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
        add(PathBuf::from(directory));
    }
    if let Some(inherited) = inherited {
        for path in std::env::split_paths(inherited) {
            add(path);
        }
    }

    std::env::join_paths(paths).ok()
}

fn which_omp() -> Result<PathBuf, which::Error> {
    // Prefer platform-native shims first on Windows.
    #[cfg(windows)]
    {
        for name in ["omp.cmd", "omp.exe", "omp.bat", "omp"] {
            if let Ok(path) = which::which(name) {
                return Ok(path);
            }
        }
        Err(which::Error::CannotFindBinaryPath)
    }
    #[cfg(not(windows))]
    {
        which::which("omp")
    }
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
    fn default_requires_approval_for_command_execution() {
        assert_eq!(AppSettings::default().approval_mode, ApprovalMode::Write);
        assert_eq!(ApprovalMode::Write.as_cli_value(), "write");
    }

    #[test]
    fn known_bun_install_is_discovered_without_path() {
        let dir = tmp_dir();
        let bin_dir = dir.join(".bun/bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let binary = bin_dir.join(if cfg!(windows) { "omp.cmd" } else { "omp" });
        fs::write(&binary, b"test").unwrap();

        let candidates = known_omp_candidates(Some(&dir), None, None);
        assert_eq!(first_existing_omp(candidates), Some(binary));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn runtime_path_prioritizes_binary_and_user_tool_directories() {
        let dir = tmp_dir();
        let binary_dir = dir.join("custom-bin");
        let bun_dir = dir.join(".bun/bin");
        fs::create_dir_all(&binary_dir).unwrap();
        fs::create_dir_all(&bun_dir).unwrap();
        let inherited_dir = dir.join("system-bin");
        fs::create_dir_all(&inherited_dir).unwrap();
        let inherited = std::env::join_paths([&inherited_dir]).unwrap();

        let value = runtime_command_path_for(
            &binary_dir.join("omp"),
            Some(&dir),
            None,
            None,
            Some(&inherited),
        )
        .unwrap();
        let paths: Vec<_> = std::env::split_paths(&value).collect();
        assert_eq!(&paths[..2], &[binary_dir, bun_dir]);
        assert_eq!(paths.last(), Some(&inherited_dir));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn round_trip_settings() {
        let dir = tmp_dir();
        let s = AppSettings {
            default_model: Some("opus".into()),
            approval_mode: ApprovalMode::Write,
            ..AppSettings::default()
        };
        save_settings(&dir, &s).unwrap();
        let loaded = load_settings(&dir).unwrap();
        assert_eq!(loaded, s);
        let _ = fs::remove_dir_all(dir);
    }
}
