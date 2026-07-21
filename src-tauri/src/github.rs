//! Best-effort GitHub snapshot via the `gh` CLI.
//!
//! Never panics. Missing `gh`, auth failures, and non-git dirs degrade to
//! `available: false` / `error` without tokens or secrets in the payload.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// Repository metadata from `gh repo view`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GhRepo {
    pub name_with_owner: String,
    pub description: Option<String>,
    pub url: String,
}

/// Issue row from `gh issue list`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GhIssue {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
    pub author: Option<String>,
}

/// Pull request row from `gh pr list`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GhPr {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
    pub is_draft: bool,
    pub author: Option<String>,
}

/// Full panel payload. `available` is false when `gh` is missing or unusable.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubSnapshot {
    pub available: bool,
    pub error: Option<String>,
    pub repo: Option<GhRepo>,
    pub issues: Vec<GhIssue>,
    pub prs: Vec<GhPr>,
}

impl GithubSnapshot {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            available: false,
            error: Some(message.into()),
            repo: None,
            issues: Vec::new(),
            prs: Vec::new(),
        }
    }

    fn ok(repo: Option<GhRepo>, issues: Vec<GhIssue>, prs: Vec<GhPr>) -> Self {
        Self {
            available: true,
            error: None,
            repo,
            issues,
            prs,
        }
    }

    fn partial(
        repo: Option<GhRepo>,
        issues: Vec<GhIssue>,
        prs: Vec<GhPr>,
        error: impl Into<String>,
    ) -> Self {
        Self {
            available: true,
            error: Some(error.into()),
            repo,
            issues,
            prs,
        }
    }
}

