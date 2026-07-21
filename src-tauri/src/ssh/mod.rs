use crate::error::{AppError, AppResult};
use crate::settings;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshHostInfo {
    pub name: String,
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub key_path: Option<String>,
    pub description: Option<String>,
    /// `omp` | `ssh_config`
    pub source: String,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTarget {
    pub host_name: String,
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub key_path: Option<String>,
    pub remote_cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionInfo {
    pub host_name: String,
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub key_path: Option<String>,
    pub remote_cwd: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshProbeResult {
    pub ok: bool,
    pub message: String,
    pub remote_cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OmpSshListJson {
    #[serde(default)]
    project: BTreeMap<String, OmpHostEntry>,
    #[serde(default)]
    user: BTreeMap<String, OmpHostEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OmpHostEntry {
    host: String,
    #[serde(default)]
    username: Option<String>,
    #[serde(alias = "user")]
    user: Option<String>,
    port: Option<u16>,
    #[serde(alias = "key")]
    key_path: Option<String>,
    description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct OmpSshFile {
    #[serde(default)]
    hosts: BTreeMap<String, OmpHostWrite>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OmpHostWrite {
    host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    key_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

fn home_dir() -> AppResult<PathBuf> {
    dirs::home_dir().ok_or_else(|| AppError::Msg("home directory unavailable".into()))
}

fn omp_user_ssh_json() -> AppResult<PathBuf> {
    Ok(home_dir()?.join(".omp/agent/ssh.json"))
}

pub fn list_hosts(omp_bin: &Path) -> AppResult<Vec<SshHostInfo>> {
    let mut by_name: BTreeMap<String, SshHostInfo> = BTreeMap::new();

    // 1) omp ssh list --json (user + project relative to process cwd)
    let mut omp_command = Command::new(omp_bin);
    omp_command.args(["ssh", "list", "--json"]);
    if let Some(path) = settings::runtime_command_path(omp_bin) {
        omp_command.env("PATH", path);
    }
    if let Ok(output) = omp_command.output() {
        if output.status.success() {
            if let Ok(parsed) = serde_json::from_slice::<OmpSshListJson>(&output.stdout) {
                for (name, entry) in parsed.user {
                    by_name.insert(
                        name.clone(),
                        host_from_omp_entry(name, entry, "omp", Some("user")),
                    );
                }
                for (name, entry) in parsed.project {
                    by_name.insert(
                        name.clone(),
                        host_from_omp_entry(name, entry, "omp", Some("project")),
                    );
                }
            }
        }
    }

    // 2) Direct read of user ssh.json (covers cases where cwd differs)
    if let Ok(path) = omp_user_ssh_json() {
        if let Ok(raw) = fs::read_to_string(path) {
            if let Ok(file) = serde_json::from_str::<OmpSshFile>(&raw) {
                for (name, entry) in file.hosts {
                    by_name.entry(name.clone()).or_insert_with(|| SshHostInfo {
                        name,
                        host: entry.host,
                        user: entry.username,
                        port: entry.port,
                        key_path: entry.key_path,
                        description: entry.description,
                        source: "omp".into(),
                        scope: Some("user".into()),
                    });
                }
            }
        }
    }

    // 3) ~/.ssh/config Host entries (follows Include, skips wildcards)
    if let Ok(home) = home_dir() {
        let config_path = home.join(".ssh/config");
        for host in load_ssh_config_hosts(&config_path) {
            by_name.entry(host.name.clone()).or_insert(host);
        }
    }

    Ok(by_name.into_values().collect())
}

fn host_from_omp_entry(
    name: String,
    entry: OmpHostEntry,
    source: &str,
    scope: Option<&str>,
) -> SshHostInfo {
    SshHostInfo {
        name,
        host: entry.host,
        user: entry.username.or(entry.user),
        port: entry.port,
        key_path: entry.key_path,
        description: entry.description,
        source: source.into(),
        scope: scope.map(str::to_string),
    }
}

/// Load hosts from an OpenSSH config file, recursively resolving `Include`.
pub fn load_ssh_config_hosts(path: &Path) -> Vec<SshHostInfo> {
    let mut out = Vec::new();
    let mut seen_files = std::collections::HashSet::new();
    load_ssh_config_hosts_rec(path, &mut out, &mut seen_files, 0);
    out
}

fn load_ssh_config_hosts_rec(
    path: &Path,
    out: &mut Vec<SshHostInfo>,
    seen_files: &mut std::collections::HashSet<PathBuf>,
    depth: usize,
) {
    if depth > 8 || !path.is_file() {
        return;
    }
    let key = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if !seen_files.insert(key) {
        return;
    }
    let Ok(raw) = fs::read_to_string(path) else {
        return;
    };

    let base_dir = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    for include_path in collect_include_paths(&raw, &base_dir) {
        let lossy = include_path.to_string_lossy();
        if lossy.contains('*') {
            if let Some(parent) = include_path.parent() {
                let pattern = include_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("*");
                if let Ok(entries) = fs::read_dir(parent) {
                    for entry in entries.flatten() {
                        let name = entry.file_name();
                        let name = name.to_string_lossy();
                        if glob_match(pattern, &name) {
                            load_ssh_config_hosts_rec(&entry.path(), out, seen_files, depth + 1);
                        }
                    }
                }
            }
        } else {
            load_ssh_config_hosts_rec(&include_path, out, seen_files, depth + 1);
        }
    }

    out.extend(parse_ssh_config(&raw));
}

fn collect_include_paths(raw: &str, base_dir: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if !trimmed.to_ascii_lowercase().starts_with("include ") {
            continue;
        }
        let rest = trimmed[8..].trim();
        for token in rest.split_whitespace() {
            let expanded = expand_tilde(token);
            let path = PathBuf::from(&expanded);
            if path.is_absolute() {
                paths.push(path);
            } else {
                paths.push(base_dir.join(path));
            }
        }
    }
    paths
}

fn glob_match(pattern: &str, name: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some((pre, post)) = pattern.split_once('*') {
        return name.starts_with(pre)
            && name.ends_with(post)
            && name.len() >= pre.len() + post.len();
    }
    pattern == name
}

fn ssh_host_pattern_matches(pattern: &str, name: &str) -> bool {
    let pattern = pattern.as_bytes();
    let name = name.as_bytes();
    let mut previous = vec![false; name.len() + 1];
    previous[0] = true;
    let mut next = vec![false; name.len() + 1];

    for token in pattern {
        next.fill(false);
        match token {
            b'*' => {
                let mut matched = false;
                for index in 0..=name.len() {
                    matched |= previous[index];
                    next[index] = matched;
                }
            }
            b'?' => {
                next[1..(name.len() + 1)].copy_from_slice(&previous[..name.len()]);
            }
            expected => {
                for index in 0..name.len() {
                    next[index + 1] =
                        previous[index] && expected.eq_ignore_ascii_case(&name[index]);
                }
            }
        }
        std::mem::swap(&mut previous, &mut next);
    }
    previous[name.len()]
}

fn ssh_host_block_matches(patterns: &[String], name: &str) -> bool {
    let mut positive_match = false;
    for pattern in patterns {
        if let Some(negated) = pattern.strip_prefix('!') {
            if ssh_host_pattern_matches(negated, name) {
                return false;
            }
        } else if ssh_host_pattern_matches(pattern, name) {
            positive_match = true;
        }
    }
    positive_match
}

/// Minimal OpenSSH config parser for concrete Host blocks.
pub fn parse_ssh_config(raw: &str) -> Vec<SshHostInfo> {
    #[derive(Default)]
    struct Block {
        patterns: Vec<String>,
        host: Option<String>,
        user: Option<String>,
        port: Option<u16>,
        key_path: Option<String>,
    }

    let mut blocks = Vec::new();
    let mut current = Block {
        patterns: vec!["*".into()],
        ..Block::default()
    };
    let mut saw_host_block = false;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("host ") {
            let has_global_values = current.host.is_some()
                || current.user.is_some()
                || current.port.is_some()
                || current.key_path.is_some();
            if saw_host_block || has_global_values {
                blocks.push(current);
            }
            current = Block {
                patterns: trimmed[5..]
                    .split_whitespace()
                    .map(str::to_string)
                    .collect(),
                ..Block::default()
            };
            saw_host_block = true;
            continue;
        }

        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let key = parts.next().unwrap_or("").to_ascii_lowercase();
        let value = parts.next().unwrap_or("").trim();
        if value.is_empty() {
            continue;
        }
        match key.as_str() {
            "hostname" => current.host = Some(value.to_string()),
            "user" => current.user = Some(value.to_string()),
            "port" => {
                if let Ok(port) = value.parse::<u16>() {
                    current.port = Some(port);
                }
            }
            "identityfile" => current.key_path = Some(expand_tilde(value)),
            _ => {}
        }
    }
    if saw_host_block
        || current.host.is_some()
        || current.user.is_some()
        || current.port.is_some()
        || current.key_path.is_some()
    {
        blocks.push(current);
    }

    let mut names = Vec::new();
    for block in &blocks {
        for pattern in &block.patterns {
            if pattern.starts_with('!')
                || pattern.contains('*')
                || pattern.contains('?')
                || names.contains(pattern)
            {
                continue;
            }
            names.push(pattern.clone());
        }
    }

    names
        .into_iter()
        .map(|name| {
            let mut host = None;
            let mut user = None;
            let mut port = None;
            let mut key_path = None;
            for block in &blocks {
                if !ssh_host_block_matches(&block.patterns, &name) {
                    continue;
                }
                if host.is_none() {
                    host.clone_from(&block.host);
                }
                if user.is_none() {
                    user.clone_from(&block.user);
                }
                if port.is_none() {
                    port = block.port;
                }
                if key_path.is_none() {
                    key_path.clone_from(&block.key_path);
                }
            }
            SshHostInfo {
                host: host.unwrap_or_else(|| name.clone()).replace("%h", &name),
                name,
                user,
                port,
                key_path,
                description: Some("from ~/.ssh/config".into()),
                source: "ssh_config".into(),
                scope: None,
            }
        })
        .collect()
}

fn expand_tilde(value: &str) -> String {
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).display().to_string();
        }
    }
    if value == "~" {
        if let Some(home) = dirs::home_dir() {
            return home.display().to_string();
        }
    }
    value.to_string()
}

pub fn add_user_host(
    name: &str,
    host: &str,
    user: Option<&str>,
    port: Option<u16>,
    key_path: Option<&str>,
    description: Option<&str>,
) -> AppResult<SshHostInfo> {
    validate_host_name(name)?;
    if host.trim().is_empty() {
        return Err(AppError::Msg("host address is required".into()));
    }
    let path = omp_user_ssh_json()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AppError::Msg(format!("create ssh config dir: {e}")))?;
    }
    let mut file = if path.is_file() {
        let raw =
            fs::read_to_string(&path).map_err(|e| AppError::Msg(format!("read ssh.json: {e}")))?;
        serde_json::from_str::<OmpSshFile>(&raw)
            .map_err(|e| AppError::Msg(format!("parse ssh.json: {e}")))?
    } else {
        OmpSshFile::default()
    };
    if file.hosts.contains_key(name) {
        return Err(AppError::Msg(format!(
            "host \"{name}\" already exists in ~/.omp/agent/ssh.json"
        )));
    }
    let entry = OmpHostWrite {
        host: host.trim().to_string(),
        username: user
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        port,
        key_path: key_path
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(expand_tilde),
        description: description
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
    };
    file.hosts.insert(name.to_string(), entry.clone());
    let raw = serde_json::to_string_pretty(&file)?;
    fs::write(&path, raw).map_err(|e| AppError::Msg(format!("write ssh.json: {e}")))?;

    Ok(SshHostInfo {
        name: name.to_string(),
        host: entry.host,
        user: entry.username,
        port: entry.port,
        key_path: entry.key_path,
        description: entry.description,
        source: "omp".into(),
        scope: Some("user".into()),
    })
}

fn validate_host_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::Msg("invalid host name".into()));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(AppError::Msg(
            "host name can only contain letters, numbers, dash, underscore, and dot".into(),
        ));
    }
    Ok(())
}

