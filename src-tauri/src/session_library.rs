use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

const DEFAULT_LIST_LIMIT: usize = 500;
const DEFAULT_SEARCH_LIMIT: usize = 50;
const MAX_LINE_BYTES: usize = 256 * 1024;
const SNIPPET_CHARS: usize = 160;
const ALIASES_FILE_NAME: &str = "omp-desktop-session-aliases.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoricSessionSummary {
    pub id: String,
    pub path: String,
    pub project: String,
    pub cwd: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
    pub model: Option<String>,
    pub size_bytes: u64,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchHit {
    pub session: HistoricSessionSummary,
    pub line: usize,
    pub snippet: String,
}

#[derive(Debug, Clone)]
pub struct SessionLibraryPaths {
    pub sessions: PathBuf,
    pub archived: PathBuf,
    pub aliases: PathBuf,
}

impl SessionLibraryPaths {
    pub fn from_home(home: &Path) -> Self {
        let agent = home.join(".omp").join("agent");
        Self::from_agent_dir(&agent)
    }

    pub fn from_agent_dir(agent: &Path) -> Self {
        Self {
            sessions: agent.join("sessions"),
            archived: agent.join("sessions-archived"),
            aliases: agent.join(ALIASES_FILE_NAME),
        }
    }

    pub fn from_dirs_home() -> AppResult<Self> {
        let home =
            dirs::home_dir().ok_or_else(|| AppError::Msg("home directory unavailable".into()))?;
        Ok(Self::from_home(&home))
    }
}

pub fn list_sessions(
    paths: &SessionLibraryPaths,
    include_archived: bool,
    limit: Option<usize>,
) -> AppResult<Vec<HistoricSessionSummary>> {
    let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).max(1);
    let aliases = load_aliases(&paths.aliases)?;
    let mut out = Vec::new();

    collect_sessions_under(&paths.sessions, false, &aliases, &mut out)?;
    if include_archived {
        collect_sessions_under(&paths.archived, true, &aliases, &mut out)?;
    }

    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.path.cmp(&b.path)));
    if out.len() > limit {
        out.truncate(limit);
    }
    Ok(out)
}

pub fn search_sessions(
    paths: &SessionLibraryPaths,
    query: &str,
    limit: Option<usize>,
) -> AppResult<Vec<SessionSearchHit>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(DEFAULT_SEARCH_LIMIT).max(1);
    let query_lower = query.to_lowercase();
    let aliases = load_aliases(&paths.aliases)?;
    let mut hits = Vec::new();

    search_root(
        &paths.sessions,
        false,
        &query_lower,
        &aliases,
        limit,
        &mut hits,
    )?;
    if hits.len() < limit {
        search_root(
            &paths.archived,
            true,
            &query_lower,
            &aliases,
            limit,
            &mut hits,
        )?;
    }
    Ok(hits)
}

pub fn archive_session(paths: &SessionLibraryPaths, path: &str) -> AppResult<()> {
    let source = resolve_contained_path(path, &[&paths.sessions])?;
    if !source.is_file() {
        return Err(AppError::Msg(format!(
            "session file not found: {}",
            source.display()
        )));
    }
    let rel = relative_to(&source, &paths.sessions)?;
    let dest = paths.archived.join(&rel);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    if dest.exists() {
        return Err(AppError::Msg(format!(
            "archived session already exists: {}",
            dest.display()
        )));
    }
    move_file(&source, &dest)?;
    rewrite_alias_key(&paths.aliases, &source, &dest)?;
    Ok(())
}

pub fn unarchive_session(paths: &SessionLibraryPaths, path: &str) -> AppResult<()> {
    let source = resolve_contained_path(path, &[&paths.archived])?;
    if !source.is_file() {
        return Err(AppError::Msg(format!(
            "archived session file not found: {}",
            source.display()
        )));
    }
    let rel = relative_to(&source, &paths.archived)?;
    let dest = paths.sessions.join(&rel);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    if dest.exists() {
        return Err(AppError::Msg(format!(
            "active session already exists: {}",
            dest.display()
        )));
    }
    move_file(&source, &dest)?;
    rewrite_alias_key(&paths.aliases, &source, &dest)?;
    Ok(())
}

pub fn delete_session(paths: &SessionLibraryPaths, path: &str) -> AppResult<()> {
    let target = resolve_contained_path(path, &[&paths.sessions, &paths.archived])?;
    if !target.is_file() {
        return Err(AppError::Msg(format!(
            "session file not found: {}",
            target.display()
        )));
    }
    fs::remove_file(&target)?;
    remove_alias_entry(&paths.aliases, &target)?;
    Ok(())
}

