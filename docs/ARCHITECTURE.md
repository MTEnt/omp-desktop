# OMP Desktop Architecture

This document describes how OMP Desktop is structured today: a Tauri 2 host that runs stock `omp --mode rpc` children, a React Zen UI, and a few host-owned modules (PTY, SSH, SQLite memory) that do not replace OMP authority.

Related: [FEATURE_MATRIX.md](./FEATURE_MATRIX.md), [number-one roadmap](./superpowers/plans/2026-07-21-number-one-roadmap.md).

## Process model

```text
┌─────────────────────────────────────────────────────────────┐
│  React UI (ui/) — Vite + Zustand Zen shell                  │
│  transcript · composer · rails/panels · xterm · palette     │
└───────────────────────────┬─────────────────────────────────┘
                            │ Tauri invoke + events
┌───────────────────────────▼─────────────────────────────────┐
│  Rust / Tauri 2 host (src-tauri/)                           │
│  commands · SessionManager · RpcClient · PtyManager         │
│  MemoryStore (SQLite) · SSH helpers · settings              │
└───────┬─────────────────┬───────────────────┬───────────────┘
        │ one child/tab   │ app-owned PTY     │ optional
        ▼                 ▼                   ▼
   omp --mode rpc     local shell /        ssh hosts,
   (stock OMP 17+)    ssh -tt remote       ~/.omp configs
```

### Split of responsibility

| Layer | Path | Owns |
|---|---|---|
| **Tauri host** | `src-tauri/` | Process spawn, JSONL RPC transport, settings, PTY, SSH probe/listing, SQLite memory/jobs, Tauri commands, event fan-out |
| **React UI** | `ui/` | Zen shell, session store, transcript/composer, pinnable panels, command palette, xterm view |
| **OMP CLI** | external binary on PATH | Agent loop, tools, session JSONL on disk, auth/providers, models, approvals |

OMP remains the source of truth for agent behavior. Desktop is a cockpit, not a second runtime.

## Per-tab RPC sessions

`SessionManager` (`src-tauri/src/session/mod.rs`) keeps a map of session tabs. Creating a session:

1. Resolves cwd (local folder, or a generated local workspace stub for SSH remote sessions).
2. Writes a temporary mnemopi config overlay (`memory::write_mnemopi_overlay`).
3. Spawns **one** stock OMP child via `RpcClient::spawn` with args from `build_omp_args`:
   - `--mode rpc`
   - `--cwd <path>`
   - `--approval-mode <settings>`
   - optional `--config` (memory overlay), `--profile`, `--model`, `--thinking`, `--resume`
   - `--auto-approve` when approval mode is yolo
4. Waits until the RPC client reports ready, then stores `SessionTab { info, rpc, artifacts }`.

Tabs are isolated: separate OS processes, separate RPC stdin/stdout pipes, separate event receivers. Closing a session drops the child (kill-on-drop) and closes any associated PTY.

UI drives sessions through Tauri commands (`create_session`, `prompt`, `abort`, `get_state`, `rpc_command`, `close_session`, …) registered in `src-tauri/src/lib.rs`.

## Event bridge (`omp-event`)

Each `RpcClient` parses JSONL frames from OMP stdout and demuxes:

- **responses** → pending request oneshots
- **events** → an unbounded channel taken by the host after session create

On `create_session` / `create_ssh_session`, the host spawns a task that reads that channel and emits:

```text
omp-event  →  { sessionId, event }   // SessionEventEnvelope
omp-session-exit → sessionId         // when the event stream ends
```

The UI listens once in `ui/src/App.tsx` and routes payloads into `useSessionStore.applyOmpEvent(sessionId, event)`.

PTY output is a separate channel: `pty-output` with `{ sessionId, data }`.

## RPC transport and the 1 MiB frame limit

Implementation: `src-tauri/src/rpc/client.rs`.

- Framing: one JSON value per line (JSONL) on the child stdin/stdout.
- Constant: `MAX_RPC_FRAME_BYTES = 1024 * 1024` (1 MiB).
- **Outbound:** encoding a request line that exceeds the limit fails before write.
- **Inbound:** accumulating a frame past the limit fails the reader (emits `rpc_frame_error` and stops).

This is a hard transport constraint for stock OMP RPC. Large payloads (especially image attachments planned in Phase 4) must be compressed/rejected in the host so frames stay under budget with headroom.

Default request timeout is 30s; process exit wait is 2s.

## Profile / cwd context (`OmpProcessContext`)

Ephemeral OMP processes (model discovery, future auth helpers) must not use a blind temp cwd.

`src-tauri/src/omp_context.rs`:

```rust
pub struct OmpProcessContext {
    pub cwd: PathBuf,
    pub profile: Option<String>,
    pub omp_bin: PathBuf,
}
```

`base_rpc_args(no_session)` always passes `--mode rpc` and `--cwd`, adds `--profile` when non-empty, and optionally `--no-session`.

Live session tabs still build args via `build_omp_args` (approval mode, resume, memory overlay, defaults from settings). Ephemeral calls should prefer the **active session’s** cwd/profile when present, else settings default profile.

## Host modules

### PTY (`src-tauri/src/pty/mod.rs`)

App-owned terminal, **not** the OMP TUI.

