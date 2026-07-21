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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    pub provider: String,
    pub id: String,
    pub name: String,
    pub selector: String,
    pub reasoning: bool,
    pub thinking_efforts: Vec<String>,
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

pub fn resolve_config_path() -> PathBuf {
    let dir = agent_dir();
    config_candidates(&dir)
        .into_iter()
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| dir.join("config.yml"))
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
    let (_provider, model_id, thinking) = parse_selector(selector);
    let model = model_id.as_deref().unwrap_or(selector);
    let mut label = model.to_string();
    if label.len() > 28 {
        label = format!("{}…", &label[..27]);
    }
    match thinking.as_deref() {
        Some(thinking) => format!("{label}:{thinking}"),
        None => label,
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

fn sort_roles(roles: &mut [ModelRoleAssignment]) {
    roles.sort_by(|left, right| {
        preferred_role_order(&left.role)
            .cmp(&preferred_role_order(&right.role))
            .then_with(|| left.role.cmp(&right.role))
    });
}

fn assignment_from_selector(role: &str, selector: &str) -> ModelRoleAssignment {
    let (provider, model_id, thinking) = parse_selector(selector);
    ModelRoleAssignment {
        role: role.to_string(),
        selector: selector.to_string(),
        provider,
        model_id,
        thinking,
        short_label: short_label(selector),
    }
}

fn assignments_from_map(map: &Map<String, Value>) -> Vec<ModelRoleAssignment> {
    let mut roles = Vec::new();
    for (role, value) in map {
        let Some(selector) = value.as_str().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        roles.push(assignment_from_selector(role, selector));
    }
    sort_roles(&mut roles);
    roles
}

fn load_config_value(path: &Path) -> AppResult<Value> {
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_yaml::from_str(&raw)
        .map_err(|error| AppError::Msg(format!("failed to parse {}: {error}", path.display())))
}

pub fn load_model_roles() -> AppResult<ModelRolesSnapshot> {
    let path = resolve_config_path();
    if !path.exists() {
        return Ok(ModelRolesSnapshot {
            config_path: None,
            roles: Vec::new(),
        });
    }

    let value = load_config_value(&path)?;
    let mut roles = Vec::new();
    if let Some(map) = value
        .get("modelRoles")
        .and_then(Value::as_object)
        .or_else(|| value.get("model_roles").and_then(Value::as_object))
    {
        roles = assignments_from_map(map);
    }

    Ok(ModelRolesSnapshot {
        config_path: Some(path.display().to_string()),
        roles,
    })
}

pub fn set_model_role(role: &str, selector: &str) -> AppResult<ModelRolesSnapshot> {
    let role = role.trim();
    let selector = selector.trim();
    if role.is_empty() {
        return Err(AppError::Msg("role name cannot be empty".into()));
    }
    if selector.is_empty() {
        return Err(AppError::Msg("model selector cannot be empty".into()));
    }

    let path = resolve_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut value = load_config_value(&path)?;
    let root = value.as_object_mut().ok_or_else(|| {
        AppError::Msg(format!(
            "OMP config root must be a mapping: {}",
            path.display()
        ))
    })?;

    let roles_entry = root
        .entry("modelRoles".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let roles_map = roles_entry.as_object_mut().ok_or_else(|| {
        AppError::Msg("modelRoles in OMP config must be a mapping of role -> selector".into())
    })?;
    roles_map.insert(role.to_string(), Value::String(selector.to_string()));

    let serialized = serde_yaml::to_string(&value)
        .map_err(|error| AppError::Msg(format!("failed to serialize OMP config: {error}")))?;
    fs::write(&path, serialized)?;

    load_model_roles()
}

pub fn parse_available_models_response(response: &Value) -> Vec<AvailableModel> {
    let data = response.get("data").unwrap_or(response);
    let list = data
        .get("models")
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| data.as_array().cloned())
        .unwrap_or_default();

    let mut models = Vec::new();
    for item in list {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let provider = obj
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let id = obj
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if provider.is_empty() || id.is_empty() {
            continue;
        }
        let name = obj
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(&id)
            .to_string();
        let reasoning = obj
            .get("reasoning")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let thinking_efforts = obj
            .get("thinking")
            .and_then(Value::as_object)
            .and_then(|thinking| thinking.get("efforts"))
            .and_then(Value::as_array)
            .map(|efforts| {
                efforts
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        models.push(AvailableModel {
            selector: format!("{provider}/{id}"),
            provider,
            id,
            name,
            reasoning,
            thinking_efforts,
        });
    }

    models.sort_by(|a, b| {
        a.provider
            .cmp(&b.provider)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
    models
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parses_provider_model_thinking_selector() {
        let (provider, model, thinking) = parse_selector("xai-oauth/grok-4.5:xhigh");
        assert_eq!(provider.as_deref(), Some("xai-oauth"));
        assert_eq!(model.as_deref(), Some("grok-4.5"));
        assert_eq!(thinking.as_deref(), Some("xhigh"));
    }

    #[test]
    fn set_model_role_updates_yaml() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("omp-desktop-roles-set-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("config.yml"),
            "symbolPreset: unicode\nmodelRoles:\n  default: old/model:high\n  smol: keep/me:low\n",
        )
        .unwrap();

        unsafe {
            std::env::set_var("OMP_AGENT_DIR", &dir);
        }
        let snapshot = set_model_role("default", "xai-oauth/grok-4.5:xhigh").unwrap();
        unsafe {
            std::env::remove_var("OMP_AGENT_DIR");
        }

        assert!(snapshot
            .roles
            .iter()
            .any(|role| role.role == "default" && role.selector == "xai-oauth/grok-4.5:xhigh"));
        assert!(snapshot
            .roles
            .iter()
            .any(|role| role.role == "smol" && role.selector == "keep/me:low"));

        let raw = fs::read_to_string(dir.join("config.yml")).unwrap();
        assert!(raw.contains("xai-oauth/grok-4.5:xhigh"));
        assert!(raw.contains("keep/me:low"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn parse_available_models_response_reads_provider_lists() {
        let response = serde_json::json!({
            "data": {
                "models": [
                    {
                        "provider": "xai-oauth",
                        "id": "grok-4.5",
                        "name": "Grok 4.5",
                        "reasoning": true,
                        "thinking": { "efforts": ["low", "high", "xhigh"] }
                    },
                    {
                        "provider": "anthropic",
                        "id": "claude-sonnet",
                        "name": "Sonnet"
                    }
                ]
            }
        });
        let models = parse_available_models_response(&response);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].provider, "anthropic");
        assert_eq!(models[1].selector, "xai-oauth/grok-4.5");
        assert_eq!(models[1].thinking_efforts, vec!["low", "high", "xhigh"]);
    }
}
