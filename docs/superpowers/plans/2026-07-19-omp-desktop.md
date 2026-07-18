# OMP Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a macOS Apple Silicon Tauri 2 desktop cockpit that spawns `omp --mode rpc` per session tab, with Zen-default expandable UI, yolo-first trust, streaming chat, plan/activity/subagents panels, settings, and an app-owned PTY.

**Architecture:** Rust host owns process lifecycle, JSONL RPC, settings, and PTY. React/TS UI is presentation only (invoke + events). One `omp --mode rpc` child per tab. OMP remains source of truth for agent state.

**Tech Stack:** Tauri 2.10+, Rust 1.94+, React 19 + TypeScript + Vite, Zustand, `@tauri-apps/api`, portable-pty, tokio, serde_json, xterm.js

**Spec:** `docs/superpowers/specs/2026-07-19-omp-desktop-design.md`

**Git author for all commits in this repo:**
```bash
git -c user.name="MTEnt" -c user.email="stan.pav1388@gmail.com" commit ...
```

---

## File map (target)

```
omp-desktop/
  package.json                 # workspace root scripts → ui + tauri
  README.md
  ui/
    package.json
    vite.config.ts
    index.html
    src/
      main.tsx
      App.tsx
      styles.css
      app/
        shell.tsx              # zen layout, rails, drawers, pins
        rails.tsx
        palette.tsx
        layout-store.ts
      session/
        session-store.ts
        transcript.tsx
        composer.tsx
        types.ts
      panels/
        sessions-panel.tsx
        project-panel.tsx
        plan-panel.tsx
        activity-panel.tsx
        subagents-panel.tsx
        settings-panel.tsx
        terminal-panel.tsx
      lib/
        tauri.ts               # typed invoke wrappers
        format.ts
  src-tauri/
    Cargo.toml
    tauri.conf.json
    capabilities/default.json
    src/
      lib.rs                   # tauri builder, manage state, handlers
      main.rs
      error.rs
      settings/
        mod.rs
      rpc/
        mod.rs                 # types + frame parse
        client.rs              # JSONL client
      session/
        mod.rs                 # SessionManager, Tab, spawn args
      pty/
        mod.rs
      commands/
        mod.rs                 # all #[tauri::command]
  src-tauri/tests/             # optional integration later
```

---

### Task 1: Scaffold Tauri 2 + React/Vite app

**Files:**
- Create: full Tauri/Vite tree under the project root
- Modify: `.gitignore` (keep existing entries; add Tauri/node defaults if missing)
- Create: `README.md` (minimal dev instructions)

- [ ] **Step 1: Scaffold in place without wiping git/docs**

```bash

# Frontend in ui/
npm create vite@latest ui -- --template react-ts
cd ui && npm install && npm install @tauri-apps/api @tauri-apps/plugin-shell @tauri-apps/plugin-dialog @tauri-apps/plugin-process zustand xterm @xterm/addon-fit
cd ..

# Init tauri into repo root (creates src-tauri/). If interactive prompts appear,
# use: app name omp-desktop, window title OMP Desktop, frontend dist ../ui/dist,
# dev server http://localhost:5173, beforeDevCommand from ui folder.
npm install -D @tauri-apps/cli@2
npx tauri init --ci \
  --app-name "omp-desktop" \
  --window-title "OMP Desktop" \
  --dev-url http://localhost:5173 \
  --before-dev-command "npm --prefix ui run dev" \
  --before-build-command "npm --prefix ui run build" \
  --frontend-dist ../ui/dist
```

If `tauri init --ci` flags differ on CLI 2.10, run `npx tauri init --help` and map equivalent non-interactive flags. Do **not** delete `docs/` or `.git`.

- [ ] **Step 2: Fix Vite config for Tauri**

`ui/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2022", "chrome120", "safari17"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
```

- [ ] **Step 3: Root package scripts**