pub fn rename_session(paths: &SessionLibraryPaths, path: &str, title: &str) -> AppResult<()> {
    let target = resolve_contained_path(path, &[&paths.sessions, &paths.archived])?;
    if !target.is_file() {
        return Err(AppError::Msg(format!(
            "session file not found: {}",
            target.display()
        )));
    }
    let key = path_key(&target);
    let title = title.trim();
    let mut aliases = load_aliases(&paths.aliases)?;
    if title.is_empty() {
        aliases.remove(&key);
    } else {
        aliases.insert(key, title.to_string());
    }
    save_aliases_atomic(&paths.aliases, &aliases)?;
    Ok(())
}

fn collect_sessions_under(
    root: &Path,
    archived: bool,
    aliases: &HashMap<String, String>,
    out: &mut Vec<HistoricSessionSummary>,
) -> AppResult<()> {
    if !root.exists() {
        return Ok(());
    }
    let entries = walk_jsonl_files(root)?;
    for path in entries {
        match summarize_session_file(&path, root, archived, aliases) {
            Ok(summary) => out.push(summary),
            Err(error) => {
                log::warn!("skip session {}: {error}", path.display());
            }
        }
    }
    Ok(())
}

fn search_root(
    root: &Path,
    archived: bool,
    query_lower: &str,
    aliases: &HashMap<String, String>,
    limit: usize,
    hits: &mut Vec<SessionSearchHit>,
) -> AppResult<()> {
    if !root.exists() || hits.len() >= limit {
        return Ok(());
    }
    for path in walk_jsonl_files(root)? {
        if hits.len() >= limit {
            break;
        }
        let Ok(summary) = summarize_session_file(&path, root, archived, aliases) else {
            continue;
        };
        search_file_for_hits(&path, &summary, query_lower, limit, hits)?;
    }
    Ok(())
}

fn search_file_for_hits(
    path: &Path,
    summary: &HistoricSessionSummary,
    query_lower: &str,
    limit: usize,
    hits: &mut Vec<SessionSearchHit>,
) -> AppResult<()> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(()),
    };
    let reader = BufReader::new(file);
    for (index, line_result) in reader.lines().enumerate() {
        if hits.len() >= limit {
            break;
        }
        let Ok(line) = line_result else {
            continue;
        };
        if line.len() > MAX_LINE_BYTES || looks_binary(&line) {
            continue;
        }
        if !line.to_lowercase().contains(query_lower) {
            continue;
        }
        hits.push(SessionSearchHit {
            session: summary.clone(),
            line: index + 1,
            snippet: make_snippet(&line, query_lower),
        });
    }
    Ok(())
}

fn summarize_session_file(
    path: &Path,
    root: &Path,
    archived: bool,
    aliases: &HashMap<String, String>,
) -> AppResult<HistoricSessionSummary> {
    let meta = fs::metadata(path)?;
    let size_bytes = meta.len();
    let mtime = meta.modified().ok().and_then(system_time_to_rfc3339);

    let file = File::open(path)?;
    let reader = BufReader::new(file);

    let mut id = String::new();
    let mut cwd = String::new();
    let mut title: Option<String> = None;
    let mut created_at = String::new();
    let mut last_timestamp: Option<String> = None;
    let mut model: Option<String> = None;
    let mut message_count = 0usize;

    for line_result in reader.lines() {
        let Ok(line) = line_result else {
            continue;
        };
        if line.len() > MAX_LINE_BYTES || line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let entry_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        if let Some(ts) = value.get("timestamp").and_then(Value::as_str) {
            last_timestamp = Some(ts.to_string());
        } else if let Some(ts) = value.get("updatedAt").and_then(Value::as_str) {
            last_timestamp = Some(ts.to_string());
        }

        match entry_type {
            "session" => {
                if let Some(session_id) = value.get("id").and_then(Value::as_str) {
                    id = session_id.to_string();
                }
                if let Some(session_cwd) = value.get("cwd").and_then(Value::as_str) {
                    cwd = session_cwd.to_string();
                }
                if let Some(ts) = value.get("timestamp").and_then(Value::as_str) {
                    created_at = ts.to_string();
                }
                if let Some(session_title) = value.get("title").and_then(Value::as_str) {
                    let trimmed = session_title.trim();
                    if !trimmed.is_empty() {
                        title = Some(trimmed.to_string());
                    }
                }
            }
            "title" => {
                if let Some(session_title) = value.get("title").and_then(Value::as_str) {
                    let trimmed = session_title.trim();
                    if !trimmed.is_empty() {
                        title = Some(trimmed.to_string());
                    }
                }
            }
            "model_change" => {
                if let Some(model_name) = value.get("model").and_then(Value::as_str) {
                    let trimmed = model_name.trim();
                    if !trimmed.is_empty() {
                        model = Some(trimmed.to_string());
                    }
                }
            }
            "message" => {
                message_count = message_count.saturating_add(1);
            }
            _ => {}
        }
    }

    if id.is_empty() {
        id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();
    }
    if created_at.is_empty() {
        created_at = last_timestamp
            .clone()
            .or_else(|| mtime.clone())
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".into());
    }
    let updated_at = mtime
        .or(last_timestamp)
        .unwrap_or_else(|| created_at.clone());

    let path_str = path_key(path);
    if let Some(alias) = aliases.get(&path_str) {
        let trimmed = alias.trim();
        if !trimmed.is_empty() {
            title = Some(trimmed.to_string());
        }
    }

    Ok(HistoricSessionSummary {
        id,
        path: path_str,
        project: project_slug_for(path, root),
        cwd,
        title,
        created_at,
        updated_at,
        message_count,
        model,
        size_bytes,
        archived,
    })
}

