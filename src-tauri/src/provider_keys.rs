use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const ALLOWED_KEYS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "GROQ_API_KEY",
    "XAI_API_KEY",
    "MISTRAL_API_KEY",
    "DEEPSEEK_API_KEY",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyStatus {
    pub name: String,
    pub label: String,
    pub configured: bool,
    pub masked: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyUpdate {
    pub name: String,
    /// New secret value. Ignored when `clear` is true.
    #[serde(default)]
    pub value: Option<String>,
    /// When true, remove this key from the agent `.env`.
    #[serde(default)]
    pub clear: bool,
}

fn label_for(name: &str) -> &'static str {
    match name {
        "ANTHROPIC_API_KEY" => "Anthropic",
        "OPENAI_API_KEY" => "OpenAI",
        "GEMINI_API_KEY" => "Google Gemini",
        "OPENROUTER_API_KEY" => "OpenRouter",
        "GROQ_API_KEY" => "Groq",
        "XAI_API_KEY" => "xAI",
        "MISTRAL_API_KEY" => "Mistral",
        "DEEPSEEK_API_KEY" => "DeepSeek",
        _ => "Provider",
    }
}

fn is_allowed(name: &str) -> bool {
    ALLOWED_KEYS.iter().any(|key| *key == name)
}

pub fn agent_env_path() -> AppResult<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Msg("home directory not found".into()))?;
    Ok(home.join(".omp").join("agent").join(".env"))
}

pub fn mask_secret(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= 4 {
        return "••••".into();
    }
    let suffix: String = chars[chars.len().saturating_sub(4)..].iter().collect();
    format!("••••{suffix}")
}

fn strip_quotes(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'')
        {
            return value[1..value.len() - 1]
                .replace("\\\"", "\"")
                .replace("\\\\", "\\");
        }
    }
    value.to_string()
}

fn escape_env_value(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn parse_env_file(contents: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        map.insert(key.to_string(), strip_quotes(value));
    }
    map
}

pub fn list_provider_keys(path: &Path) -> AppResult<Vec<ProviderKeyStatus>> {
    let map = if path.is_file() {
        parse_env_file(&fs::read_to_string(path)?)
    } else {
        HashMap::new()
    };

    Ok(ALLOWED_KEYS
        .iter()
        .map(|name| {
            let value = map.get(*name).map(String::as_str).unwrap_or("").trim();
            let configured = !value.is_empty();
            ProviderKeyStatus {
                name: (*name).to_string(),
                label: label_for(name).to_string(),
                configured,
                masked: if configured {
                    Some(mask_secret(value))
                } else {
                    None
                },
            }
        })
        .collect())
}

pub fn save_provider_keys(path: &Path, updates: &[ProviderKeyUpdate]) -> AppResult<Vec<ProviderKeyStatus>> {
    for update in updates {
        if !is_allowed(&update.name) {
            return Err(AppError::Msg(format!(
                "unsupported provider key: {}",
                update.name
            )));
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let existing = if path.is_file() {
        fs::read_to_string(path)?
    } else {
        String::new()
    };

    let mut lines: Vec<String> = if existing.is_empty() {
        Vec::new()
    } else {
        existing.lines().map(str::to_string).collect()
    };

    for update in updates {
        if update.clear {
            lines.retain(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    return true;
                }
                trimmed
                    .split_once('=')
                    .map(|(key, _)| key.trim() != update.name)
                    .unwrap_or(true)
            });
            continue;
        }

        let Some(value) = update.value.as_deref().map(str::trim).filter(|v| !v.is_empty()) else {
            // Blank value means keep existing.
            continue;
        };

        let assignment = format!("{}={}", update.name, escape_env_value(value));
        let mut replaced = false;
        for line in &mut lines {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((key, _)) = trimmed.split_once('=') {
                if key.trim() == update.name {
                    *line = assignment.clone();
                    replaced = true;
                    break;
                }
            }
        }
        if !replaced {
            if !lines.is_empty() && !lines.last().map(|l| l.trim().is_empty()).unwrap_or(true) {
                // Keep a single trailing newline style by appending cleanly.
            }
            lines.push(assignment);
        }
    }

    let mut body = lines.join("\n");
    if !body.is_empty() && !body.ends_with('\n') {
        body.push('\n');
    }
    fs::write(path, body)?;
    list_provider_keys(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_env_path(tag: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("omp-desktop-provider-keys-{tag}-{stamp}.env"))
    }

    #[test]
    fn masks_secret_tail() {
        assert_eq!(mask_secret("sk-ant-abcdef"), "••••cdef");
        assert_eq!(mask_secret("ab"), "••••");
    }

    #[test]
    fn merge_preserves_unrelated_and_clears() {
        let path = temp_env_path("merge");
        fs::write(
            &path,
            "# keep me\nANTHROPIC_API_KEY=old-key\nPI_NO_PTY=1\nOPENAI_API_KEY=openai-old\n",
        )
        .unwrap();

        let statuses = save_provider_keys(
            &path,
            &[
                ProviderKeyUpdate {
                    name: "ANTHROPIC_API_KEY".into(),
                    value: Some("sk-ant-new-value".into()),
                    clear: false,
                },
                ProviderKeyUpdate {
                    name: "OPENAI_API_KEY".into(),
                    value: None,
                    clear: true,
                },
                ProviderKeyUpdate {
                    name: "GEMINI_API_KEY".into(),
                    value: Some("gemini-key".into()),
                    clear: false,
                },
            ],
        )
        .unwrap();

        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("# keep me"));
        assert!(raw.contains("PI_NO_PTY=1"));
        assert!(raw.contains("ANTHROPIC_API_KEY=\"sk-ant-new-value\""));
        assert!(raw.contains("GEMINI_API_KEY=\"gemini-key\""));
        assert!(!raw.contains("OPENAI_API_KEY"));

        let anthropic = statuses
            .iter()
            .find(|s| s.name == "ANTHROPIC_API_KEY")
            .unwrap();
        assert!(anthropic.configured);
        assert_eq!(anthropic.masked.as_deref(), Some("••••alue"));

        let openai = statuses.iter().find(|s| s.name == "OPENAI_API_KEY").unwrap();
        assert!(!openai.configured);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn blank_update_keeps_existing() {
        let path = temp_env_path("keep");
        fs::write(&path, "ANTHROPIC_API_KEY=keep-me\n").unwrap();
        save_provider_keys(
            &path,
            &[ProviderKeyUpdate {
                name: "ANTHROPIC_API_KEY".into(),
                value: Some("   ".into()),
                clear: false,
            }],
        )
        .unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("ANTHROPIC_API_KEY=keep-me") || raw.contains("keep-me"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_unknown_keys() {
        let path = temp_env_path("bad");
        let err = save_provider_keys(
            &path,
            &[ProviderKeyUpdate {
                name: "NOT_A_KEY".into(),
                value: Some("x".into()),
                clear: false,
            }],
        )
        .unwrap_err();
        assert!(err.to_string().contains("unsupported"));
        let _ = fs::remove_file(path);
    }
}