Root `package.json`:
```json
{
  "name": "omp-desktop",
  "private": true,
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "ui:dev": "npm --prefix ui run dev",
    "ui:build": "npm --prefix ui run build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.10.1"
  }
}
```

- [ ] **Step 4: Smoke `tauri dev` window**

```bash
 npm run dev
```
Expected: native window loads Vite React template without Rust compile errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git -c user.name="MTEnt" -c user.email="stan.pav1388@gmail.com" commit -m "$(cat <<'EOF'
chore: scaffold Tauri 2 + React/Vite app shell

Initialize macOS desktop host and ui/ frontend without agent logic yet.
EOF
)"
git push origin main
```

---

### Task 2: Rust error type + settings store

**Files:**
- Create: `src-tauri/src/error.rs`
- Create: `src-tauri/src/settings/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: unit tests inside `settings/mod.rs`

- [ ] **Step 1: Add deps to `src-tauri/Cargo.toml`**

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
thiserror = "2"
uuid = { version = "1", features = ["v4", "serde"] }
parking_lot = "0.12"
dirs = "6"
which = "7"
portable-pty = "0.9"
```

Keep existing tauri build deps; merge don't clobber.

- [ ] **Step 2: Write `error.rs`**

```rust
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl From<String> for AppError {
    fn from(value: String) -> Self {
        Self::Msg(value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        Self::Msg(value.to_string())
    }
}
```

- [ ] **Step 3: Write failing settings test + implementation in `settings/mod.rs`**

```rust
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalMode {
    Yolo,
    Write,
    AlwaysAsk,
}

impl Default for ApprovalMode {
    fn default() -> Self {
        Self::Yolo
    }
}

impl ApprovalMode {
    pub fn as_cli_value(&self) -> &'static str {
        match self {
            Self::Yolo => "yolo",
            Self::Write => "write",
            Self::AlwaysAsk => "always-ask",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub approval_mode: ApprovalMode,
    pub omp_binary: Option<String>,
    pub default_model: Option<String>,
    pub default_thinking: Option<String>,
    pub default_profile: Option<String>,
    pub theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            approval_mode: ApprovalMode::Yolo,
            omp_binary: None,
            default_model: None,
            default_thinking: None,
            default_profile: None,
            theme: "dark".into(),
        }
    }
}

pub fn settings_path_for(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

pub fn load_settings(config_dir: &Path) -> AppResult<AppSettings> {
    let path = settings_path_for(config_dir);
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}

pub fn save_settings(config_dir: &Path, settings: &AppSettings) -> AppResult<()> {
    fs::create_dir_all(config_dir)?;
    let path = settings_path_for(config_dir);
    let raw = serde_json::to_string_pretty(settings)?;
    fs::write(path, raw)?;
    Ok(())
}

pub fn resolve_omp_binary(settings: &AppSettings) -> AppResult<PathBuf> {
    if let Some(p) = &settings.omp_binary {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Ok(path);
        }
        return Err(AppError::Msg(format!("omp binary not found at {}", path.display())));
    }
    which::which("omp").map_err(|_| AppError::Msg(
        "omp not found on PATH; set omp binary path in Settings".into(),
    ))
}