#[derive(Debug, Deserialize)]
struct GhAuthor {
    login: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRepo {
    name_with_owner: String,
    description: Option<String>,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawIssue {
    number: u64,
    title: String,
    state: String,
    url: String,
    #[serde(default)]
    author: Option<GhAuthor>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPr {
    number: u64,
    title: String,
    state: String,
    url: String,
    #[serde(default)]
    is_draft: bool,
    #[serde(default)]
    author: Option<GhAuthor>,
}

/// Load repo / issues / PRs for `cwd` using `gh`.
///
/// Never panics. Uses `gh -C <cwd>` only — no ambient process cwd mutation.
/// Does not return tokens or credentials.
pub async fn load_github_snapshot(cwd: &Path) -> GithubSnapshot {
    let cwd = cwd.to_path_buf();
    tokio::task::spawn_blocking(move || load_github_snapshot_blocking(&cwd))
        .await
        .unwrap_or_else(|error| {
            GithubSnapshot::unavailable(format!("github snapshot task failed: {error}"))
        })
}

fn load_github_snapshot_blocking(cwd: &Path) -> GithubSnapshot {
    if cwd.as_os_str().is_empty() {
        return GithubSnapshot::unavailable("cwd is empty");
    }

    let gh = match which::which("gh") {
        Ok(path) => path,
        Err(_) => {
            return GithubSnapshot::unavailable(
                "GitHub CLI (gh) not found on PATH. Install gh to browse issues and pull requests.",
            );
        }
    };

    let mut errors: Vec<String> = Vec::new();

    let repo = match run_gh(&gh, cwd, &["repo", "view", "--json", "nameWithOwner,description,url"])
    {
        Ok(stdout) => match parse_repo_json(&stdout) {
            Ok(repo) => Some(repo),
            Err(error) => {
                errors.push(format!("repo view: {error}"));
                None
            }
        },
        Err(error) => {
            // Repo view failure usually means not a GitHub repo / not authenticated.
            return GithubSnapshot::unavailable(error);
        }
    };

    let issues = match run_gh(
        &gh,
        cwd,
        &[
            "issue",
            "list",
            "--json",
            "number,title,state,url,author",
            "--limit",
            "20",
        ],
    ) {
        Ok(stdout) => match parse_issues_json(&stdout) {
            Ok(items) => items,
            Err(error) => {
                errors.push(format!("issue list: {error}"));
                Vec::new()
            }
        },
        Err(error) => {
            errors.push(format!("issue list: {error}"));
            Vec::new()
        }
    };

    let prs = match run_gh(
        &gh,
        cwd,
        &[
            "pr",
            "list",
            "--json",
            "number,title,state,url,isDraft,author",
            "--limit",
            "20",
        ],
    ) {
        Ok(stdout) => match parse_prs_json(&stdout) {
            Ok(items) => items,
            Err(error) => {
                errors.push(format!("pr list: {error}"));
                Vec::new()
            }
        },
        Err(error) => {
            errors.push(format!("pr list: {error}"));
            Vec::new()
        }
    };

    if errors.is_empty() {
        GithubSnapshot::ok(repo, issues, prs)
    } else {
        GithubSnapshot::partial(repo, issues, prs, errors.join("; "))
    }
}

fn run_gh(gh: &Path, cwd: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(gh);
    command.arg("-C").arg(cwd).args(args);
    // Never prompt for credentials in the desktop host.
    command.env("GH_PROMPT_DISABLED", "1");
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env_remove("GH_TOKEN");
    command.env_remove("GITHUB_TOKEN");

    let output = command
        .output()
        .map_err(|error| format!("failed to spawn gh: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = first_nonempty_line(stderr.as_ref())
            .or_else(|| first_nonempty_line(stdout.as_ref()))
            .unwrap_or("gh command failed")
            .to_string();
        return Err(sanitize_cli_error(&detail));
    }

    String::from_utf8(output.stdout).map_err(|error| format!("gh output was not utf-8: {error}"))
}

fn parse_repo_json(raw: &str) -> Result<GhRepo, String> {
    let parsed: RawRepo =
        serde_json::from_str(raw.trim()).map_err(|error| format!("invalid repo JSON: {error}"))?;
    if parsed.name_with_owner.trim().is_empty() || parsed.url.trim().is_empty() {
        return Err("repo JSON missing nameWithOwner or url".into());
    }
    Ok(GhRepo {
        name_with_owner: parsed.name_with_owner,
        description: parsed
            .description
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        url: parsed.url,
    })
}

fn parse_issues_json(raw: &str) -> Result<Vec<GhIssue>, String> {
    let parsed: Vec<RawIssue> =
        serde_json::from_str(raw.trim()).map_err(|error| format!("invalid issues JSON: {error}"))?;
    Ok(parsed
        .into_iter()
        .map(|item| GhIssue {
            number: item.number,
            title: item.title,
            state: item.state,
            url: item.url,
            author: item.author.and_then(|author| {
                author
                    .login
                    .map(|login| login.trim().to_string())
                    .filter(|login| !login.is_empty())
            }),
        })
        .collect())
}

fn parse_prs_json(raw: &str) -> Result<Vec<GhPr>, String> {
    let parsed: Vec<RawPr> =
        serde_json::from_str(raw.trim()).map_err(|error| format!("invalid prs JSON: {error}"))?;
    Ok(parsed
        .into_iter()
        .map(|item| GhPr {
            number: item.number,
            title: item.title,
            state: item.state,
            url: item.url,
            is_draft: item.is_draft,
            author: item.author.and_then(|author| {
                author
                    .login
                    .map(|login| login.trim().to_string())
                    .filter(|login| !login.is_empty())
            }),
        })
        .collect())
}

fn first_nonempty_line(text: &str) -> Option<&str> {
    text.lines().map(str::trim).find(|line| !line.is_empty())
}

/// Drop anything that looks like a bearer/token fragment from CLI stderr.
fn sanitize_cli_error(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("token") || lower.contains("bearer ") || lower.contains("authorization") {
        return "gh authentication failed or is not configured".into();
    }
    message.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_repo_fixture() {
        let raw = r#"{
          "nameWithOwner": "acme/widgets",
          "description": "Widget factory",
          "url": "https://github.com/acme/widgets"
        }"#;
        let repo = parse_repo_json(raw).expect("repo");
        assert_eq!(repo.name_with_owner, "acme/widgets");
        assert_eq!(repo.description.as_deref(), Some("Widget factory"));
        assert_eq!(repo.url, "https://github.com/acme/widgets");
    }

    #[test]
    fn parses_issues_fixture_with_author_object() {
        let raw = r#"[
          {
            "number": 42,
            "title": "Fix crash",
            "state": "OPEN",
            "url": "https://github.com/acme/widgets/issues/42",
            "author": { "login": "ada", "id": "1", "is_bot": false, "name": "Ada" }
          },
          {
            "number": 7,
            "title": "Docs",
            "state": "CLOSED",
            "url": "https://github.com/acme/widgets/issues/7",
            "author": null
          }
        ]"#;
        let issues = parse_issues_json(raw).expect("issues");
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].number, 42);
        assert_eq!(issues[0].author.as_deref(), Some("ada"));
        assert_eq!(issues[1].author, None);
        assert_eq!(issues[1].state, "CLOSED");
    }