pub fn ssh_destination(target: &RemoteTarget) -> String {
    match &target.user {
        Some(user) if !user.is_empty() => format!("{user}@{host}", host = target.host),
        _ => target.host.clone(),
    }
}

pub fn remote_label(target: &RemoteTarget) -> String {
    let dest = ssh_destination(target);
    format!("{dest}:{}", target.remote_cwd)
}

fn build_ssh_args(target: &RemoteTarget) -> Vec<String> {
    let mut args = vec![
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=8".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
    ];
    if let Some(port) = target.port {
        args.push("-p".into());
        args.push(port.to_string());
    }
    if let Some(key) = &target.key_path {
        if !key.is_empty() {
            args.push("-i".into());
            args.push(expand_tilde(key));
        }
    }
    // Prefer Host alias from ssh config when name differs and host equals name
    // Always pass explicit destination user@host for reliability.
    args.push("--".into());
    args.push(ssh_destination(target));
    args
}

pub fn probe_connection(target: &RemoteTarget) -> AppResult<SshProbeResult> {
    let remote_cwd = normalize_remote_cwd(&target.remote_cwd);
    let mut args = build_ssh_args(target);
    // Resolve path on remote and ensure it exists (or home).
    let remote_script = format!(
        "set -e; TARGET={cwd}; \
         if [ \"$TARGET\" = \"~\" ] || [ -z \"$TARGET\" ]; then TARGET=\"$HOME\"; fi; \
         case \"$TARGET\" in ~/*) TARGET=\"$HOME${{TARGET#\\~}}\";; esac; \
         if [ ! -d \"$TARGET\" ]; then echo \"MISSING:$TARGET\" >&2; exit 3; fi; \
         cd \"$TARGET\"; pwd -P",
        cwd = shell_single_quote(&remote_cwd)
    );
    args.push(remote_script);

    let output = Command::new("ssh")
        .args(&args)
        .output()
        .map_err(|e| AppError::Msg(format!("failed to spawn ssh: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() && !stdout.is_empty() {
        return Ok(SshProbeResult {
            ok: true,
            message: format!("Connected · {stdout}"),
            remote_cwd: Some(stdout),
        });
    }

    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("ssh failed with status {}", output.status)
    };

    Ok(SshProbeResult {
        ok: false,
        message,
        remote_cwd: None,
    })
}

fn normalize_remote_cwd(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        "~".into()
    } else {
        t.into()
    }
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r#"'\''"#))
}

