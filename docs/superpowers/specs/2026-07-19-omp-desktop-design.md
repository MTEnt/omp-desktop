# OMP Desktop — Design Spec

**Date:** 2026-07-19  
**Repo:** https://github.com/MTEnt/omp-desktop  
**Local path:** `~/Desktop/omp-desktop`  
**Status:** Design complete — awaiting user review before implementation plan

## 1. Purpose

Build a macOS (Apple Silicon) desktop app that is the **primary daily driver** for OMP (Oh My Pi / `omp` CLI) coding-agent sessions. The product is a **work-session cockpit**: multi-session oversight, plans, subagents, tool activity, model/context status, settings/auth, and an embedded terminal — with chat as the center pane, not the whole product.

OMP already owns the agent loop, tools, session files, providers, and auth broker. This app is a **host + UX layer**, not a reimplementation of the agent.

## 2. Goals and non-goals

### Goals (v1)

- Feel close to Codex / large-provider desktop apps: calm chat by default, dense ops on demand.
- Run real OMP sessions via official RPC (`omp --mode rpc`).
- Multi-session in one window (tabs; optional pinned panels).
- Yolo-first trust model matching how power users already run OMP.
- Rust-owned process lifecycle, RPC transport, and PTY; polished web UI shell.

### Non-goals (v1)

- Diff / file-change accept-reject review UI.
- Windows or Linux packaging.
- Attaching to an already-running external OMP TUI process.
- Reimplementing agent tools, providers, or session storage in Rust.
- Plugin marketplace UI, multi-window workspaces, voice/TTS chrome.

## 3. Users and success criteria

**Primary user:** developer who already uses OMP and wants a better local ops surface than the terminal TUI alone.

**Success criteria:**

1. Open app → create session on a folder → send prompt → see streaming text, tool cards, and plan updates.
2. Run two tabs on two projects concurrently without cross-talk.
3. Restart a crashed session tab without restarting the whole app.
4. Default yolo path shows **zero** approval chrome.
5. Expand Plan / Activity / Subagents / Terminal from icon rails without losing chat context.

## 4. Product decisions (locked)

| Decision | Choice |
|---|---|
| Product shape | Work-session cockpit |
| Relationship to TUI | Desktop is primary daily driver; TUI remains valid fallback |
| Platform | macOS Apple Silicon first |
| Multi-session | One window; tabs for concurrent sessions |
| Architecture | Tauri 2 + React/TypeScript UI; Rust host |
| OMP integration | Spawn `omp --mode rpc` **per session tab** |
| Default approval | **Yolo / auto-approve** unless changed in Settings |
| Layout | **Zen default** + expandable/pinnable cockpit panels |
| Terminal | App-owned PTY per tab (not OMP TUI) |
| Diff review | Deferred past v1 |
| Git author for this repo | `MTEnt` |