    #[test]
    fn parses_prs_fixture_with_draft_flag() {
        let raw = r#"[
          {
            "number": 10,
            "title": "Add Linux support",
            "state": "OPEN",
            "url": "https://github.com/acme/widgets/pull/10",
            "isDraft": true,
            "author": { "login": "linus" }
          }
        ]"#;
        let prs = parse_prs_json(raw).expect("prs");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].number, 10);
        assert!(prs[0].is_draft);
        assert_eq!(prs[0].author.as_deref(), Some("linus"));
    }

    #[test]
    fn snapshot_serializes_camel_case_without_secrets() {
        let snap = GithubSnapshot::ok(
            Some(GhRepo {
                name_with_owner: "acme/widgets".into(),
                description: Some("demo".into()),
                url: "https://github.com/acme/widgets".into(),
            }),
            vec![GhIssue {
                number: 1,
                title: "Hello".into(),
                state: "OPEN".into(),
                url: "https://github.com/acme/widgets/issues/1".into(),
                author: Some("ada".into()),
            }],
            vec![GhPr {
                number: 2,
                title: "Feature".into(),
                state: "OPEN".into(),
                url: "https://github.com/acme/widgets/pull/2".into(),
                is_draft: false,
                author: None,
            }],
        );

        let value = serde_json::to_value(&snap).expect("serialize");
        assert_eq!(
            value,
            json!({
                "available": true,
                "error": null,
                "repo": {
                    "nameWithOwner": "acme/widgets",
                    "description": "demo",
                    "url": "https://github.com/acme/widgets"
                },
                "issues": [{
                    "number": 1,
                    "title": "Hello",
                    "state": "OPEN",
                    "url": "https://github.com/acme/widgets/issues/1",
                    "author": "ada"
                }],
                "prs": [{
                    "number": 2,
                    "title": "Feature",
                    "state": "OPEN",
                    "url": "https://github.com/acme/widgets/pull/2",
                    "isDraft": false,
                    "author": null
                }]
            })
        );
        let encoded = value.to_string();
        assert!(!encoded.to_ascii_lowercase().contains("token"));
        assert!(!encoded.contains("ghp_"));
        assert!(!encoded.contains("github_pat_"));
    }

    #[test]
    fn unavailable_snapshot_when_cwd_empty() {
        let snap = load_github_snapshot_blocking(Path::new(""));
        assert!(!snap.available);
        assert!(snap.error.as_deref().unwrap_or("").contains("empty"));
        assert!(snap.repo.is_none());
        assert!(snap.issues.is_empty());
        assert!(snap.prs.is_empty());
    }

    #[test]
    fn sanitize_strips_tokenish_errors() {
        assert_eq!(
            sanitize_cli_error("HTTP 401: Bad credentials (token ghp_secret)"),
            "gh authentication failed or is not configured"
        );
        assert_eq!(
            sanitize_cli_error("not a git repository"),
            "not a git repository"
        );
    }

    #[test]
    fn rejects_malformed_json_fixtures() {
        assert!(parse_repo_json("{").is_err());
        assert!(parse_issues_json("null").is_err());
        assert!(parse_prs_json("{\"number\":1}").is_err());
    }
}
