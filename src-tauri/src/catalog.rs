//! Read-only local inventory of MCP servers, task agents, and skills
//! discovered under `~/.omp` (and optional project cwd).
//!
//! Best-effort: missing paths and unknown formats produce empty lists + notes,
//! never panics or hard errors.

use serde::Serialize;
use serde_json::Value as JsonValue;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

/// One discovered catalog entry (MCP server, agent, or skill).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub id: String,
    pub name: String,
    pub source: String,
    pub detail: Option<String>,
}

/// Snapshot of local OMP-related catalogs.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSnapshot {
    pub mcp_servers: Vec<CatalogItem>,
    pub agents: Vec<CatalogItem>,
    pub skills: Vec<CatalogItem>,
    pub notes: Vec<String>,
}

impl CatalogSnapshot {
    fn empty() -> Self {
        Self {
            mcp_servers: Vec::new(),
            agents: Vec::new(),
            skills: Vec::new(),
            notes: Vec::new(),
        }
    }
}

/// Load a best-effort catalog from `home` (typically the user home dir) and an
/// optional project working directory.
///
/// Never panics. Missing files/dirs are skipped; parse failures add notes.
pub fn load_catalog(home: &Path, project_cwd: Option<&Path>) -> CatalogSnapshot {
    let mut snap = CatalogSnapshot::empty();
    let mut skill_seen = HashSet::new();
    let mut agent_seen = HashSet::new();
    let mut mcp_seen = HashSet::new();

    // --- MCP ---
    let mut mcp_paths: Vec<(PathBuf, String)> = Vec::new();
    if !home.as_os_str().is_empty() {
        mcp_paths.push((
            home.join(".omp/agent/mcp.json"),
            "omp-agent".to_string(),
        ));
        mcp_paths.push((home.join(".omp/mcp.json"), "omp-user".to_string()));
    }
    if let Some(cwd) = project_cwd.filter(|p| !p.as_os_str().is_empty()) {
        mcp_paths.push((cwd.join(".mcp.json"), "project".to_string()));
        mcp_paths.push((cwd.join("mcp.json"), "project".to_string()));
        mcp_paths.push((cwd.join(".omp/mcp.json"), "project-omp".to_string()));
        mcp_paths.push((cwd.join(".omp/agent/mcp.json"), "project-omp-agent".to_string()));
    }

    for (path, source) in mcp_paths {
        load_mcp_file(&path, &source, &mut snap, &mut mcp_seen);
    }

    // Also peek at agent config.yml for mcp-ish snippets (best-effort).
    if !home.as_os_str().is_empty() {
        let config_yml = home.join(".omp/agent/config.yml");
        let config_yaml = home.join(".omp/agent/config.yaml");
        let config_path = if config_yml.is_file() {
            Some(config_yml)
        } else if config_yaml.is_file() {
            Some(config_yaml)
        } else {
            None
        };
        if let Some(path) = config_path {
            load_mcp_from_settings(&path, "omp-settings", &mut snap, &mut mcp_seen);
        }
    }

    // --- Agents ---
    let mut agent_dirs: Vec<(PathBuf, String)> = Vec::new();
    if !home.as_os_str().is_empty() {
        agent_dirs.push((home.join(".omp/agent/agents"), "omp-user".to_string()));
        agent_dirs.push((home.join(".omp/agents"), "omp-root".to_string()));
        agent_dirs.push((home.join(".agents/agents"), "agents-user".to_string()));
    }
    if let Some(cwd) = project_cwd.filter(|p| !p.as_os_str().is_empty()) {
        agent_dirs.push((cwd.join(".omp/agents"), "project".to_string()));
        agent_dirs.push((cwd.join(".omp/agent/agents"), "project-agent".to_string()));
        agent_dirs.push((cwd.join(".agents/agents"), "project-agents".to_string()));
    }
    for (dir, source) in agent_dirs {
        scan_agents_dir(&dir, &source, &mut snap.agents, &mut agent_seen, &mut snap.notes);
    }

    // --- Skills ---
    let mut skill_dirs: Vec<(PathBuf, String)> = Vec::new();
    if !home.as_os_str().is_empty() {
        skill_dirs.push((home.join(".omp/agent/skills"), "omp-user".to_string()));
        skill_dirs.push((home.join(".agents/skills"), "agents-user".to_string()));
        skill_dirs.push((home.join(".claude/skills"), "claude-user".to_string()));
    }
    if let Some(cwd) = project_cwd.filter(|p| !p.as_os_str().is_empty()) {
        skill_dirs.push((cwd.join(".omp/skills"), "project".to_string()));
        skill_dirs.push((cwd.join(".omp/agent/skills"), "project-agent".to_string()));
        skill_dirs.push((cwd.join(".agents/skills"), "project-agents".to_string()));
        skill_dirs.push((cwd.join(".claude/skills"), "project-claude".to_string()));
    }
    for (dir, source) in skill_dirs {
        scan_skills_dir(&dir, &source, &mut snap.skills, &mut skill_seen);
    }

    snap.mcp_servers
        .sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    snap.agents
        .sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    snap.skills
        .sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));

    snap
}