fn project_slug_for(path: &Path, root: &Path) -> String {
    match path.strip_prefix(root) {
        Ok(rel) => rel
            .components()
            .next()
            .and_then(|c| match c {
                Component::Normal(s) => s.to_str().map(str::to_string),
                _ => None,
            })
            .unwrap_or_else(|| "unknown".into()),
        Err(_) => path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string(),
    }
}

fn walk_jsonl_files(root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let read_dir = match fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file()
                && path
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("jsonl"))
            {
                out.push(path);
            }
        }
    }
    out.sort();
    Ok(out)
}

fn resolve_contained_path(path: &str, roots: &[&Path]) -> AppResult<PathBuf> {
    if path.trim().is_empty() {
        return Err(AppError::Msg("path is required".into()));
    }
    let raw = PathBuf::from(path);
    if has_parent_escape(&raw) {
        return Err(AppError::Msg("path escapes session library roots".into()));
    }
    if !raw.is_absolute() {
        return Err(AppError::Msg("path must be absolute under session roots".into()));
    }

    let candidate = durable_path(&raw);
    for root in roots {
        let root_n = durable_path(root);
        if candidate.starts_with(&root_n) {
            return Ok(candidate);
        }
    }

    Err(AppError::Msg("path escapes session library roots".into()))
}

fn has_parent_escape(path: &Path) -> bool {
    path.components().any(|c| matches!(c, Component::ParentDir))
}

fn normalize_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
            Component::RootDir => out.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                let _ = out.pop();
            }
            Component::Normal(part) => out.push(part),
        }
    }
    out
}

/// Prefer a stable absolute form. On macOS temp paths, `/var` is a symlink to
/// `/private/var`; canonicalize when possible so joins/strips stay consistent.
fn durable_path(path: &Path) -> PathBuf {
    let normalized = normalize_lexically(path);
    if let Ok(canon) = normalize_existing(&normalized) {
        return canon;
    }
    normalized
}

fn normalize_existing(path: &Path) -> std::io::Result<PathBuf> {
    // Prefer full canonicalize when the path exists; otherwise canonicalize the
    // deepest existing ancestor and rejoin the remainder.
    if path.exists() {
        return path.canonicalize();
    }
    let mut ancestor = path.to_path_buf();
    let mut missing = Vec::new();
    while !ancestor.exists() {
        match ancestor.file_name() {
            Some(name) => {
                missing.push(name.to_os_string());
                ancestor.pop();
            }
            None => break,
        }
        if ancestor.as_os_str().is_empty() {
            break;
        }
    }
    if !ancestor.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "path ancestor missing",
        ));
    }
    let mut canon = ancestor.canonicalize()?;
    for part in missing.into_iter().rev() {
        canon.push(part);
    }
    Ok(canon)
}

fn relative_to(path: &Path, root: &Path) -> AppResult<PathBuf> {
    let path_n = durable_path(path);
    let root_n = durable_path(root);
    path_n
        .strip_prefix(&root_n)
        .map(|p| p.to_path_buf())
        .map_err(|_| AppError::Msg("path is not under expected root".into()))
}