## 5. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  omp-desktop (Tauri 2)                                      │
│  ┌──────────────────────────┐  ┌─────────────────────────┐  │
│  │ Rust core                │  │ UI (React/TS + Vite)    │  │
│  │ • window / menu          │◄─┤ • zen shell + rails     │  │
│  │ • session supervisor     │  │ • transcript + composer │  │
│  │ • RPC client (JSONL)     │  │ • pinnable panels       │  │
│  │ • PTY bridge             │  │ • settings              │  │
│  │ • app settings store     │  │ • xterm surface         │  │
│  └────────────┬─────────────┘  └─────────────────────────┘  │
│               │ one child per tab                             │
│               ▼                                               │
│     omp --mode rpc --cwd <dir> [--profile]                    │
│         [--approval-mode yolo|write|always-ask] …             │
└───────────────────────────────────────────────────────────────┘
```

### Boundary rules

- **OMP** is source of truth for: messages, tools, todos, subagents, session files, provider auth material it already manages.
- **App** is source of truth for: open tabs, pin/layout state, UI theme, OMP binary path override, default approval mode preference, PTY scrollback prefs.
- **UI never** spawns processes or speaks JSONL. All host operations go through Tauri commands + pushed events from Rust.

### Process model

- Each session tab owns exactly one `omp --mode rpc` child process (process group).
- Tabs are isolated: one child exit does not tear down others.
- On tab close: close stdin, wait briefly, then terminate process group if needed.
- On app quit: shut down all children.
- Working directory and optional `--profile` are chosen at session creation; shown in Project panel.

### RPC responsibilities (Rust)

Implement a robust JSONL client against OMP RPC (see OMP `rpc.md`):

- Wait for `{ "type": "ready" }`.
- Correlate commands with `id`.
- Forward `AgentSessionEvent` stream to the UI.
- Handle rare `extension_ui_request` (confirm/input/select/login `open_url`) as modal flows — **not** an always-on Approvals cockpit.
- Support host-tool / host-URI protocols later if needed; **not required for v1** unless a concrete UI feature needs them.
- Subscribe to subagent progress when Subagents panel is used (`set_subagent_subscription`).

### Core command map

| UI intent | RPC |
|---|---|
| Send message | `prompt` |
| Steer / follow-up while streaming | `prompt` + `streamingBehavior` |
| Stop | `abort` |
| Model | `set_model` / `get_available_models` / `cycle_model` |
| Thinking | `set_thinking_level` / `cycle_thinking_level` |
| Snapshot | `get_state` |
| Commands palette | `get_available_commands` |
| Todos seed/sync | `set_todos` + state/events |
| Subagents | `get_subagents`, `get_subagent_messages`, subscription level |
| Session name | `set_session_name` |
| Switch session file | `switch_session` (when applicable) |
| Login | `get_login_providers`, `login` |

Composer must respect streaming rules: while `isStreaming`, require steer vs follow-up behavior rather than a naive second prompt.

## 6. UX / layout

### Default: Zen

- Center: transcript + composer (max-width comfortable reading column).
- Left icon rail: Chat, Sessions, Project, Settings, Terminal.
- Right icon rail: Plan, Activity, Subagents.
- Top strip: session switcher control, model, thinking level, context usage, command palette affordance (⌘K).
- **No Approvals icon** in the default yolo chrome.

### Icon behavior

- **Hover:** tooltip with panel name + keyboard shortcut.
- **Click:** open as overlay drawer (temporary).
- **Pin:** dock panel into the layout; multiple pins allowed; chat flexes.
- **Expand:** grow drawer/panel; Activity may split with Terminal (activity-bottom style) when both pinned/expanded.
- **Remember** pin/layout state per workspace/cwd when practical.

### Panels (v1)

| Panel | Contents |
|---|---|
| Sessions | Recent/open sessions, new session, resume, close, streaming indicators |
| Project | cwd, git branch if cheap to read, profile, open in Finder |
| Plan | OMP todo phases/tasks live |
| Activity | Chronological tool execution stream for the active tab |
| Subagents | Running/queued nested agents + progress; drill-in later if easy |
| Settings | Approval mode, OMP binary path, defaults for model/thinking, theme |
| Terminal | App-owned PTY bound to session cwd |

### Chat transcript

- Virtualized list.
- User bubbles, assistant markdown, thinking blocks (collapsible; respect hide-thinking preference later).
- Tool cards from `tool_execution_start/update/end`.
- If approval mode ≠ yolo and OMP/extension requests confirmation: **inline card or modal** at point of block — never an empty permanent Approvals theater.

### Composer

- Enter: send prompt (or steer/follow-up policy when streaming — exact keybinding set in implementation plan; document in app help).
- Abort control visible while streaming.
- Model + thinking + approval mode summary near composer or top strip.

### Command palette (⌘K)

Jump to: switch session, new session, model, thinking, approval mode, toggle panels, settings, focus terminal.

## 7. Trust and approvals

- **Factory default:** yolo / auto-approve for sessions the app spawns.
- Wire via CLI (`--auto-approve` and/or `--approval-mode yolo`) and keep Settings as source of user override for **next** sessions (and optionally apply live if RPC/settings allow).
- Changing to `write` or `always-ask` enables blocking UI when needed.
- Do not invent a second approval system in the app. Surface OMP’s.

## 8. Terminal (PTY)

- Implemented in Rust; rendered with an xterm-like widget in UI.
- One PTY per session tab (lazy: create on first open).
- Default cwd = session cwd.
- Independent from OMP child stdin/stdout (RPC uses pipes; PTY is separate).
- Collapsed by default in Zen.

## 9. Settings and auth

**Settings (app-local):**

- Approval mode default (yolo \| write \| always-ask)
- OMP binary path (default: resolve `omp` on PATH)
- Default model / thinking (passed into spawn or set post-ready)
- Theme (dark first)
- Default profile name (optional string passed as `--profile` on spawn)

**Auth:**

- Prefer driving OMP login RPC + `open_url` rather than re-storing API keys in the app.
- If key entry is required, pass through to OMP mechanisms; avoid becoming a second secrets vault in v1 unless Tauri stronghold is trivially useful for app-only secrets.

## 10. Repository layout

```
omp-desktop/
  src-tauri/               # Tauri 2 / Rust
    src/
      main.rs
      session/             # tab supervisor, spawn args, lifecycle
      rpc/                 # JSONL client, types, event fan-out
      pty/                 # PTY sessions
      settings/            # persistence
      commands.rs          # IPC surface
  ui/                      # React + TS + Vite
    src/
      app/                 # shell, rails, pins, palette
      session/             # stores, transcript, composer
      panels/
      settings/
      theme/
  docs/superpowers/specs/  # this document
  README.md