fn load_mcp_file(
    path: &Path,
    source: &str,
    snap: &mut CatalogSnapshot,
    seen: &mut HashSet<String>,
) {
    if !path.is_file() {
        return;
    }
    let Ok(raw) = fs::read_to_string(path) else {
        snap.notes
            .push(format!("Unable to read MCP config {}", path.display()));
        return;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        snap.notes
            .push(format!("Empty MCP config {}", path.display()));
        return;
    }
    let parsed: Result<JsonValue, _> = serde_json::from_str(trimmed);
    let Ok(value) = parsed else {
        snap.notes.push(format!(
            "Unrecognized MCP format in {} (expected JSON with mcpServers)",
            path.display()
        ));
        return;
    };
    collect_mcp_servers(&value, source, &path.display().to_string(), snap, seen);
}

fn load_mcp_from_settings(
    path: &Path,
    source: &str,
    snap: &mut CatalogSnapshot,
    seen: &mut HashSet<String>,
) {
    let Ok(raw) = fs::read_to_string(path) else {
        return;
    };
    // Prefer YAML; fall back to JSON if the file happens to be JSON.
    let value = match serde_yaml::from_str::<JsonValue>(&raw) {
        Ok(v) => v,
        Err(_) => match serde_json::from_str::<JsonValue>(&raw) {
            Ok(v) => v,
            Err(_) => return,
        },
    };
    // Only surface when mcpServers (or mcp.servers) is present — silent otherwise.
    let has_mcp = value.get("mcpServers").is_some()
        || value
            .get("mcp")
            .and_then(|m| m.get("servers").or_else(|| m.get("mcpServers")))
            .is_some();
    if !has_mcp {
        return;
    }
    collect_mcp_servers(&value, source, &path.display().to_string(), snap, seen);
}

fn collect_mcp_servers(
    value: &JsonValue,
    source: &str,
    path_label: &str,
    snap: &mut CatalogSnapshot,
    seen: &mut HashSet<String>,
) {
    let servers = value
        .get("mcpServers")
        .or_else(|| value.get("servers"))
        .or_else(|| {
            value
                .get("mcp")
                .and_then(|m| m.get("servers").or_else(|| m.get("mcpServers")))
        });

    let Some(servers) = servers else {
        snap.notes.push(format!(
            "No mcpServers object in {path_label}; skipped"
        ));
        return;
    };

    match servers {
        JsonValue::Object(map) => {
            if map.is_empty() {
                snap.notes
                    .push(format!("mcpServers empty in {path_label}"));
            }
            for (name, cfg) in map {
                let key = format!("{source}:{name}").to_ascii_lowercase();
                if !seen.insert(key) {
                    continue;
                }
                let detail = mcp_detail(cfg);
                let enabled = cfg
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let mut detail = detail;
                if !enabled {
                    detail = Some(match detail {
                        Some(d) => format!("disabled · {d}"),
                        None => "disabled".to_string(),
                    });
                }
                snap.mcp_servers.push(CatalogItem {
                    id: format!("mcp:{source}:{name}"),
                    name: name.clone(),
                    source: source.to_string(),
                    detail,
                });
            }
        }
        JsonValue::Array(arr) => {
            for (idx, entry) in arr.iter().enumerate() {
                let name = entry
                    .get("name")
                    .and_then(|v| v.as_str())
                    .or_else(|| entry.get("id").and_then(|v| v.as_str()))
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("server-{idx}"));
                let key = format!("{source}:{name}").to_ascii_lowercase();
                if !seen.insert(key) {
                    continue;
                }
                snap.mcp_servers.push(CatalogItem {
                    id: format!("mcp:{source}:{name}"),
                    name,
                    source: source.to_string(),
                    detail: mcp_detail(entry),
                });
            }
        }
        _ => {
            snap.notes.push(format!(
                "Unrecognized mcpServers shape in {path_label}"
            ));
        }
    }
}