- One PTY per session id via `PtyManager`.
- Local: platform shell (`zsh`/`sh` / PowerShell preference on Windows).
- Remote SSH sessions: `ssh -tt` into the remote folder.
- Commands: `open_pty`, `write_pty`, `resize_pty`, `close_pty`.
- Output streamed to the UI as `pty-output`.

### SSH (`src-tauri/src/ssh/mod.rs`)

- Host inventory from OpenSSH config (`~/.ssh/config`, includes) and OMP `~/.omp/agent/ssh.json`.
- Probe connection, list remote dirs, recents, add user hosts.
- `create_ssh_session` probes first, then creates a normal RPC tab with remote metadata and a local workspace stub; agent work targets the remote via OMP/SSH integration and a remote integrated terminal.

### Memory / jobs SQLite (`src-tauri/src/memory/mod.rs`)

Desktop-local store at `{data_dir}/omp-desktop/memory.db` (rusqlite, WAL):

- Role notes and per-role scratchpads (project-keyed)
- Persistent agent roster + job cards (jobs board)
- Session create ensures a default agent/job roster entry

Separately, each RPC child gets a **temp YAML overlay** enabling OMP’s mnemopi backend with desktop-tuned recall settings (`autoRetain: false`, modest injection limits). That is OMP memory configuration, not a second agent runtime.

### Settings & config

- App settings (approval mode, default profile/model/thinking, omp binary path): host settings module + UI settings panel.
- Model roles: `omp_config` reads/writes role bindings with project vs global scope awareness.
- Role model picker lives in the shell strip (`ui/src/app/role-model-picker.tsx`).

### Session history rewrite

`session_history.rs` supports targeted assistant-message rewrite for hosted sessions. It is **not** the Phase 1 historical session library (scan/search/archive under `~/.omp/agent/sessions`).

## Stock OMP only (boundary)

Hard product boundary:

- Runtime is **stock OMP 17+** on PATH (or a user-configured binary path).
- No forked OMP, no `t4-host`, no `t4-omp-authority` bridge, no desktop-invented agent loop.
- Prefer OMP RPC commands, session JSONL on disk, and tools like `gh` over inventing parallel authority.
- Out of roadmap scope unless stock OMP gains them: mobile clients, Kubernetes operator, host pairing fleets, Linear, TTS, CSS tweak panels.

UI helpers in `ui/src/lib/tauri.ts` wrap stock RPC names (`get_available_commands`, `get_session_stats`, `compact`, `export_html`, `set_subagent_subscription`, `get_subagent_messages`, `get_login_providers`, `login`, …) via the generic `rpc_command` host path.

## Security notes

| Topic | Intent / current posture |
|---|---|
| **CSP** | `src-tauri/tauri.conf.json` sets a restrictive CSP: `default-src 'self'`, no `object-src`, locked `frame-ancestors` / `form-action`, scripts self-only. Styles allow `'unsafe-inline'` for the bundled UI. `connect-src` / `frame-src` permit IPC and localhost companions (browser/companion panels). |
| **Secrets** | Provider auth is OMP-owned (`login` / `get_login_providers`). Desktop must not display raw API keys or tokens in UI or diagnostics. Prefer system browser for `open_url` login flows. |
| **RPC frame budget** | Enforce `MAX_RPC_FRAME_BYTES` on read and write; reject oversized image/attachment frames in host code before they hit the pipe. |
| **Path containment** | Future session-library and project file APIs must reject `..` / absolute escapes and only operate under allowed roots (session cwd, `~/.omp/agent/sessions`, archive root). SSH remote listing stays on the probed remote target. |
| **Process isolation** | One OMP child per tab; kill-on-drop; PTY lifecycle tied to session close. |
| **Config writes** | Prefer OMP APIs / surgical edits; do not blindly rewrite whole user YAML configs. |
| **Approvals** | Default approval mode is **write** (`--approval-mode write`); yolo adds `--auto-approve`. Extension UI requests surface through the existing respond path. |

## UI shell sketch

- **Zen rails** (`ui/src/app/rails.tsx`, `layout-store.ts`): icon rails; drawer vs pinned dock.
- **Panels (present):** project, plan, activity, subagents, terminal, jobs, memory, scratchpad, browser, companion, launch, sessions, settings.
- **Core session UI:** transcript, composer, task progress strip, SSH connect modal, onboarding walkthrough, command palette.

Roadmap phases add library, attention, review, catalogs, GitHub, workspaces, stats chips, slash/images, releases — see the feature matrix for status.

## Key source map

| Concern | Location |
|---|---|
| Host entry + command list | `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs` |
| RPC client + frame limit | `src-tauri/src/rpc/client.rs` |
| Sessions | `src-tauri/src/session/mod.rs` |
| Ephemeral process context | `src-tauri/src/omp_context.rs` |
| PTY / SSH / memory | `src-tauri/src/pty/`, `ssh/`, `memory/` |
| UI bridge | `ui/src/lib/tauri.ts` |
| Session store + events | `ui/src/session/session-store.ts`, `ui/src/App.tsx` |
| Shell / layout | `ui/src/app/shell.tsx`, `rails.tsx`, `layout-store.ts` |
| CSP / bundle | `src-tauri/tauri.conf.json` |
