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
| Historical session library | OMP session JSONL tree | planned `session_library` + library UI | phase-1 |
| Cross-session transcript search | OMP JSONL contents | host search over session files + library UI | phase-1 |
| Subagent tree + inspector | RPC: `get_subagents`, `set_subagent_subscription`, `get_subagent_messages`, subagent events | subagents panel today (flat list); tree + inspector | partial / phase-2 |
| Attention inbox | Extension UI requests + session errors from OMP | aggregate panel across tabs | phase-2 |
| Structured tool/diff cards | Tool results in OMP transcript/events | transcript tool rendering upgrades | phase-3 |
| Turn review panel | Edit tool payloads / git (read-first) | review panel | phase-3 |
| Slash autocomplete | `get_available_commands` + OMP slash handling | composer popup; host actions for compact/export | phase-4 |
| Safe image attachments | `prompt` images on stock RPC | host compress under `MAX_RPC_FRAME_BYTES`, composer paste/drop | phase-4 |
| Provider login UI | `get_login_providers`, `login`, `open_url` | settings/providers UI (helpers exist; full UI) | phase-5 |
| Session stats / cost | `get_session_stats` | runtime chips / usage (typed helper exists) | phase-5 |
| Workspaces grouping | N/A (desktop UX); cwd still OMP `--cwd` | workspace store + sessions grouping | phase-6 |
| Git branch chip | `git` CLI in project cwd | host `get_git_status` + shell chip | phase-6 |
| Project file browser | Files on disk / remote via existing SSH listing | project panel today (cwd/profile only); read-only tree | partial / phase-6 |
| MCP/agents catalog | `~/.omp` MCP/skills/agents config; live commands via RPC | catalog panel (skills list exists in launch) | partial / phase-7 |
| GitHub panel | `gh` CLI | github panel | phase-7 |
| GitHub Releases / updater | N/A (packaging) | tag release workflow + optional updater plugin | phase-8 |
| Linux packages | N/A (packaging) | deb/AppImage (or equiv) CI matrix | phase-8 |
| T4 host pairing / mobile / K8s | Would need non-stock host/daemon | — | wont |

## Notes on “partial” rows

- **Subagents:** panel loads `get_subagents` and shows a list; roadmap Phase 2 adds event subscription levels, parent/child tree, and transcript inspector via `get_subagent_messages`.
- **Project panel:** shows active cwd, profile, status, copy path — not a file tree yet (Phase 6).
- **Catalogs:** launch/skills listing exists; unified MCP/agents/commands browser is Phase 7.
- **Provider login / stats:** `ui/src/lib/tauri.ts` already exposes typed `rpc_command` helpers; end-user panels/chips are Phase 5.

## Stock OMP boundary (wont)

These stay out unless upstream stock OMP grows equivalent APIs:

- T4-style host pairing / multi-host fleet daemon
- Flutter/mobile clients
- Kubernetes operator
- Authority-bridge protocols (`t4-omp-authority/*`)
- Forked OMP requirement

See [ARCHITECTURE.md](./ARCHITECTURE.md) for process model, `omp-event` bridge, 1 MiB RPC frames, and security posture.