fn mcp_detail(cfg: &JsonValue) -> Option<String> {
    if let Some(cmd) = cfg.get("command").and_then(|v| v.as_str()) {
        let mut parts = vec![cmd.to_string()];
        if let Some(args) = cfg.get("args").and_then(|v| v.as_array()) {
            for a in args {
                if let Some(s) = a.as_str() {
                    parts.push(s.to_string());
                }
            }
        }
        return Some(parts.join(" "));
    }
    if let Some(url) = cfg.get("url").and_then(|v| v.as_str()) {
        let transport = cfg
            .get("type")
            .or_else(|| cfg.get("transport"))
            .and_then(|v| v.as_str())
            .unwrap_or("http");
        return Some(format!("{transport} · {url}"));
    }
    if let Some(t) = cfg
        .get("type")
        .or_else(|| cfg.get("transport"))
        .and_then(|v| v.as_str())
    {
        return Some(t.to_string());
    }
    None
}

fn scan_agents_dir(
    dir: &Path,
    source: &str,
    out: &mut Vec<CatalogItem>,
    seen: &mut HashSet<String>,
    notes: &mut Vec<String>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_file = path.is_file();
        let is_dir = path.is_dir();

        if is_file {
            let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if !name.ends_with(".md") {
                continue;
            }
            let stem = name.trim_end_matches(".md");
            if stem.is_empty() || stem.eq_ignore_ascii_case("readme") {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&path) else {
                notes.push(format!("Unable to read agent {}", path.display()));
                continue;
            };
            let (fm_name, description) = parse_md_frontmatter(&raw);
            let display = fm_name.unwrap_or_else(|| stem.to_string());
            let key = display.to_ascii_lowercase();
            if !seen.insert(key) {
                continue;
            }
            out.push(CatalogItem {
                id: format!("agent:{source}:{display}"),
                name: display,
                source: source.to_string(),
                detail: description.or_else(|| Some(path.display().to_string())),
            });
            continue;
        }

        if is_dir {
            // Directory-shaped agent: AGENT.md / agent.md inside.
            let agent_md = ["AGENT.md", "agent.md", "AGENTS.md"]
                .iter()
                .map(|n| path.join(n))
                .find(|p| p.is_file());
            let Some(md) = agent_md else {
                continue;
            };
            let folder = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("agent");
            let Ok(raw) = fs::read_to_string(&md) else {
                continue;
            };
            let (fm_name, description) = parse_md_frontmatter(&raw);
            let display = fm_name.unwrap_or_else(|| folder.to_string());
            let key = display.to_ascii_lowercase();
            if !seen.insert(key) {
                continue;
            }
            out.push(CatalogItem {
                id: format!("agent:{source}:{display}"),
                name: display,
                source: source.to_string(),
                detail: description.or_else(|| Some(md.display().to_string())),
            });
        }
    }
}

fn scan_skills_dir(
    dir: &Path,
    source: &str,
    out: &mut Vec<CatalogItem>,
    seen: &mut HashSet<String>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            // Also accept a bare SKILL.md? skip — OMP skills are directories.
            continue;
        }
        let skill_md = path.join("SKILL.md");
        let folder = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("skill")
            .to_string();

        if skill_md.is_file() {
            let Ok(raw) = fs::read_to_string(&skill_md) else {
                // Still surface the folder name.
                let key = folder.to_ascii_lowercase();
                if seen.insert(key) {
                    out.push(CatalogItem {
                        id: format!("skill:{source}:{folder}"),
                        name: folder.clone(),
                        source: source.to_string(),
                        detail: Some(path.display().to_string()),
                    });
                }
                continue;
            };
            let (fm_name, description) = parse_md_frontmatter(&raw);
            let display = fm_name.unwrap_or_else(|| folder.clone());
            let key = display.to_ascii_lowercase();
            if !seen.insert(key) {
                continue;
            }
            out.push(CatalogItem {
                id: format!("skill:{source}:{display}"),
                name: display,
                source: source.to_string(),
                detail: description.or_else(|| Some(skill_md.display().to_string())),
            });
        } else {
            // Shallow fallback: directory name only (no SKILL.md).
            let key = folder.to_ascii_lowercase();
            if !seen.insert(key) {
                continue;
            }
            out.push(CatalogItem {
                id: format!("skill:{source}:{folder}"),
                name: folder,
                source: source.to_string(),
                detail: Some(format!("{} (no SKILL.md)", path.display())),
            });
        }
    }
}