fn move_file(source: &Path, dest: &Path) -> AppResult<()> {
    match fs::rename(source, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(source, dest)?;
            fs::remove_file(source)?;
            Ok(())
        }
    }
}

fn load_aliases(path: &Path) -> AppResult<HashMap<String, String>> {
    if !path.is_file() {
        return Ok(HashMap::new());
    }
    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(HashMap::new());
    }
    let map: HashMap<String, String> = serde_json::from_str(&raw)?;
    Ok(map)
}

fn save_aliases_atomic(path: &Path, aliases: &HashMap<String, String>) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(aliases)?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = File::create(&tmp)?;
        file.write_all(raw.as_bytes())?;
        file.write_all(b"\n")?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

fn rewrite_alias_key(aliases_path: &Path, from: &Path, to: &Path) -> AppResult<()> {
    let mut aliases = load_aliases(aliases_path)?;
    let from_key = path_key(from);
    let to_key = path_key(to);
    if let Some(title) = aliases.remove(&from_key) {
        aliases.insert(to_key, title);
        save_aliases_atomic(aliases_path, &aliases)?;
    }
    Ok(())
}

fn remove_alias_entry(aliases_path: &Path, path: &Path) -> AppResult<()> {
    let mut aliases = load_aliases(aliases_path)?;
    if aliases.remove(&path_key(path)).is_some() {
        save_aliases_atomic(aliases_path, &aliases)?;
    }
    Ok(())
}

fn path_key(path: &Path) -> String {
    durable_path(path).to_string_lossy().to_string()
}

fn make_snippet(line: &str, query_lower: &str) -> String {
    let lower = line.to_lowercase();
    let Some(idx) = lower.find(query_lower) else {
        return truncate_chars(line.trim(), SNIPPET_CHARS);
    };
    let start = idx.saturating_sub(40);
    let end = (idx + query_lower.len() + 80).min(line.len());
    let mut snippet = String::new();
    if start > 0 {
        snippet.push('…');
    }
    snippet.push_str(line[start..end].trim());
    if end < line.len() {
        snippet.push('…');
    }
    truncate_chars(&snippet, SNIPPET_CHARS)
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    let count = s.chars().count();
    if count <= max_chars {
        return s.to_string();
    }
    let trimmed: String = s.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{trimmed}…")
}

fn looks_binary(line: &str) -> bool {
    line.bytes().any(|b| b == 0)
}

fn system_time_to_rfc3339(time: SystemTime) -> Option<String> {
    let duration = time.duration_since(SystemTime::UNIX_EPOCH).ok()?;
    let secs = duration.as_secs() as i64;
    let millis = duration.subsec_millis();
    let days = secs.div_euclid(86_400);
    let day_secs = secs.rem_euclid(86_400) as u32;
    let (year, month, day) = civil_from_days(days);
    let hour = day_secs / 3600;
    let min = (day_secs % 3600) / 60;
    let sec = day_secs % 60;
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{millis:03}Z"
    ))
}