pub fn default_config_dir() -> AppResult<PathBuf> {
    let base = dirs::config_dir().ok_or_else(|| AppError::Msg("no config dir".into()))?;
    Ok(base.join("omp-desktop"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_dir() -> PathBuf {
        let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let p = std::env::temp_dir().join(format!("omp-desktop-settings-{n}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn default_is_yolo() {
        assert_eq!(AppSettings::default().approval_mode, ApprovalMode::Yolo);
        assert_eq!(ApprovalMode::Yolo.as_cli_value(), "yolo");
    }

    #[test]
    fn round_trip_settings() {
        let dir = tmp_dir();
        let mut s = AppSettings::default();
        s.default_model = Some("opus".into());
        s.approval_mode = ApprovalMode::Write;
        save_settings(&dir, &s).unwrap();
        let loaded = load_settings(&dir).unwrap();
        assert_eq!(loaded, s);
        let _ = fs::remove_dir_all(dir);
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd ./src-tauri && cargo test settings:: -- --nocapture
```
Expected: PASS (`default_is_yolo`, `round_trip_settings`)

- [ ] **Step 5: Wire modules in `lib.rs` (minimal)**

```rust
mod error;
mod settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri
git -c user.name="MTEnt" -c user.email="stan.pav1388@gmail.com" commit -m "$(cat <<'EOF'
feat: add app settings store with yolo default

Persist approval mode and omp binary path under the user config dir.
EOF
)"
```

---

### Task 3: RPC JSONL types + client (unit-tested)

**Files:**
- Create: `src-tauri/src/rpc/mod.rs`
- Create: `src-tauri/src/rpc/client.rs`
- Modify: `src-tauri/src/lib.rs` (`mod rpc;`)

- [ ] **Step 1: Write `rpc/mod.rs` types**

```rust
mod client;

pub use client::RpcClient;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcResponse {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub kind: String, // "response"
    pub command: String,
    pub success: bool,
    pub data: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PromptCommand<'a> {
    pub id: &'a str,
    #[serde(rename = "type")]
    pub kind: &'static str, // "prompt"
    pub message: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streaming_behavior: Option<&'a str>,
}

pub fn parse_frame(line: &str) -> Result<Value, serde_json::Error> {
    serde_json::from_str(line.trim())
}

pub fn frame_type(frame: &Value) -> Option<&str> {
    frame.get("type").and_then(|v| v.as_str())
}

pub fn frame_id(frame: &Value) -> Option<&str> {
    frame.get("id").and_then(|v| v.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ready_frame() {
        let v = parse_frame(r#"{"type":"ready"}"#).unwrap();
        assert_eq!(frame_type(&v), Some("ready"));
    }

    #[test]
    fn parse_response_frame() {
        let v = parse_frame(
            r#"{"id":"req_1","type":"response","command":"prompt","success":true,"data":{"agentInvoked":true}}"#,
        )
        .unwrap();
        assert_eq!(frame_id(&v), Some("req_1"));
        assert_eq!(frame_type(&v), Some("response"));
    }
}
```

- [ ] **Step 2: Write `rpc/client.rs` with mockable IO test using tokio duplex or a scripted child**

Implement `RpcClient` that:

1. Holds `ChildStdin` / framed stdout reader on a background task.
2. Generates ids `req_{n}`.
3. Sends one JSON object + `\n` per command.
4. On each stdout line: if `type==response` and id matches pending oneshot, complete it; else forward `Value` to an `tokio::sync::mpsc::UnboundedSender<Value>` event channel.
5. `wait_ready()` resolves on first `type==ready` (also via event channel or oneshot).
6. `request(cmd_type, body_without_id)` merges id+type and waits for response with timeout.

Minimal shape:

```rust
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::{timeout, Duration};

#[derive(Debug)]
pub struct RpcClient {
    child: Child,
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    pub events: mpsc::UnboundedReceiver<Value>,
    // events_tx cloned into reader task — store only receiver in struct after split
}

pub struct RpcHandle {
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    next_id: Arc<AtomicU64>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
}

// Prefer splitting: Session keeps writer handle + events receiver.
```

For tests without real omp, add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Spawn `#!/bin/sh` python/node script that:
    // 1) prints {"type":"ready"}
    // 2) reads lines; for each with id, replies response success
    // Use `Command::new("node")` with `-e` script for portability on this machine.
}
```

Node mock script behavior:
- write `{"type":"ready"}\n` immediately
- on stdin line JSON: if has `id`, write `{"id":...,"type":"response","command": <type>, "success":true}\n`
- if message contains `echo-event`, also write `{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hi"}}\n`

- [ ] **Step 3: Test client against mock**

```bash
cd src-tauri && cargo test rpc:: -- --nocapture
```
Expected: ready + request correlation + event forward PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/rpc src-tauri/src/lib.rs
git -c user.name="MTEnt" -c user.email="stan.pav1388@gmail.com" commit -m "$(cat <<'EOF'
feat: add OMP JSONL RPC client

Correlate request ids, wait for ready, and fan out session events.
EOF
)"
```

---

### Task 4: Session supervisor (spawn omp per tab)

**Files:**
- Create: `src-tauri/src/session/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Define session types + spawn argv builder (TDD)**

```rust
use crate::error::{AppError, AppResult};
use crate::rpc::RpcClient;
use crate::settings::{ApprovalMode, AppSettings};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub cwd: PathBuf,
    pub profile: Option<String>,
    pub status: SessionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Starting,
    Ready,
    Error,
    Exited,
}

pub struct SessionTab {
    pub info: SessionInfo,
    pub rpc: RpcClient,
}

pub fn build_omp_args(
    cwd: &Path,
    settings: &AppSettings,
    resume: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "--mode".into(),
        "rpc".into(),
        "--cwd".into(),
        cwd.display().to_string(),
        "--approval-mode".into(),
        settings.approval_mode.as_cli_value().into(),
    ];
    if settings.approval_mode == ApprovalMode::Yolo {
        args.push("--auto-approve".into());
    }
    if let Some(p) = &settings.default_profile {
        args.push("--profile".into());
        args.push(p.clone());
    }
    if let Some(m) = &settings.default_model {
        args.push("--model".into());
        args.push(m.clone());
    }
    if let Some(t) = &settings.default_thinking {
        args.push("--thinking".into());
        args.push(t.clone());
    }
    if let Some(r) = resume {
        args.push("--resume".into());
        args.push(r.into());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yolo_args_include_auto_approve() {
        let s = AppSettings::default();
        let args = build_omp_args(Path::new("/tmp/proj"), &s, None);
        assert!(args.windows(2).any(|w| w == ["--mode", "rpc"]));
        assert!(args.windows(2).any(|w| w == ["--approval-mode", "yolo"]));
        assert!(args.iter().any(|a| a == "--auto-approve"));
    }
}
```

- [ ] **Step 2: Implement `SessionManager`**

```rust
pub struct SessionManager {
    tabs: HashMap<String, SessionTab>,
    settings: AppSettings,
    omp_bin: PathBuf,
}

impl SessionManager {
    pub fn new(settings: AppSettings, omp_bin: PathBuf) -> Self { ... }

    pub async fn create_session(&mut self, cwd: PathBuf, resume: Option<String>) -> AppResult<SessionInfo> {
        let id = Uuid::new_v4().to_string();
        let args = build_omp_args(&cwd, &self.settings, resume.as_deref());
        let rpc = RpcClient::spawn(&self.omp_bin, &args).await?;
        rpc.wait_ready(Duration::from_secs(30)).await?;
        let info = SessionInfo {
            id: id.clone(),
            title: cwd.file_name().and_then(|s| s.to_str()).unwrap_or("session").into(),
            cwd,
            profile: self.settings.default_profile.clone(),
            status: SessionStatus::Ready,
        };
        // store tab; spawn task to forward rpc.events → tauri emit with sessionId
        self.tabs.insert(id.clone(), SessionTab { info: info.clone(), rpc });
        Ok(info)
    }

    pub async fn prompt(&mut self, session_id: &str, message: String, streaming_behavior: Option<String>) -> AppResult<Value> { ... }
    pub async fn abort(&mut self, session_id: &str) -> AppResult<Value> { ... }
    pub async fn get_state(&mut self, session_id: &str) -> AppResult<Value> { ... }
    pub async fn close(&mut self, session_id: &str) -> AppResult<()> { ... }
    pub fn list(&self) -> Vec<SessionInfo> { ... }
}
```

Event forwarding (done when wiring AppHandle in Task 5): each tab's reader already pushes `Value`; a bridge task wraps as:

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEventEnvelope {
    session_id: String,
    event: Value,
}
// app.emit("omp-event", envelope)
```

- [ ] **Step 3: Run unit tests**

```bash
cd src-tauri && cargo test session:: -- --nocapture
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: session supervisor spawns omp rpc per tab

Build yolo-first argv and track tab lifecycle status.
EOF
)"
```
(Use MTEnt author flags as always.)

---

### Task 5: Tauri commands + event bridge

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json` (allow shell/dialog as needed)

- [ ] **Step 1: Managed state**

```rust
pub struct AppState {
    pub sessions: tokio::sync::Mutex<session::SessionManager>,
    pub settings: tokio::sync::Mutex<settings::AppSettings>,
    pub config_dir: PathBuf,
}
```

On setup: load settings, resolve omp binary (if missing, still start app — create_session returns error for UI onboarding).

- [ ] **Step 2: Commands**

```rust
#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, AppError>;

#[tauri::command]
async fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<(), AppError>;

#[tauri::command]
async fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionInfo>, AppError>;

#[tauri::command]
async fn create_session(
    app: AppHandle,
    state: State<'_, AppState>,
    cwd: String,
    resume: Option<String>,
) -> Result<SessionInfo, AppError>;

#[tauri::command]
async fn close_session(state: State<'_, AppState>, session_id: String) -> Result<(), AppError>;

#[tauri::command]
async fn prompt(
    state: State<'_, AppState>,
    session_id: String,
    message: String,
    streaming_behavior: Option<String>,
) -> Result<Value, AppError>;

#[tauri::command]
async fn abort(state: State<'_, AppState>, session_id: String) -> Result<Value, AppError>;

#[tauri::command]
async fn get_state(state: State<'_, AppState>, session_id: String) -> Result<Value, AppError>;

#[tauri::command]
async fn rpc_command(
    state: State<'_, AppState>,
    session_id: String,
    command: String,
    params: Value,
) -> Result<Value, AppError>;
// generic escape hatch for set_model, set_thinking_level, get_available_models, etc.
```

`create_session` must start a forwarder:

```rust
let app2 = app.clone();
let sid = info.id.clone();
// take events receiver from client and:
tauri::async_runtime::spawn(async move {
  while let Some(event) = events.recv().await {
    let _ = app2.emit("omp-event", SessionEventEnvelope { session_id: sid.clone(), event });
  }
  let _ = app2.emit("omp-session-exit", sid);
});
```

- [ ] **Step 3: Register handler + plugins**

```rust
.invoke_handler(tauri::generate_handler![
  get_settings, save_settings, list_sessions, create_session,
  close_session, prompt, abort, get_state, rpc_command
])
```

- [ ] **Step 4: Compile**

```bash
cd src-tauri && cargo check
```
Expected: success.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: expose session RPC through Tauri commands

Bridge omp events to the webview as omp-event payloads.
EOF
)"
```

---

### Task 6: UI foundation — types, store, tauri wrappers, Zen shell

**Files:**
- Create: `ui/src/session/types.ts`
- Create: `ui/src/lib/tauri.ts`
- Create: `ui/src/session/session-store.ts`
- Create: `ui/src/app/layout-store.ts`
- Create: `ui/src/app/rails.tsx`
- Create: `ui/src/app/shell.tsx`
- Create: `ui/src/styles.css`
- Modify: `ui/src/App.tsx`, `ui/src/main.tsx`

- [ ] **Step 1: Types + invoke wrappers**

```ts
// ui/src/session/types.ts
export type ApprovalMode = "yolo" | "write" | "alwaysAsk";

export type SessionStatus = "starting" | "ready" | "error" | "exited";

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  profile?: string | null;
  status: SessionStatus;
}

export interface AppSettings {
  approvalMode: ApprovalMode;
  ompBinary?: string | null;
  defaultModel?: string | null;
  defaultThinking?: string | null;
  defaultProfile?: string | null;
  theme: string;
}

export type TranscriptItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; thinking?: string }
  | { id: string; kind: "tool"; name: string; detail: string; status: "running" | "done" | "error" }
  | { id: string; kind: "system"; text: string };

export interface ActivityItem {
  id: string;
  at: number;
  text: string;
}

export interface TodoTask {
  id: string;
  content: string;
  status: string;
}
export interface TodoPhase {
  id: string;
  name: string;
  tasks: TodoTask[];
}
```

```ts
// ui/src/lib/tauri.ts
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, SessionInfo } from "../session/types";

export const api = {
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke("save_settings", { settings }),
  listSessions: () => invoke<SessionInfo[]>("list_sessions"),
  createSession: (cwd: string, resume?: string) =>
    invoke<SessionInfo>("create_session", { cwd, resume: resume ?? null }),
  closeSession: (sessionId: string) => invoke("close_session", { sessionId }),
  prompt: (sessionId: string, message: string, streamingBehavior?: string) =>
    invoke("prompt", { sessionId, message, streamingBehavior: streamingBehavior ?? null }),
  abort: (sessionId: string) => invoke("abort", { sessionId }),
  getState: (sessionId: string) => invoke<unknown>("get_state", { sessionId }),
  rpcCommand: (sessionId: string, command: string, params: Record<string, unknown> = {}) =>
    invoke("rpc_command", { sessionId, command, params }),
};
```

Note: Tauri converts Rust snake_case params to camelCase if serde rename is set consistently — **match whatever the commands actually expect**. Prefer `serde(rename_all = "camelCase")` on command args structs OR use snake_case in `invoke` payloads. Pick one convention in this task and use it everywhere (recommend camelCase serde on a `PromptArgs` struct).

- [ ] **Step 2: Session store**

Zustand store holding:
- `sessions: SessionInfo[]`
- `activeSessionId: string | null`
- `transcripts: Record<string, TranscriptItem[]>`
- `activity: Record<string, ActivityItem[]>`
- `todos: Record<string, TodoPhase[]>`
- `subagents: Record<string, unknown[]>`
- `states: Record<string, any>`
- `streaming: Record<string, boolean>`
- actions: `bootstrap`, `openFolder`, `setActive`, `send`, `abort`, `applyOmpEvent`

`applyOmpEvent(sessionId, event)` handles at least:
- `message_update` + `text_delta` → append/update assistant item
- `tool_execution_start/update/end` → tool cards + activity
- `agent_start` / `agent_end` → streaming flags
- todo-related payloads from `get_state` refresh

- [ ] **Step 3: Layout store**

```ts
export type PanelId =
  | "sessions" | "project" | "settings" | "terminal"
  | "plan" | "activity" | "subagents";

// openDrawer, closeDrawer, togglePin, pinned: PanelId[], drawer: PanelId | null
```

- [ ] **Step 4: Shell CSS + components**

Dark Zen shell:
- 48px left/right icon rails with `title` tooltips (name + shortcut)
- center chat column
- drawer overlay when `drawer` set
- docked pinned panels
- top bar: title, model/thinking/ctx placeholders, ⌘K button

No Approvals icon.

- [ ] **Step 5: Visual smoke**

```bash
npm run dev
```
Expected: Zen chrome renders; icons show browser tooltips on hover.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(ui): zen shell, stores, and tauri API wrappers

Add dark cockpit chrome with pinnable panel rails and session state.
EOF
)"
```

---

### Task 7: Transcript + composer wired to one live OMP session

**Files:**
- Create: `ui/src/session/transcript.tsx`
- Create: `ui/src/session/composer.tsx`
- Modify: stores + shell
- Modify: event listener in `App.tsx`

- [ ] **Step 1: Listen for backend events**

```ts
import { listen } from "@tauri-apps/api/event";

useEffect(() => {
  let unlisten: (() => void) | undefined;
  listen<{ sessionId: string; event: any }>("omp-event", (e) => {
    useSessionStore.getState().applyOmpEvent(e.payload.sessionId, e.payload.event);
  }).then((fn) => { unlisten = fn; });
  listen<string>("omp-session-exit", (e) => {
    useSessionStore.getState().markExited(e.payload);
  }).then(/* track second unlisten */);
  return () => { unlisten?.(); };
}, []);
```

- [ ] **Step 2: New session via folder dialog**

Use `@tauri-apps/plugin-dialog` `open({ directory: true })` → `api.createSession(cwd)`.

- [ ] **Step 3: Composer behavior**

- If not streaming: `api.prompt(id, text)`
- If streaming: default `streamingBehavior: "followUp"` on Enter; `steer` on Cmd+Enter (document in UI hint)
- Abort button calls `api.abort`

- [ ] **Step 4: Manual smoke with real omp**

```bash
# ensure omp works
omp --mode rpc -p "ping"  # or short rpc sanity
npm run dev
# UI: open this project folder, send "Reply with the word pong only."
```
Expected: assistant text streams into transcript; no approval UI.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: wire live omp rpc chat into transcript

Create folder sessions, stream message deltas, and support abort.
EOF
)"
```

---

### Task 8: Multi-tab sessions

**Files:**
- Modify: `ui/src/app/shell.tsx` (tab bar)
- Modify: `session-store.ts`
- Modify: Sessions panel

- [ ] **Step 1: Tab bar UI** bound to `sessions` + `activeSessionId`
- [ ] **Step 2: Per-tab transcript isolation** (already keyed by session id — verify switching doesn’t leak)
- [ ] **Step 3: Close tab** → `api.closeSession` + remove local state
- [ ] **Step 4: Smoke two tabs, two cwds, both promptable**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: multi-tab concurrent omp sessions

Isolate transcripts and lifecycle per session tab.
EOF
)"
```