/// Minimal YAML-ish frontmatter parser for `name:` / `description:`.
fn parse_md_frontmatter(raw: &str) -> (Option<String>, Option<String>) {
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
            name = Some(unquote(v.trim()));
        } else if let Some(v) = line.strip_prefix("description:") {
            description = Some(unquote(v.trim()));
        }
    }
    (name, description)
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut f = fs::File::create(path).unwrap();
        f.write_all(body.as_bytes()).unwrap();
    }

    #[test]
    fn empty_home_returns_empty_snapshot() {
        let tmp = std::env::temp_dir().join(format!(
            "omp-catalog-empty-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let snap = load_catalog(&tmp, None);
        assert!(snap.mcp_servers.is_empty());
        assert!(snap.agents.is_empty());
        assert!(snap.skills.is_empty());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn loads_mcp_skills_and_agents_from_fixture() {
        let tmp = std::env::temp_dir().join(format!(
            "omp-catalog-full-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        write(
            &tmp.join(".omp/agent/mcp.json"),
            r#"{
              "mcpServers": {
                "context7": {
                  "command": "npx",
                  "args": ["-y", "@upstash/context7-mcp"]
                },
                "remote": {
                  "type": "http",
                  "url": "https://example.com/mcp",
                  "enabled": false
                }
              }
            }"#,
        );

        write(
            &tmp.join(".omp/agent/agents/scout.md"),
            "---\nname: scout\ndescription: Fast explorer\n---\n\nBody\n",
        );
        write(
            &tmp.join(".omp/agent/agents/reviewer.md"),
            "---\nname: reviewer\ndescription: Code review\n---\n",
        );

        write(
            &tmp.join(".omp/agent/skills/impeccable/SKILL.md"),
            "---\nname: impeccable\ndescription: Design system skill\n---\n",
        );
        // Dir without SKILL.md still listed shallowly.
        fs::create_dir_all(tmp.join(".agents/skills/find-skills")).unwrap();

        let project = tmp.join("proj");
        write(
            &project.join(".mcp.json"),
            r#"{"mcpServers":{"proj-mcp":{"command":"node","args":["server.js"]}}}"#,
        );
        write(
            &project.join(".omp/agents/custom.md"),
            "---\nname: custom\ndescription: Project agent\n---\n",
        );

        let snap = load_catalog(&tmp, Some(&project));

        assert_eq!(snap.mcp_servers.len(), 3);
        let names: Vec<_> = snap.mcp_servers.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"context7"));
        assert!(names.contains(&"remote"));
        assert!(names.contains(&"proj-mcp"));
        let remote = snap
            .mcp_servers
            .iter()
            .find(|s| s.name == "remote")
            .unwrap();
        assert!(
            remote
                .detail
                .as_deref()
                .unwrap_or("")
                .contains("disabled"),
            "remote should note disabled"
        );

        assert!(snap.agents.iter().any(|a| a.name == "scout"));
        assert!(snap.agents.iter().any(|a| a.name == "reviewer"));
        assert!(snap.agents.iter().any(|a| a.name == "custom"));

        assert!(snap.skills.iter().any(|s| s.name == "impeccable"));
        assert!(snap.skills.iter().any(|s| s.name == "find-skills"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn unknown_mcp_format_adds_note_not_crash() {
        let tmp = std::env::temp_dir().join(format!(
            "omp-catalog-bad-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        write(&tmp.join(".omp/agent/mcp.json"), "not-json {{{");
        let snap = load_catalog(&tmp, None);
        assert!(snap.mcp_servers.is_empty());
        assert!(
            snap.notes.iter().any(|n| n.contains("Unrecognized")),
            "notes={:?}",
            snap.notes
        );
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn missing_paths_do_not_note_noise() {
        let tmp = std::env::temp_dir().join(format!(
            "omp-catalog-missing-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let snap = load_catalog(&tmp, Some(&tmp.join("no-project")));
        assert!(snap.notes.is_empty(), "notes={:?}", snap.notes);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn serializes_camel_case() {
        let snap = CatalogSnapshot {
            mcp_servers: vec![CatalogItem {
                id: "mcp:x:y".into(),
                name: "y".into(),
                source: "x".into(),
                detail: Some("cmd".into()),
            }],
            agents: vec![],
            skills: vec![],
            notes: vec!["n".into()],
        };
        let v = serde_json::to_value(&snap).unwrap();
        assert!(v.get("mcpServers").is_some());
        assert!(v.get("agents").is_some());
        assert!(v.get("skills").is_some());
        assert!(v.get("notes").is_some());
        let item = &v["mcpServers"][0];
        assert_eq!(item["id"], "mcp:x:y");
        assert_eq!(item["name"], "y");
        assert_eq!(item["source"], "x");
        assert_eq!(item["detail"], "cmd");
    }
}
