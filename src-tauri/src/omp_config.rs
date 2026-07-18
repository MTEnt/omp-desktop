use crate::error::{AppError, AppResult};
use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoleAssignment {
    pub role: String,
    pub selector: String,
    pub provider: Option<String>,
    pub model_id: Option<String>,
    pub thinking: Option<String>,
    pub short_label: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRolesSnapshot {
    pub config_path: Option<String>,
    pub roles: Vec<ModelRoleAssignment>,
}

fn agent_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("PI_CODING_AGENT_DIR") {
        return PathBuf::from(dir);
    }
    if let Ok(dir) = std::env::var("OMP_AGENT_DIR") {
        return PathBuf::from(dir);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".omp")
        .join("agent")
}

fn config_candidates(dir: &Path) -> [PathBuf; 2] {
    [dir.join("config.yml"), dir.join("config.yaml")]
}

fn parse_selector(selector: &str) -> (Option<String>, Option<String>, Option<String>) {
    let (base, thinking) = match selector.rsplit_once(':') {
        Some((left, right))
            if matches!(
                right,
                "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "auto"
            ) =>
        {
            (left, Some(right.to_string()))
        }
        _ => (selector, None),
    };

    if let Some((provider, model_id)) = base.split_once('/') {
        (
            Some(provider.to_string()),
            Some(model_id.to_string()),
            thinking,
        )
    } else {
        (None, Some(base.to_string()), thinking)
    }
}

fn short_label(selector: &str) -> String {
    let (provider, model_id, thinking) = parse_selector(selector);
    let model = model_id.as_deref().unwrap_or(selector);
    let mut label = model.to_string();
    if label.len() > 28 {
        label = format!("{}…", &label[..27]);
    }
    match (provider.as_deref(), thinking.as_deref()) {
        (Some(provider), Some(thinking)) => format!("{provider}/{label}:{thinking}"),
        (Some(provider), None) => format!("{provider}/{label}"),
        (None, Some(thinking)) => format!("{label}:{thinking}"),
        (None, None) => label,
    }
}

fn preferred_role_order(role: &str) -> u8 {
    match role {
        "default" => 0,
        "smol" => 1,
        "slow" => 2,
        "plan" => 3,
        "task" => 4,
        "advisor" => 5,
        "tiny" => 6,
        "vision" => 7,
        "designer" => 8,
        "commit" => 9,
        _ => 50,
    }
}

pub fn load_model_roles() -> AppResult<ModelRolesSnapshot> {
    let dir = agent_dir();
    let path = config_candidates(&dir)
        .into_iter()
        .find(|candidate| candidate.is_file());

    let Some(path) = path else {
        return Ok(ModelRolesSnapshot {
            config_path: None,
            roles: Vec::new(),
        });
    };

    let raw = fs::read_to_string(&path)?;
    let value: Value = serde_yaml::from_str(&raw)
        .map_err(|error| AppError::Msg(format!("failed to parse {}: {error}", path.display())))?;

    let mut roles = Vec::new();
    if let Some(map) = value
        .get("modelRoles")
        .and_then(Value::as_object)
        .or_else(|| value.get("model_roles").and_then(Value::as_object))
    {
        roles.extend(assignments_from_map(map));
    }

    roles.sort_by(|left, right| {
        preferred_role_order(&left.role)
            .cmp(&preferred_role_order(&right.role))
            .then_with(|| left.role.cmp(&right.role))
    });

    Ok(ModelRolesSnapshot {
        config_path: Some(path.display().to_string()),
        roles,
    })
}

fn assignments_from_map(map: &Map<String, Value>) -> Vec<ModelRoleAssignment> {
    let mut roles = Vec::new();
    for (role, value) in map {
        let Some(selector) = value.as_str().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        let (provider, model_id, thinking) = parse_selector(selector);
        roles.push(ModelRoleAssignment {
            role: role.clone(),
            selector: selector.to_string(),
            provider,
            model_id,
            thinking,
            short_label: short_label(selector),
        });
    }
    roles
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parses_provider_model_thinking_selector() {
        let (provider, model, thinking) =
            parse_selector("xai-oauth/grok-4.5:xhigh");
        assert_eq!(provider.as_deref(), Some("xai-oauth"));
        assert_eq!(model.as_deref(), Some("grok-4.5"));
        assert_eq!(thinking.as_deref(), Some("xhigh"));
        assert_eq!(
            short_label("google-antigravity/gemini-3.5-flash:high"),
            "google-antigravity/gemini-3.5-flash:high"
        );
    }

    #[test]
    fn loads_model_roles_from_yaml() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("omp-desktop-roles-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("config.yml"),
            r#"
modelRoles:
  default: xai-oauth/grok-4.5:xhigh
  smol: google-antigravity/gemini-3.5-flash:high
  slow: openai-codex/gpt-5.6-sol:max
  plan: google-antigravity/gemini-3.5-flash:high
"#,
        )
        .unwrap();

        // Point agent dir via env for this process test
        // SAFETY: test-only env mutation in single-threaded unit test
        unsafe {
            std::env::set_var("OMP_AGENT_DIR", &dir);
        }
        let snapshot = load_model_roles().unwrap();
        unsafe {
            std::env::remove_var("OMP_AGENT_DIR");
        }

        assert_eq!(snapshot.roles.len(), 4);
        assert_eq!(snapshot.roles[0].role, "default");
        assert_eq!(snapshot.roles[1].role, "smol");
        assert_eq!(snapshot.roles[2].role, "slow");
        assert_eq!(snapshot.roles[3].role, "plan");
        let _ = fs::remove_dir_all(dir);
    }
}