```

### Tech choices

| Layer | Choice |
|---|---|
| Shell | Tauri 2 |
| Host language | Rust |
| UI | React + TypeScript + Vite |
| UI state | Lightweight store (e.g. Zustand) |
| Transcript | Virtualized list + markdown renderer |
| Terminal view | xterm.js (or equivalent) ↔ Rust PTY |
| Packaging target | macOS arm64 |

## 11. Error handling

| Failure | UX |
|---|---|
| `omp` not found | Onboarding state with path fix + link to install notes |
| Child spawn fail | Tab error with stderr snippet + retry |
| RPC protocol/parse error | Log + toast; keep tab restartable |
| Child crash mid-session | Banner: Restart session; preserve UI transcript cache if possible until restart replaces stream |
| Provider/auth errors | Show in transcript from agent events; Settings → login entry |

## 12. Testing strategy (lightweight v1)

- Rust unit tests: JSONL framing, id correlation, child supervisor state machine (mock process).
- UI component tests optional early; prefer manual `tauri dev` smoke:
  - new session, prompt, stream, two tabs, panel pin, PTY echo, yolo has no approval UI.
- Do not require full OMP integration tests in CI until harness is stable; document manual QA checklist.

## 13. Implementation phases (preview; detailed plan next)

1. Scaffold Tauri 2 + React app in repo; macOS dev run.
2. Session supervisor + RPC client (ready, prompt, events, abort, get_state).
3. Zen shell + transcript/composer wired to one session.
4. Tabs + multi-session isolation.
5. Panels: Sessions, Plan, Activity, Subagents, Project, Settings.
6. PTY panel.
7. Palette, polish, packaging notes.
8. README + manual QA checklist.

## 14. Open points (resolved enough for v1)

| Topic | Resolution |
|---|---|
| Pure Rust UI vs Tauri | Tauri + React for Codex-level polish and ship speed |
| Approvals-centric UX | Rejected; yolo-first; situational blocking UI only |
| Diff review | Explicitly out of v1 |
| Attach to running TUI | Out of v1 |
| Host tools/URI | Not required for v1 MVP features |

## 15. References

- OMP RPC: `omp://rpc.md` (JSONL host protocol)
- OMP SDK: `omp://sdk.md` (in-process; not used cross-language — RPC is the boundary)
- OMP CLI: `omp --help` (`--mode rpc`, approval flags, profiles, cwd)
- Brainstorm mockups: `.superpowers/brainstorm/` (local only, gitignored)