/// Howard Hinnant civil_from_days (proleptic Gregorian).
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_agent_dir() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("omp-desktop-session-lib-{stamp}-{n}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sessions")).unwrap();
        fs::create_dir_all(dir.join("sessions-archived")).unwrap();
        dir
    }

    fn fixture_jsonl() -> &'static str {
        r#"{"type":"session","version":3,"id":"abc","timestamp":"2026-07-20T02:00:43.455Z","cwd":"/tmp/demo"}
{"type":"title","v":1,"title":"Demo session"}
{"type":"model_change","model":"test/model"}
{"type":"message","message":{"role":"user","content":"hello searchable world"}}
{"type":"message","message":{"role":"assistant","content":"hi"}}
"#
    }

    fn write_fixture(agent: &Path, rel: &str) -> PathBuf {
        let path = agent.join("sessions").join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, fixture_jsonl()).unwrap();
        path
    }

    #[test]
    fn list_finds_fixture_jsonl_with_session_header_and_messages() {
        let agent = unique_agent_dir();
        let path = write_fixture(&agent, "demo-project/session.jsonl");
        let paths = SessionLibraryPaths::from_agent_dir(&agent);

        let listed = list_sessions(&paths, false, None).unwrap();
        assert_eq!(listed.len(), 1);
        let session = &listed[0];
        assert_eq!(session.id, "abc");
        assert_eq!(session.project, "demo-project");
        assert_eq!(session.cwd, "/tmp/demo");
        assert_eq!(session.title.as_deref(), Some("Demo session"));
        assert_eq!(session.created_at, "2026-07-20T02:00:43.455Z");
        assert_eq!(session.message_count, 2);
        assert_eq!(session.model.as_deref(), Some("test/model"));
        assert!(!session.archived);
        assert_eq!(session.path, path_key(&path));
        assert!(session.size_bytes > 0);

        let _ = fs::remove_dir_all(agent);
    }

    #[test]
    fn path_escape_is_rejected() {
        let agent = unique_agent_dir();
        let paths = SessionLibraryPaths::from_agent_dir(&agent);
        let outside = std::env::temp_dir().join("omp-desktop-not-a-session.jsonl");
        fs::write(&outside, "{}\n").unwrap();

        let err = archive_session(&paths, outside.to_str().unwrap()).unwrap_err();
        assert!(
            err.to_string().contains("escapes") || err.to_string().contains("path"),
            "unexpected error: {err}"
        );

        let nested_escape = paths
            .sessions
            .join("proj")
            .join("..")
            .join("..")
            .join("secrets.jsonl");
        let err = delete_session(&paths, &nested_escape.to_string_lossy()).unwrap_err();
        assert!(err.to_string().contains("escapes"), "unexpected error: {err}");

        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(agent);
    }

    #[test]
    fn archive_moves_file_and_list_include_archived_finds_it() {
        let agent = unique_agent_dir();
        let path = write_fixture(&agent, "demo-project/nested/session.jsonl");
        let paths = SessionLibraryPaths::from_agent_dir(&agent);

        archive_session(&paths, path.to_str().unwrap()).unwrap();
        assert!(!path.exists());

        let archived_path = paths
            .archived
            .join("demo-project/nested/session.jsonl");
        assert!(archived_path.is_file());

        let active = list_sessions(&paths, false, None).unwrap();
        assert!(active.is_empty());

        let all = list_sessions(&paths, true, None).unwrap();
        assert_eq!(all.len(), 1);
        assert!(all[0].archived);
        assert_eq!(all[0].path, path_key(&archived_path));

        let _ = fs::remove_dir_all(agent);
    }

    #[test]
    fn unarchive_restores_session() {
        let agent = unique_agent_dir();
        let path = write_fixture(&agent, "demo-project/session.jsonl");
        let paths = SessionLibraryPaths::from_agent_dir(&agent);

        archive_session(&paths, path.to_str().unwrap()).unwrap();
        let archived_path = paths.archived.join("demo-project/session.jsonl");
        unarchive_session(&paths, archived_path.to_str().unwrap()).unwrap();

        assert!(path.is_file());
        assert!(!archived_path.exists());
        let listed = list_sessions(&paths, false, None).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].archived);

        let _ = fs::remove_dir_all(agent);
    }

    #[test]
    fn search_finds_substring() {
        let agent = unique_agent_dir();
        let _path = write_fixture(&agent, "demo-project/session.jsonl");
        let paths = SessionLibraryPaths::from_agent_dir(&agent);

        let hits = search_sessions(&paths, "SEARCHABLE", Some(10)).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.to_lowercase().contains("searchable"));
        assert_eq!(hits[0].session.id, "abc");
        assert!(hits[0].line >= 1);

        let _ = fs::remove_dir_all(agent);
    }

    #[test]
    fn rename_alias_applied_on_list() {
        let agent = unique_agent_dir();
        let path = write_fixture(&agent, "demo-project/session.jsonl");
        let paths = SessionLibraryPaths::from_agent_dir(&agent);

        rename_session(&paths, path.to_str().unwrap(), "Alias Title").unwrap();
        let listed = list_sessions(&paths, false, None).unwrap();
        assert_eq!(listed[0].title.as_deref(), Some("Alias Title"));

        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("Demo session"));
        assert!(!raw.contains("Alias Title"));

        let _ = fs::remove_dir_all(agent);
    }

    #[test]
    fn delete_removes_file_and_alias() {
        let agent = unique_agent_dir();
        let path = write_fixture(&agent, "demo-project/session.jsonl");
        let paths = SessionLibraryPaths::from_agent_dir(&agent);

        rename_session(&paths, path.to_str().unwrap(), "To Delete").unwrap();
        assert!(paths.aliases.is_file());

        delete_session(&paths, path.to_str().unwrap()).unwrap();
        assert!(!path.exists());

        let aliases = load_aliases(&paths.aliases).unwrap();
        assert!(!aliases.contains_key(&path.to_string_lossy().to_string()));

        let listed = list_sessions(&paths, true, None).unwrap();
        assert!(listed.is_empty());

        let _ = fs::remove_dir_all(agent);
    }
}
