use serde::Serialize;
use std::path::Path;
use std::process::Command;

/// Lightweight git snapshot for the shell status chip.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: Option<String>,
    pub dirty: bool,
    pub error: Option<String>,
}

impl GitStatus {
    fn ok(branch: Option<String>, dirty: bool) -> Self {
        Self {
            branch,
            dirty,
            error: None,
        }
    }

    fn err(message: impl Into<String>) -> Self {
        Self {
            branch: None,
            dirty: false,
            error: Some(message.into()),
        }
    }
}

/// Resolve branch name + dirty flag for `cwd`.
///
/// Never panics. On failure returns `error` populated and empty branch.
/// Uses `git -C <cwd>` only — no ambient process cwd mutation.
pub fn git_status(cwd: &Path) -> GitStatus {
    if cwd.as_os_str().is_empty() {
        return GitStatus::err("cwd is empty");
    }

    // Prefer `branch --show-current` — works on unborn HEAD (no commits yet).
    // Fall back to symbolic-ref / rev-parse for detached HEADs.
    let branch = match resolve_branch(cwd) {
        Ok(branch) => branch,
        Err(error) => return GitStatus::err(error),
    };

    let dirty = match run_git(cwd, &["status", "--porcelain"]) {
        Ok(stdout) => stdout.lines().any(|line| !line.trim().is_empty()),
        Err(error) => {
            // Branch resolved but dirty check failed — still show branch with error note.
            return GitStatus {
                branch,
                dirty: false,
                error: Some(error),
            };
        }
    };

    GitStatus::ok(branch, dirty)
}

fn resolve_branch(cwd: &Path) -> Result<Option<String>, String> {
    if let Ok(stdout) = run_git(cwd, &["branch", "--show-current"]) {
        let name = stdout.trim();
        if !name.is_empty() {
            return Ok(Some(name.to_string()));
        }
        // Empty output usually means detached HEAD.
        return Ok(detached_label(cwd));
    }

    if let Ok(stdout) = run_git(cwd, &["symbolic-ref", "--short", "HEAD"]) {
        let name = stdout.trim();
        if !name.is_empty() {
            return Ok(Some(name.to_string()));
        }
    }

    match run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Ok(stdout) => {
            let name = stdout.trim();
            if name.is_empty() || name == "HEAD" {
                Ok(detached_label(cwd).or(Some("HEAD".into())))
            } else {
                Ok(Some(name.to_string()))
            }
        }
        Err(error) => Err(error),
    }
}

fn detached_label(cwd: &Path) -> Option<String> {
    match run_git(cwd, &["rev-parse", "--short", "HEAD"]) {
        Ok(sha) => {
            let sha = sha.trim();
            if sha.is_empty() {
                None
            } else {
                Some(format!("detached@{sha}"))
            }
        }
        Err(_) => None,
    }
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(cwd).args(args);
    // Keep git quiet and non-interactive.
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env("GIT_OPTIONAL_LOCKS", "0");

    let output = command
        .output()
        .map_err(|error| format!("failed to spawn git: {error}"))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = first_nonempty_line(stderr.as_ref())
        .or_else(|| first_nonempty_line(stdout.as_ref()))
        .unwrap_or("git command failed")
        .to_string();
    Err(detail)
}

fn first_nonempty_line(text: &str) -> Option<&str> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("omp-git-status-{label}-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[test]
    fn serializes_camel_case() {
        let status = GitStatus::ok(Some("main".into()), true);
        let json = serde_json::to_value(&status).expect("serialize");
        assert_eq!(json["branch"], "main");
        assert_eq!(json["dirty"], true);
        assert!(json.get("error").unwrap().is_null() || json["error"].is_null());
    }

    #[test]
    fn empty_cwd_returns_error() {
        let status = git_status(Path::new(""));
        assert!(status.branch.is_none());
        assert!(!status.dirty);
        assert!(status.error.is_some());
    }

    #[test]
    fn non_repo_returns_error_without_panic() {
        if !git_available() {
            return;
        }
        let dir = temp_dir("norepo");
        let status = git_status(&dir);
        let _ = fs::remove_dir_all(&dir);
        assert!(status.branch.is_none());
        assert!(!status.dirty);
        assert!(status.error.is_some());
    }

    #[test]
    fn clean_repo_reports_branch() {
        if !git_available() {
            return;
        }
        let dir = temp_dir("clean");
        let init = Command::new("git")
            .args(["-C", dir.to_str().unwrap(), "init", "-b", "main"])
            .output()
            .expect("git init");
        assert!(init.status.success(), "git init failed: {:?}", init);

        // Identity for commit (not needed for clean empty repo branch).
        let status = git_status(&dir);
        let _ = fs::remove_dir_all(&dir);

        assert_eq!(status.branch.as_deref(), Some("main"));
        assert!(!status.dirty);
        assert!(status.error.is_none());
    }

    #[test]
    fn dirty_repo_sets_flag() {
        if !git_available() {
            return;
        }
        let dir = temp_dir("dirty");
        let dir_str = dir.to_str().unwrap();
        assert!(
            Command::new("git")
                .args(["-C", dir_str, "init", "-b", "feature"])
                .status()
                .expect("init")
                .success()
        );
        fs::write(dir.join("note.txt"), "hello").expect("write");
        let status = git_status(&dir);
        let _ = fs::remove_dir_all(&dir);

        assert_eq!(status.branch.as_deref(), Some("feature"));
        assert!(status.dirty);
        assert!(status.error.is_none());
    }
}