---

### Task 9: Panels — Sessions, Project, Plan, Activity, Subagents, Settings

**Files:**
- Create each under `ui/src/panels/*`
- Modify: shell drawer/pin host to render panel by id

- [ ] **Step 1: Sessions panel** — list, new, resume path input (simple text resume id/path for v1), close
- [ ] **Step 2: Project panel** — show cwd, profile, copy path; optional `git rev-parse --abbrev-ref HEAD` via a small Rust command `get_project_meta(cwd)`
- [ ] **Step 3: Settings panel** — load/save `AppSettings`; approval mode select default yolo; omp path text field; save reloads manager settings for **next** session
- [ ] **Step 4: Plan panel** — render `todoPhases` from last `get_state` + refresh on todo events; poll `get_state` on agent_end
- [ ] **Step 5: Activity panel** — list `activity[sessionId]` newest last
- [ ] **Step 6: Subagents panel** — on open call `rpcCommand(id, "set_subagent_subscription", { level: "progress" })` and `get_subagents`; render names/status
- [ ] **Step 7: Smoke each panel open/pin**
- [ ] **Step 8: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(ui): cockpit panels for plan, activity, subagents, settings

Pin/drawer panels read live omp state for the active session.
EOF
)"
```

---

### Task 10: Embedded PTY panel

**Files:**
- Create: `src-tauri/src/pty/mod.rs`
- Modify: `commands/mod.rs`
- Create: `ui/src/panels/terminal-panel.tsx`

- [ ] **Step 1: Rust PTY manager** using `portable-pty`

API:
- `open_pty(session_id, cwd)` → creates pair, reader task emits `pty-output` `{sessionId, data: base64 or string}`
- `write_pty(session_id, data)`
- `resize_pty(session_id, cols, rows)`
- `close_pty(session_id)`

Lazy create on first Terminal panel open for active session.

- [ ] **Step 2: xterm view**

```tsx
// create Terminal + FitAddon, onData → write_pty
// listen pty-output → term.write
// on panel show fit+resize_pty
```

- [ ] **Step 3: Smoke** — open Terminal, `echo hi`, see output; cwd is session cwd (`pwd`)
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: app-owned PTY terminal per session tab

Bridge portable-pty IO to an xterm.js panel independent of omp rpc.
EOF
)"
```

