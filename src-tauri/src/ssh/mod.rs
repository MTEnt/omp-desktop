use crate::error::{AppError, AppResult};
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
    if let Ok(output) = Command::new(omp_bin)
        .args(["ssh", "list", "--json"])
        .output()
    {
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

    // 3) ~/.ssh/config Host entries (no wildcards)
    if let Ok(home) = home_dir() {
        let config_path = home.join(".ssh/config");
        if let Ok(raw) = fs::read_to_string(config_path) {
            for host in parse_ssh_config(&raw) {
                by_name.entry(host.name.clone()).or_insert(host);
            }
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

/// Minimal OpenSSH config parser for concrete Host blocks.
pub fn parse_ssh_config(raw: &str) -> Vec<SshHostInfo> {
    let mut out = Vec::new();
    let mut current_names: Vec<String> = Vec::new();
    let mut host: Option<String> = None;
    let mut user: Option<String> = None;
    let mut port: Option<u16> = None;
    let mut key_path: Option<String> = None;

    let flush = |names: &mut Vec<String>,
                 host: &mut Option<String>,
                 user: &mut Option<String>,
                 port: &mut Option<u16>,
                 key_path: &mut Option<String>,
                 out: &mut Vec<SshHostInfo>| {
        if names.is_empty() {
            return;
        }
        let hostname = host.clone().unwrap_or_else(|| names[0].clone());
        for name in names.drain(..) {
            if name.contains('*') || name.contains('?') || name.starts_with('!') {
                continue;
            }
            out.push(SshHostInfo {
                name: name.clone(),
                host: hostname.clone(),
                user: user.clone(),
                port: *port,
                key_path: key_path.clone(),
                description: Some("from ~/.ssh/config".into()),
                source: "ssh_config".into(),
                scope: None,
            });
        }
        *host = None;
        *user = None;
        *port = None;
        *key_path = None;
    };

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("host ") {
            flush(
                &mut current_names,
                &mut host,
                &mut user,
                &mut port,
                &mut key_path,
                &mut out,
            );
            current_names = trimmed[5..]
                .split_whitespace()
                .map(str::to_string)
                .collect();
            continue;
        }
        if current_names.is_empty() {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let key = parts.next().unwrap_or("").to_ascii_lowercase();
        let value = parts.next().unwrap_or("").trim();
        if value.is_empty() {
            continue;
        }
        match key.as_str() {
            "hostname" => host = Some(value.to_string()),
            "user" => user = Some(value.to_string()),
            "port" => {
                if let Ok(p) = value.parse::<u16>() {
                    port = Some(p);
                }
            }
            "identityfile" => {
                let expanded = expand_tilde(value);
                key_path = Some(expanded);
            }
            _ => {}
        }
    }
    flush(
        &mut current_names,
        &mut host,
        &mut user,
        &mut port,
        &mut key_path,
        &mut out,
    );
    out
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
        let raw = fs::read_to_string(&path)
            .map_err(|e| AppError::Msg(format!("read ssh.json: {e}")))?;
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
        username: user.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string),
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
        .map_err(|e| AppError::Msg(format!("create remote workspace: {e}")))?;

    let label = remote_label(target);
    let dest = ssh_destination(target);
    let agents = format!(
        r#"# Remote SSH session

This OMP Desktop session is connected to a remote host.

- **Host name:** `{host_name}`
- **SSH target:** `{dest}`
- **Remote folder:** `{remote_cwd}`
- **Label:** `{label}`

## How to work

1. Treat `{remote_cwd}` on `{dest}` as the project root.
2. Prefer OMP remote paths: `ssh://{host_name}{remote_path_suffix}` (and the `ssh` tool / configured host `{host_name}`).
3. Do not assume local disk paths refer to the remote machine unless they are `ssh://` URLs.
4. Before large edits, confirm the remote path exists via SSH tools.

## Connection notes

- Auth is expected via SSH keys / agent (BatchMode).
- POSIX remote shells are required for `ssh://` file IO.
"#,
        host_name = target.host_name,
        dest = dest,
        remote_cwd = target.remote_cwd,
        label = label,
        remote_path_suffix = if target.remote_cwd.starts_with('/') {
            target.remote_cwd.clone()
        } else if target.remote_cwd == "~" {
            String::new()
        } else {
            format!("/{}", target.remote_cwd.trim_start_matches("~/"))
        }
    );
    fs::write(base.join("AGENTS.md"), agents)
        .map_err(|e| AppError::Msg(format!("write remote AGENTS.md: {e}")))?;

    let readme = format!(
        "Remote workspace stub for OMP Desktop session {session_id}.\nRemote: {label}\n"
    );
    fs::write(base.join("README-remote.txt"), readme)
        .map_err(|e| AppError::Msg(format!("write remote readme: {e}")))?;

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

pub fn to_remote_session_info(target: &RemoteTarget, resolved_cwd: Option<String>) -> RemoteSessionInfo {
    let mut t = target.clone();
    if let Some(cwd) = resolved_cwd {
        t.remote_cwd = cwd;
    }
    RemoteSessionInfo {
        host_name: t.host_name.clone(),
        host: t.host.clone(),
        user: t.user.clone(),
        port: t.port,
        remote_cwd: t.remote_cwd.clone(),
        label: remote_label(&t),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }
}
