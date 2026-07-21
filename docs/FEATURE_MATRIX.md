# OMP Desktop Feature Matrix

Capability map for stock-OMP Desktop. Status values:

| Status | Meaning |
|---|---|
| **done** | Shipped and usable in the current tree |
| **partial** | Present but shallow vs target UX |
| **phase-N** | Planned in [number-one roadmap](./superpowers/plans/2026-07-21-number-one-roadmap.md) Phase N |
| **wont** | Explicit non-goal on stock OMP boundary |

Authority column: who owns the truth. Desktop surfaces never invent a second agent runtime.

| Capability | OMP authority | Desktop surface | Status |
|---|---|---|---|
| Multi-tab RPC sessions | `omp --mode rpc` child per tab; session JSONL under `~/.omp/agent/sessions` | `SessionManager`, sessions panel, tab shell | done |
| App-owned PTY | N/A (host shell; not OMP TUI) | `PtyManager`, terminal panel, `pty-output` | done |
| SSH remote sessions | OMP SSH hosts / remote tools; OpenSSH for transport | SSH modal, host list, remote dir, remote PTY, session chip | done |
| Role model picker | OMP model list + role config (project/global) | `role-model-picker`, `omp_config`, settings | done |
| Role memory / scratchpad | OMP mnemopi via session config overlay; desktop SQLite for notes/scratch | memory + scratchpad panels, `MemoryStore` | done |
| Jobs board | Desktop SQLite job/agent cards (orchestration UX); agent work still OMP sessions | jobs panel, `upsert_job` / `list_jobs` | done |
| Launch recipes / skills | OMP skills on disk; recipes are desktop prompts/workflows | launch panel, `list_skills` | done |
| Browser artifacts panel | OMP `browser` tool events/screenshots | browser panel (artifact stream from session events) | done |
| Companion panel | Localhost companion processes (user/OMP-side) | companion panel (attach/embed localhost) | done |
| Historical session library | OMP session JSONL tree | `session_library` + library panel (list/archive/rename/delete) | done |
| Cross-session transcript search | OMP JSONL contents | host search over session files + library UI | done |
| Subagent tree + inspector | RPC: `get_subagents`, `set_subagent_subscription`, `get_subagent_messages`, subagent events | subagents panel tree + inspector | done |
| Attention inbox | Extension UI requests + session errors from OMP | attention panel across tabs | done |
| Structured tool/diff cards | Tool results in OMP transcript/events | transcript tool/diff card rendering | done |
| Turn review panel | Edit tool payloads / git (read-first) | review panel (read-only) | done |
| Slash autocomplete | `get_available_commands` + OMP slash handling | composer popup; host actions for compact/export | done |
| Safe image attachments | `prompt` images on stock RPC | host compress under `MAX_RPC_FRAME_BYTES`, composer paste/drop | done |
| Provider login UI | `get_login_providers`, `login`, `open_url` | settings/providers login UI | done |
| Session stats / cost | `get_session_stats` | runtime chips / usage in shell + settings | done |
| Workspaces grouping | N/A (desktop UX); cwd still OMP `--cwd` | workspace store + sessions grouping | done |
| Git branch chip | `git` CLI in project cwd | host `get_git_status` + shell chip | done |
| Project file browser | Files on disk / remote via existing SSH listing | project panel read-only tree (`project_fs`) | done |
| MCP/agents catalog | `~/.omp` MCP/skills/agents config; live commands via RPC | catalog panel (MCP, agents, skills, commands) | done |
| GitHub panel | `gh` CLI | github panel (issues/PRs snapshot) | done |
| GitHub Releases / updater | N/A (packaging) | tag `release.yml` publishes assets; in-app updater plugin not yet | partial |
| Linux packages | N/A (packaging) | deb/AppImage via CI + `release.yml` Linux matrix | done |
| T4 host pairing / mobile / K8s | Would need non-stock host/daemon | — | wont |

## Notes on status rows

- **GitHub Releases / updater (partial):** `.github/workflows/release.yml` builds and uploads macOS/Windows/Linux assets on `v*` tags. No `tauri-plugin-updater` / in-app auto-update path yet.
- **Linux packages (done):** both `desktop.yml` CI and `release.yml` produce `deb` + AppImage for Linux x64. Publishing happens on tagged releases; artifacts also upload from CI.
- **Turn review:** read-only review of edit/diff payloads from the active turn — not a write-back editor.
- **Stock OMP boundary:** T4 host pairing, mobile clients, and K8s remain **wont** unless upstream stock OMP grows equivalent APIs.

## Stock OMP boundary (wont)

These stay out unless upstream stock OMP grows equivalent APIs:

- T4-style host pairing / multi-host fleet daemon
- Flutter/mobile clients
- Kubernetes operator
- Authority-bridge protocols (`t4-omp-authority/*`)
- Forked OMP requirement

See [ARCHITECTURE.md](./ARCHITECTURE.md) for process model, `omp-event` bridge, 1 MiB RPC frames, and security posture.