---

### Task 11: Command palette + top strip status

**Files:**
- Create: `ui/src/app/palette.tsx`
- Modify: shell + composer hints

- [ ] **Step 1: ⌘K palette** actions: new session, switch session, toggle each panel, open settings, focus terminal, set approval mode, cycle thinking via `rpcCommand`
- [ ] **Step 2: Top strip** binds model/thinking/context from `get_state` (`contextUsage.percent`, `model`, `thinkingLevel`)
- [ ] **Step 3: Model picker minimal** — `get_available_models` then `set_model`
- [ ] **Step 4: Smoke palette + status strip**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: command palette and session status strip

Expose model, thinking, context usage, and panel toggles via cmd-k.
EOF
)"
```

---

### Task 12: Onboarding errors, README, QA checklist

**Files:**
- Modify: UI empty states
- Create/Update: `README.md`
- Create: `docs/superpowers/plans/qa-checklist.md` or section in README

- [ ] **Step 1: Empty/error states**
  - No sessions: CTA “Open folder”
  - `omp not found`: Settings deep link + message
  - Session exited: Restart button (re-create with same cwd)

- [ ] **Step 2: README**

```markdown
# OMP Desktop

macOS desktop cockpit for [OMP](https://github.com/MTEnt/omp-desktop) sessions.

## Requirements
- macOS Apple Silicon
- Rust toolchain
- Node 20+
- `omp` on PATH (v17+)

## Dev
```bash
npm install
npm --prefix ui install
npm run dev
```

## Architecture
See `docs/superpowers/specs/2026-07-19-omp-desktop-design.md`
```

- [ ] **Step 3: Manual QA checklist** (tick in PR notes)

1. App launches  
2. Open folder session  
3. Prompt streams  
4. Tool cards appear on a coding prompt  
5. Two tabs isolated  
6. Plan panel updates when omp todos change  
7. Activity lists tools  
8. Terminal `pwd` matches cwd  
9. Yolo: no approval chrome  
10. Settings → write mode persists  
11. Kill omp child externally → tab shows exited + restart  

- [ ] **Step 4: Final commit + push**

```bash
git commit -m "$(cat <<'EOF'
docs: README and onboarding empty states

Document dev setup and harden first-run error UX.
EOF
)"
git push origin main
```

---

## Plan self-review

### Spec coverage

| Spec section | Tasks |
|---|---|
| Tauri + React architecture | 1, 5, 6 |
| Per-tab `omp --mode rpc` | 3, 4, 8 |
| Yolo default / settings override | 2, 4, 9 |
| Zen + expandable panels | 6, 9 |
| Chat stream + composer steer/follow-up | 7 |
| Plan / Activity / Subagents | 9 |
| Settings + auth entry (settings + login later via rpc_command) | 9, 11 |
| Embedded PTY | 10 |
| Multi-tab | 8 |
| Error/onboarding | 12 |
| No diff review / no Approvals theater | enforced by UI tasks (no panel) |
| macOS only | scaffold/packaging default |

**Auth login UI:** v1 exposes `rpc_command` for `get_login_providers` / `login` and must handle `extension_ui_request` `open_url` by opening OS browser (`tauri-plugin-opener` or shell open). Add during Task 5/7 event bridge:

- if event type `extension_ui_request` and method `open_url`, open URL
- other extension UI methods: simple modal prompt in UI (Task 7 follow-up if time; minimum open_url + generic confirm)

### Placeholder scan

No TBD steps. Generic `rpc_command` is intentional escape hatch with concrete use in Tasks 9–11.

### Type consistency

- `SessionInfo`, `AppSettings`, `ApprovalMode` names shared across Rust serde camelCase and TS types.
- Event name: `omp-event` with `{ sessionId, event }`.
- Invoke API surface listed in Task 5 and mirrored in `ui/src/lib/tauri.ts`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-19-omp-desktop.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
