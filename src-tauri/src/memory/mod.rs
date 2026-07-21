use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoleMemoryNote {
    pub id: i64,
    pub role: String,
    pub project_key: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub source_session_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoleScratchpad {
    pub role: String,
    pub project_key: String,
    pub content: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistentAgent {
    pub id: String,
    pub role: String,
    pub display_name: String,
    pub project_key: String,
    pub status: String,
    pub current_job: Option<String>,
    pub last_session_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobCard {
    pub id: String,
    pub project_key: String,
    pub project_label: String,
    pub title: String,
    pub detail: String,
    pub status: String,
    pub assignee_agent_id: Option<String>,
    pub assignee_role: Option<String>,
    pub session_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct MemoryStore {
    conn: Mutex<Connection>,
}

impl MemoryStore {
    pub fn open(path: PathBuf) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)
            .map_err(|error| AppError::Msg(format!("open memory db: {error}")))?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS role_notes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              role TEXT NOT NULL,
              project_key TEXT NOT NULL,
              kind TEXT NOT NULL,
              title TEXT NOT NULL,
              body TEXT NOT NULL,
              source_session_id TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_role_notes_lookup
              ON role_notes(role, project_key, updated_at DESC);

            CREATE TABLE IF NOT EXISTS role_scratchpads (
              role TEXT NOT NULL,
              project_key TEXT NOT NULL,
              content TEXT NOT NULL DEFAULT '',
              updated_at INTEGER NOT NULL,
              PRIMARY KEY(role, project_key)
            );

            CREATE TABLE IF NOT EXISTS agents (
              id TEXT PRIMARY KEY,
              role TEXT NOT NULL,
              display_name TEXT NOT NULL,
              project_key TEXT NOT NULL,
              status TEXT NOT NULL,
              current_job TEXT,
              last_session_id TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_agents_project
              ON agents(project_key, updated_at DESC);

            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY,
              project_key TEXT NOT NULL,
              project_label TEXT NOT NULL,
              title TEXT NOT NULL,
              detail TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL,
              assignee_agent_id TEXT,
              assignee_role TEXT,
              session_id TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_jobs_project
              ON jobs(project_key, updated_at DESC);
            "#,
        )
        .map_err(|error| AppError::Msg(format!("init memory schema: {error}")))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn list_role_notes(
        &self,
        role: &str,
        project_key: &str,
        limit: usize,
    ) -> AppResult<Vec<RoleMemoryNote>> {
        let conn = self.conn.lock().expect("memory db lock");
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, role, project_key, kind, title, body, source_session_id, created_at, updated_at
                FROM role_notes
                WHERE role = ?1 AND project_key = ?2
                ORDER BY updated_at DESC
                LIMIT ?3
                "#,
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![role, project_key, limit as i64], |row| {
                Ok(RoleMemoryNote {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    project_key: row.get(2)?,
                    kind: row.get(3)?,
                    title: row.get(4)?,
                    body: row.get(5)?,
                    source_session_id: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }

    pub fn add_role_note(
        &self,
        role: &str,
        project_key: &str,
        kind: &str,
        title: &str,
        body: &str,
        source_session_id: Option<&str>,
    ) -> AppResult<RoleMemoryNote> {
        let now = now_ms();
        let conn = self.conn.lock().expect("memory db lock");
        conn.execute(
            r#"
            INSERT INTO role_notes(role, project_key, kind, title, body, source_session_id, created_at, updated_at)
            VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
            "#,
            params![role, project_key, kind, title, body, source_session_id, now],
        )
        .map_err(db_err)?;
        let id = conn.last_insert_rowid();
        Ok(RoleMemoryNote {
            id,
            role: role.into(),
            project_key: project_key.into(),
            kind: kind.into(),
            title: title.into(),
            body: body.into(),
            source_session_id: source_session_id.map(str::to_string),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn delete_role_note(&self, id: i64) -> AppResult<()> {
        let conn = self.conn.lock().expect("memory db lock");
        conn.execute("DELETE FROM role_notes WHERE id = ?1", params![id])
            .map_err(db_err)?;
        Ok(())
    }

    pub fn get_scratchpad(&self, role: &str, project_key: &str) -> AppResult<RoleScratchpad> {
        let conn = self.conn.lock().expect("memory db lock");
        let mut stmt = conn
            .prepare(
                r#"
                SELECT role, project_key, content, updated_at
                FROM role_scratchpads
                WHERE role = ?1 AND project_key = ?2
                "#,
            )
            .map_err(db_err)?;
        let existing = stmt
            .query_row(params![role, project_key], |row| {
                Ok(RoleScratchpad {
                    role: row.get(0)?,
                    project_key: row.get(1)?,
                    content: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })
            .ok();
        Ok(existing.unwrap_or(RoleScratchpad {
            role: role.into(),
            project_key: project_key.into(),
            content: String::new(),
            updated_at: 0,
        }))
    }

    pub fn save_scratchpad(
        &self,
        role: &str,
        project_key: &str,
        content: &str,
    ) -> AppResult<RoleScratchpad> {
        let now = now_ms();
        let conn = self.conn.lock().expect("memory db lock");
        conn.execute(
            r#"
            INSERT INTO role_scratchpads(role, project_key, content, updated_at)
            VALUES(?1, ?2, ?3, ?4)
            ON CONFLICT(role, project_key) DO UPDATE SET
              content = excluded.content,
              updated_at = excluded.updated_at
            "#,
            params![role, project_key, content, now],
        )
        .map_err(db_err)?;
        Ok(RoleScratchpad {
            role: role.into(),
            project_key: project_key.into(),
            content: content.into(),
            updated_at: now,
        })
    }

    pub fn list_agents(&self, project_key: Option<&str>) -> AppResult<Vec<PersistentAgent>> {
        let conn = self.conn.lock().expect("memory db lock");
        let mut out = Vec::new();
        if let Some(project_key) = project_key {
            let mut stmt = conn
                .prepare(
                    r#"
                    SELECT id, role, display_name, project_key, status, current_job, last_session_id, created_at, updated_at
                    FROM agents
                    WHERE project_key = ?1
                    ORDER BY updated_at DESC
                    "#,
                )
                .map_err(db_err)?;
            let rows = stmt
                .query_map(params![project_key], map_agent)
                .map_err(db_err)?;
            for row in rows {
                out.push(row.map_err(db_err)?);
            }
        } else {
            let mut stmt = conn
                .prepare(
                    r#"
                    SELECT id, role, display_name, project_key, status, current_job, last_session_id, created_at, updated_at
                    FROM agents
                    ORDER BY updated_at DESC
                    LIMIT 200
                    "#,
                )
                .map_err(db_err)?;
            let rows = stmt.query_map([], map_agent).map_err(db_err)?;
            for row in rows {
                out.push(row.map_err(db_err)?);
            }
        }
        Ok(out)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_agent(
        &self,
        id: &str,
        role: &str,
        display_name: &str,
        project_key: &str,
        status: &str,
        current_job: Option<&str>,
        last_session_id: Option<&str>,
    ) -> AppResult<PersistentAgent> {
        let now = now_ms();
        let conn = self.conn.lock().expect("memory db lock");
        conn.execute(
            r#"
            INSERT INTO agents(id, role, display_name, project_key, status, current_job, last_session_id, created_at, updated_at)
            VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
            ON CONFLICT(id) DO UPDATE SET
              role = excluded.role,
              display_name = excluded.display_name,
              project_key = excluded.project_key,
              status = excluded.status,
              current_job = excluded.current_job,
              last_session_id = excluded.last_session_id,
              updated_at = excluded.updated_at
            "#,
            params![
                id,
                role,
                display_name,
                project_key,
                status,
                current_job,
                last_session_id,
                now
            ],
        )
        .map_err(db_err)?;
        Ok(PersistentAgent {
            id: id.into(),
            role: role.into(),
            display_name: display_name.into(),
            project_key: project_key.into(),
            status: status.into(),
            current_job: current_job.map(str::to_string),
            last_session_id: last_session_id.map(str::to_string),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list_jobs(&self, project_key: Option<&str>) -> AppResult<Vec<JobCard>> {
        let conn = self.conn.lock().expect("memory db lock");
        let mut out = Vec::new();
        if let Some(project_key) = project_key {
            let mut stmt = conn
                .prepare(
                    r#"
                    SELECT id, project_key, project_label, title, detail, status, assignee_agent_id, assignee_role, session_id, created_at, updated_at
                    FROM jobs
                    WHERE project_key = ?1
                    ORDER BY
                      CASE status
                        WHEN 'running' THEN 0
                        WHEN 'queued' THEN 1
                        WHEN 'blocked' THEN 2
                        WHEN 'done' THEN 3
                        ELSE 4
                      END,
                      updated_at DESC
                    "#,
                )
                .map_err(db_err)?;
            let rows = stmt
                .query_map(params![project_key], map_job)
                .map_err(db_err)?;
            for row in rows {
                out.push(row.map_err(db_err)?);
            }
        } else {
            let mut stmt = conn
                .prepare(
                    r#"
                    SELECT id, project_key, project_label, title, detail, status, assignee_agent_id, assignee_role, session_id, created_at, updated_at
                    FROM jobs
                    ORDER BY updated_at DESC
                    LIMIT 300
                    "#,
                )
                .map_err(db_err)?;
            let rows = stmt.query_map([], map_job).map_err(db_err)?;
            for row in rows {
                out.push(row.map_err(db_err)?);
            }
        }
        Ok(out)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_job(
        &self,
        id: &str,
        project_key: &str,
        project_label: &str,
        title: &str,
        detail: &str,
        status: &str,
        assignee_agent_id: Option<&str>,
        assignee_role: Option<&str>,
        session_id: Option<&str>,
    ) -> AppResult<JobCard> {
        let now = now_ms();
        let conn = self.conn.lock().expect("memory db lock");
        conn.execute(
            r#"
            INSERT INTO jobs(id, project_key, project_label, title, detail, status, assignee_agent_id, assignee_role, session_id, created_at, updated_at)
            VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
            ON CONFLICT(id) DO UPDATE SET
              project_key = excluded.project_key,
              project_label = excluded.project_label,
              title = excluded.title,
              detail = excluded.detail,
              status = excluded.status,
              assignee_agent_id = excluded.assignee_agent_id,
              assignee_role = excluded.assignee_role,
              session_id = excluded.session_id,
              updated_at = excluded.updated_at
            "#,
            params![
                id,
                project_key,
                project_label,
                title,
                detail,
                status,
                assignee_agent_id,
                assignee_role,
                session_id,
                now
            ],
        )
        .map_err(db_err)?;
        Ok(JobCard {
            id: id.into(),
            project_key: project_key.into(),
            project_label: project_label.into(),
            title: title.into(),
            detail: detail.into(),
            status: status.into(),
            assignee_agent_id: assignee_agent_id.map(str::to_string),
            assignee_role: assignee_role.map(str::to_string),
            session_id: session_id.map(str::to_string),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn ensure_default_agent_for_session(
        &self,
        session_id: &str,
        project_key: &str,
        project_label: &str,
        role: &str,
    ) -> AppResult<(PersistentAgent, JobCard)> {
        let _ = self.ensure_role_roster(project_key, project_label)?;
        let agent_id = format!("agent:{role}:{project_key}");
        let job_id = format!("job:{session_id}");
        let agent = self.upsert_agent(
            &agent_id,
            role,
            &role_display_name(role),
            project_key,
            "running",
            Some("Active desktop session"),
            Some(session_id),
        )?;
        let job = self.upsert_job(
            &job_id,
            project_key,
            project_label,
            &format!("{role} session"),
            "Desktop-hosted OMP session",
            "running",
            Some(&agent_id),
            Some(role),
            Some(session_id),
        )?;
        Ok((agent, job))
    }

    /// Seed the standard OMP role agents for a project so the job board is never empty.
    pub fn ensure_role_roster(
        &self,
        project_key: &str,
        project_label: &str,
    ) -> AppResult<Vec<PersistentAgent>> {
        let roles = [
            ("default", "Primary coding agent"),
            ("smol", "Fast / cheap helper"),
            ("slow", "Deep reasoning agent"),
            ("plan", "Planning agent"),
            ("task", "Task executor"),
            ("advisor", "Advisor / review agent"),
            ("tiny", "Lightweight background agent"),
            ("designer", "Design agent"),
            ("commit", "Commit message agent"),
            ("vision", "Vision agent"),
        ];
        let mut out = Vec::new();
        for (role, job) in roles {
            let agent_id = format!("agent:{role}:{project_key}");
            let agent = self.upsert_agent(
                &agent_id,
                role,
                &role_display_name(role),
                project_key,
                "idle",
                Some(job),
                None,
            )?;
            // Stable roster job card per role (not per session).
            let job_id = format!("role-job:{role}:{project_key}");
            let _ = self.upsert_job(
                &job_id,
                project_key,
                project_label,
                &format!("{role} · standing role"),
                job,
                "queued",
                Some(&agent_id),
                Some(role),
                None,
            )?;
            out.push(agent);
        }
        Ok(out)
    }

    pub fn mark_session_turn(
        &self,
        session_id: &str,
        project_key: &str,
        project_label: &str,
        role: &str,
        summary: &str,
    ) -> AppResult<()> {
        let agent_id = format!("agent:{role}:{project_key}");
        let _ = self.upsert_agent(
            &agent_id,
            role,
            &role_display_name(role),
            project_key,
            "idle",
            Some(summary),
            Some(session_id),
        )?;
        let job_id = format!("job:{session_id}");
        let _ = self.upsert_job(
            &job_id,
            project_key,
            project_label,
            &format!("{role} session"),
            summary,
            "running",
            Some(&agent_id),
            Some(role),
            Some(session_id),
        )?;
        Ok(())
    }
}

fn role_display_name(role: &str) -> String {
    match role {
        "default" => "Default agent".into(),
        "smol" => "Smol agent".into(),
        "slow" => "Slow agent".into(),
        "plan" => "Plan agent".into(),
        "task" => "Task agent".into(),
        "advisor" => "Advisor agent".into(),
        "tiny" => "Tiny agent".into(),
        "designer" => "Designer agent".into(),
        "commit" => "Commit agent".into(),
        "vision" => "Vision agent".into(),
        other => format!("{other} agent"),
    }
}

fn map_agent(row: &rusqlite::Row<'_>) -> rusqlite::Result<PersistentAgent> {
    Ok(PersistentAgent {
        id: row.get(0)?,
        role: row.get(1)?,
        display_name: row.get(2)?,
        project_key: row.get(3)?,
        status: row.get(4)?,
        current_job: row.get(5)?,
        last_session_id: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn map_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<JobCard> {
    Ok(JobCard {
        id: row.get(0)?,
        project_key: row.get(1)?,
        project_label: row.get(2)?,
        title: row.get(3)?,
        detail: row.get(4)?,
        status: row.get(5)?,
        assignee_agent_id: row.get(6)?,
        assignee_role: row.get(7)?,
        session_id: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn db_err(error: rusqlite::Error) -> AppError {
    AppError::Msg(format!("memory db: {error}"))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn default_memory_db_path() -> AppResult<PathBuf> {
    let base = dirs::data_dir().ok_or_else(|| AppError::Msg("no data dir".into()))?;
    Ok(base.join("omp-desktop").join("memory.db"))
}

pub fn project_key(cwd: &Path) -> String {
    cwd.to_string_lossy().replace('\\', "/")
}

pub fn project_label(cwd: &Path) -> String {
    cwd.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project")
        .to_string()
}

pub fn write_mnemopi_overlay(path: &Path) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = r#"# Generated by OMP Desktop — enables SQLite long-term memory for hosted sessions.
# Tuned for interactive latency: recall once, retain less often, modest injection.
memory:
  backend: mnemopi
mnemopi:
  scoping: per-project-tagged
  autoRecall: true
  # Retain is expensive; desktop triggers consolidation off the interactive path.
  autoRetain: false
  retainEveryNTurns: 99
  recallLimit: 6
  recallContextTurns: 2
  injectionTokenLimit: 2500
  polyphonicRecall: false
  enhancedRecall: false
  llmMode: none
"#;
    fs::write(path, body)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn scratchpad_and_notes_round_trip() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("omp-desktop-memory-{stamp}.db"));
        let store = MemoryStore::open(path.clone()).unwrap();
        let note = store
            .add_role_note(
                "default",
                "/tmp/proj",
                "interaction",
                "User feedback",
                "Prefer short diffs",
                Some("sess-1"),
            )
            .unwrap();
        assert!(note.id > 0);
        let notes = store.list_role_notes("default", "/tmp/proj", 10).unwrap();
        assert_eq!(notes.len(), 1);
        let pad = store
            .save_scratchpad("default", "/tmp/proj", "working on auth")
            .unwrap();
        assert_eq!(pad.content, "working on auth");
        let loaded = store.get_scratchpad("default", "/tmp/proj").unwrap();
        assert_eq!(loaded.content, "working on auth");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn agents_and_jobs_persist() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("omp-desktop-jobs-{stamp}.db"));
        let store = MemoryStore::open(path.clone()).unwrap();
        let (agent, job) = store
            .ensure_default_agent_for_session("sess-9", "/tmp/proj", "proj", "default")
            .unwrap();
        assert_eq!(agent.role, "default");
        assert_eq!(job.session_id.as_deref(), Some("sess-9"));
        // roster seeds standing role jobs + one session job
        assert!(store.list_jobs(Some("/tmp/proj")).unwrap().len() >= 11);
        assert!(store.list_agents(Some("/tmp/proj")).unwrap().len() >= 10);
        let _ = fs::remove_file(path);
    }
}