pub fn prepare_remote_workspace(session_id: &str, target: &RemoteTarget) -> AppResult<PathBuf> {
    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| AppError::Msg("no local data dir".into()))?
        .join("omp-desktop")
        .join("remote-sessions")
        .join(session_id);
    fs::create_dir_all(&base)
        .map_err(|error| AppError::Msg(format!("create remote workspace: {error}")))?;

    let label = remote_label(target);
    let agents = remote_bootstrap_message(target)
        .replace("REMOTE SSH SESSION ACTIVE", "# Remote SSH session");
    if let Err(error) = fs::write(base.join("AGENTS.md"), agents) {
        let _ = fs::remove_dir_all(&base);
        return Err(AppError::Msg(format!("write remote AGENTS.md: {error}")));
    }

    let readme =
        format!("Remote workspace stub for OMP Desktop session {session_id}.\nRemote: {label}\n");
    if let Err(error) = fs::write(base.join("README-remote.txt"), readme) {
        let _ = fs::remove_dir_all(&base);
        return Err(AppError::Msg(format!("write remote readme: {error}")));
    }

    // Ensure host exists in user omp ssh.json so agent discovery finds it.
    let _ = ensure_host_registered(target);
    Ok(base)
}

fn ensure_host_registered(target: &RemoteTarget) -> AppResult<()> {
    let path = omp_user_ssh_json()?;
    let mut file = if path.is_file() {
        serde_json::from_str(&fs::read_to_string(&path)?)?
    } else {
        OmpSshFile::default()
    };
    let entry = OmpHostWrite {
        host: target.host.clone(),
        username: target.user.clone(),
        port: target.port,
        key_path: target.key_path.clone(),
        description: Some(format!("desktop remote · {}", target.remote_cwd)),
    };
    // Insert or refresh.
    file.hosts.insert(target.host_name.clone(), entry);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(&file)?)?;
    Ok(())
}

pub fn to_remote_session_info(
    target: &RemoteTarget,
    resolved_cwd: Option<String>,
) -> RemoteSessionInfo {
    let mut t = target.clone();
    if let Some(cwd) = resolved_cwd {
        t.remote_cwd = cwd;
    }
    RemoteSessionInfo {
        host_name: t.host_name.clone(),
        host: t.host.clone(),
        user: t.user.clone(),
        port: t.port,
        key_path: t.key_path.clone(),
        remote_cwd: t.remote_cwd.clone(),
        label: remote_label(&t),
    }
}

impl RemoteSessionInfo {
    pub fn to_target(&self) -> RemoteTarget {
        RemoteTarget {
            host_name: self.host_name.clone(),
            host: self.host.clone(),
            user: self.user.clone(),
            port: self.port,
            key_path: self.key_path.clone(),
            remote_cwd: self.remote_cwd.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirListing {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<RemoteDirEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshRecent {
    pub host_name: String,
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub key_path: Option<String>,
    pub remote_cwd: String,
    pub label: String,
    pub last_used_ms: u64,
}

fn recents_path() -> AppResult<PathBuf> {
    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| AppError::Msg("no local data dir".into()))?
        .join("omp-desktop");
    fs::create_dir_all(&base).map_err(|e| AppError::Msg(format!("create data dir: {e}")))?;
    Ok(base.join("ssh-recents.json"))
}

pub fn load_recents() -> AppResult<Vec<SshRecent>> {
    let path = recents_path()?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path).map_err(|e| AppError::Msg(format!("read recents: {e}")))?;
    let mut items: Vec<SshRecent> = serde_json::from_str(&raw).unwrap_or_default();
    items.sort_by(|a, b| b.last_used_ms.cmp(&a.last_used_ms));
    Ok(items)
}

pub fn push_recent(target: &RemoteTarget) -> AppResult<Vec<SshRecent>> {
    let mut items = load_recents().unwrap_or_default();
    let label = remote_label(target);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    items.retain(|item| {
        !(item.host_name == target.host_name && item.remote_cwd == target.remote_cwd)
    });
    items.insert(
        0,
        SshRecent {
            host_name: target.host_name.clone(),
            host: target.host.clone(),
            user: target.user.clone(),
            port: target.port,
            key_path: target.key_path.clone(),
            remote_cwd: target.remote_cwd.clone(),
            label,
            last_used_ms: now,
        },
    );
    items.truncate(12);
    let path = recents_path()?;
    fs::write(path, serde_json::to_string_pretty(&items)?)
        .map_err(|e| AppError::Msg(format!("write recents: {e}")))?;
    Ok(items)
}

pub fn list_remote_dir(target: &RemoteTarget, path: &str) -> AppResult<RemoteDirListing> {
    let requested = {
        let t = path.trim();
        if t.is_empty() {
            target.remote_cwd.clone()
        } else {
            t.to_string()
        }
    };
    let mut args = build_ssh_args(&RemoteTarget {
        remote_cwd: requested.clone(),
        ..target.clone()
    });
    // Reuse destination args but run listing script instead of probe script.
    // build_ssh_args currently ends with destination only? Check - it ends with dest then we push script in probe.
    // build_ssh_args returns args including destination. Good.
    let script = format!(
        "set -e; TARGET={cwd}; \
if [ \"$TARGET\" = '~' ] || [ -z \"$TARGET\" ]; then TARGET=\"$HOME\"; fi; \
case \"$TARGET\" in ~/*) TARGET=\"$HOME${{TARGET#\\~}}\";; esac; \
if [ ! -d \"$TARGET\" ]; then echo \"NOTDIR:$TARGET\" >&2; exit 3; fi; \
cd \"$TARGET\"; \
PWD=$(pwd -P); \
echo \"PWD:$PWD\"; \
if [ \"$PWD\" != '/' ]; then dirname \"$PWD\" | sed 's/^/PARENT:/'; fi; \
# entries: D|name or F|name
ls -A1 | while IFS= read -r name; do \
  if [ -d \"$name\" ]; then printf 'D|%s\\n' \"$name\"; else printf 'F|%s\\n' \"$name\"; fi; \
done",
        cwd = shell_single_quote(&requested)
    );
    args.push(script);

    let output = Command::new("ssh")
        .args(&args)
        .output()
        .map_err(|e| AppError::Msg(format!("failed to spawn ssh: {e}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(AppError::Msg(if stderr.is_empty() {
            format!("remote ls failed ({})", output.status)
        } else {
            stderr
        }));
    }

    let mut resolved = requested.clone();
    let mut parent = None;
    let mut entries = Vec::new();
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("PWD:") {
            resolved = rest.to_string();
            continue;
        }
        if let Some(rest) = line.strip_prefix("PARENT:") {
            let p = rest.trim();
            if !p.is_empty() {
                parent = Some(p.to_string());
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("D|") {
            let name = rest.to_string();
            if name == "." || name == ".." {
                continue;
            }
            let path = join_remote_path(&resolved, &name);
            entries.push(RemoteDirEntry {
                name,
                path,
                is_dir: true,
            });
            continue;
        }
        if let Some(rest) = line.strip_prefix("F|") {
            let name = rest.to_string();
            let path = join_remote_path(&resolved, &name);
            entries.push(RemoteDirEntry {
                name,
                path,
                is_dir: false,
            });
        }
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a
            .name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase()),
    });
    Ok(RemoteDirListing {
        path: resolved,
        parent,
        entries,
    })
}

fn join_remote_path(parent: &str, name: &str) -> String {
    if parent == "/" {
        format!("/{name}")
    } else {
        format!("{parent}/{name}")
    }
}

pub fn remote_bootstrap_message(target: &RemoteTarget) -> String {
    let label = remote_label(target);
    let dest = ssh_destination(target);
    format!(
        "REMOTE SSH SESSION ACTIVE\n\
\n\
You are working on a remote machine through OMP Desktop.\n\
\n\
- Host name: `{host}`\n\
- SSH target: `{dest}`\n\
- Remote project root: `{cwd}`\n\
- Label: `{label}`\n\
\n\
Hard rules for this session:\n\
1. Treat `{cwd}` on `{dest}` as the only project root.\n\
2. Use OMP host `{host}` and paths like `ssh://{host}{suffix}` for file tools.\n\
3. Do not edit or assume the local desktop stub workspace is the project.\n\
4. Prefer remote shell / SSH tools for commands on this machine.\n\
5. Before large changes, confirm remote paths exist.\n",
        host = target.host_name,
        dest = dest,
        cwd = target.remote_cwd,
        label = label,
        suffix = if target.remote_cwd.starts_with('/') {
            target.remote_cwd.clone()
        } else if target.remote_cwd == "~" {
            String::new()
        } else {
            format!("/{}", target.remote_cwd.trim_start_matches("~/"))
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parses_basic_ssh_config_hosts() {
        let raw = r#"
Host dev
  HostName 10.0.0.5
  User ubuntu
  Port 2222
  IdentityFile ~/.ssh/id_ed25519

Host *.skip
  HostName nowhere
"#;
        let hosts = parse_ssh_config(raw);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "dev");
        assert_eq!(hosts[0].host, "10.0.0.5");
        assert_eq!(hosts[0].user.as_deref(), Some("ubuntu"));
        assert_eq!(hosts[0].port, Some(2222));
        assert!(hosts[0]
            .key_path
            .as_deref()
            .unwrap_or("")
            .contains(".ssh/id_ed25519"));
    }

    #[test]
    fn concrete_hosts_inherit_wildcard_defaults() {
        let raw = r#"
Host production
  HostName prod.example.com

Host *
  User deploy
  Port 2202
  IdentityFile ~/.ssh/id_ed25519
"#;

        let hosts = parse_ssh_config(raw);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "production");
        assert_eq!(hosts[0].host, "prod.example.com");
        assert_eq!(hosts[0].user.as_deref(), Some("deploy"));
        assert_eq!(hosts[0].port, Some(2202));
        assert!(hosts[0]
            .key_path
            .as_deref()
            .unwrap_or_default()
            .contains(".ssh/id_ed25519"));
    }

    #[test]
    fn follows_include_directives() {
        let dir = std::env::temp_dir().join(format!(
            "omp-desktop-ssh-include-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let included = dir.join("extra.config");
        fs::write(
            &included,
            "Host from-include\n  HostName 1.2.3.4\n  User bob\n",
        )
        .unwrap();
        let main = dir.join("config");
        fs::write(
            &main,
            format!(
                "Include {}\n\nHost local-only\n  HostName 127.0.0.1\n",
                included.display()
            ),
        )
        .unwrap();
        let hosts = load_ssh_config_hosts(&main);
        let names: Vec<_> = hosts.iter().map(|h| h.name.as_str()).collect();
        assert!(names.contains(&"from-include"), "{names:?}");
        assert!(names.contains(&"local-only"), "{names:?}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn destination_includes_user() {
        let t = RemoteTarget {
            host_name: "dev".into(),
            host: "10.0.0.5".into(),
            user: Some("ubuntu".into()),
            port: Some(22),
            key_path: None,
            remote_cwd: "/var/www".into(),
        };
        assert_eq!(ssh_destination(&t), "ubuntu@10.0.0.5");
        assert_eq!(remote_label(&t), "ubuntu@10.0.0.5:/var/www");
        let args = build_ssh_args(&t);
        let terminator = args.iter().position(|arg| arg == "--").unwrap();
        assert_eq!(
            args.get(terminator + 1).map(String::as_str),
            Some("ubuntu@10.0.0.5"),
        );
    }
}
