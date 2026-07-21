# Number One Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MTEnt OMP Desktop the #1 stock-OMP desktop app by closing the gaps that put us at 76/100 behind T4 Code (90) and OMP Studio (82), without adopting T4’s custom OMP fork/daemon.

**Architecture:** Stay on Tauri 2 + stock `omp --mode rpc`. Ship value in vertical slices that each leave the app usable. Prefer OMP-owned authority (RPC commands, session JSONL, `gh` CLI) over inventing a second runtime. Do **not** port T4 host pairing, Kubernetes, Flutter mobile, or authority-bridge features unless stock OMP gains them.

**Tech Stack:** Rust/Tauri 2, React 19, TypeScript, Zustand, Vite, existing `node --test` UI tests, `cargo test` / Clippy, GitHub Actions + Tauri bundling.

**Scorecard target (from 76 → ≥91):**

| Category | Now | Target | Primary work |
|---|---:|---:|---|
| OMP integration | 8 | 10 | Full stock RPC surface: commands, stats, login, compact, export, branch, subagent events |
| Product scope | 8 | 10 | Session library, review, catalogs, workspaces |
| UX/workflow depth | 9 | 10 | Structured tools, slash composer, attention inbox |
| Architecture | 8 | 9 | Session index module, layout persistence, safe image transport |
| Tests/verification | 8 | 10 | Unit + focused integration + release smoke |
| Platform reach | 7 | 8 | Keep Win/macOS; add Linux package |
| Packaging/releases | 6 | 10 | Tagged signed releases + updater |
| Security/privacy | 8 | 9 | Profile-aware auth, frame limits, no secret leakage |
| Documentation | 7 | 9 | Architecture + feature matrix + release notes |
| Maturity/activity | 7 | 9 | Cadence of shipped slices on `main` |
| **Total** | **76** | **≥91** | Beat Studio on stock-OMP desktop; beat T4 on stock-OMP compatibility + Windows |

---

## Non-goals (explicit)

- Do **not** merge PR #9 as-is (profile-blind auth, 1 MiB frame breakage, destructive YAML rewrite, broken Clippy CI).
- Do **not** require a forked OMP, `t4-host`, or `t4-omp-authority/1`.
- Do **not** build mobile, K8s operator, Linear, CSS tweak panel, or TTS in this roadmap.
- Do **not** replace Zen rails with an Electron-style mega-IDE unless a later plan says so.

## Hard constraints

1. Stock OMP 17+ on PATH remains the only runtime.
2. RPC JSONL frames stay ≤ 1 MiB (`MAX_RPC_FRAME_BYTES` in `src-tauri/src/rpc/client.rs`).
3. Every phase ends with: `npm test && npm run lint && npm run ui:build` green, plus phase-specific smoke.
4. Profile/project cwd must flow into auth, model discovery, and config writes.
5. Prefer small PRs: one phase per PR when possible.

## Current baseline (lock these files in mind)

- Rust host entry / commands: `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`
- RPC: `src-tauri/src/rpc/client.rs` (`MAX_RPC_FRAME_BYTES = 1 MiB`)
- Sessions: `src-tauri/src/session/mod.rs`, `ui/src/panels/sessions-panel.tsx`
- History rewrite only: `src-tauri/src/session_history.rs`
- UI shell: `ui/src/app/shell.tsx`, `ui/src/app/rails.tsx`, `ui/src/app/layout-store.ts`
- Transcript/composer: `ui/src/session/transcript.tsx`, `ui/src/session/composer.tsx`, `ui/src/session/session-store.ts`, `ui/src/session/types.ts`
- API bridge: `ui/src/lib/tauri.ts`
- Tests: `ui/tests/stores.test.ts`, `ui/tests/config.test.ts`, Rust unit tests colocated in modules
- CI: `.github/workflows/desktop.yml` (builds artifacts, **no GitHub Releases**)
- OMP session disk layout: `~/.omp/agent/sessions/<project-slug>/<timestamp>_<id>/*.jsonl` with `type:"session"` headers

## Stock OMP RPC already available (use these; don’t invent)

From `omp://rpc.md`:

- `get_available_commands`, `get_session_stats`, `export_html`, `compact`, `set_auto_compaction`
- `set_subagent_subscription` (`off|progress|events`), `get_subagents`, `get_subagent_messages`
- `get_login_providers`, `login` (+ `extension_ui_request` `open_url`)
- `branch`, `get_branch_messages`, `handoff`, `set_session_name`, `switch_session`, `get_messages`
- `prompt` / `steer` / `follow_up` with optional `images?: ImageContent[]`

## File map (new / major)

| Path | Responsibility |
|---|---|
| `src-tauri/src/session_library.rs` | Scan/search/archive/rename/delete historical JSONL sessions |
| `src-tauri/src/git_status.rs` | Branch/dirty snapshot for active cwd (optional watcher later) |
| `src-tauri/src/catalog.rs` | Read-only MCP/skills/agents/providers inventory from `~/.omp` |
| `src-tauri/src/image_attach.rs` | Downscale/compress images under RPC frame budget |
| `ui/src/session/tool-render.ts` | Pure parsers for edit/bash/eval/search tool cards |
| `ui/src/session/tool-cards.tsx` | Structured tool card components |
| `ui/src/session/diff-view.tsx` | Unified diff renderer (scrub optional) |
| `ui/src/session/slash.ts` | Slash command matching against `get_available_commands` |
| `ui/src/panels/session-library-panel.tsx` | Historical session browser |
| `ui/src/panels/subagent-inspector.tsx` | Tree + live transcript drill-in |
| `ui/src/panels/attention-panel.tsx` | Cross-session attention inbox |
| `ui/src/panels/review-panel.tsx` | Turn/file diff review (read-first; apply later if safe) |
| `ui/src/panels/catalog-panel.tsx` | MCP / agents / commands / providers browser |
| `ui/src/panels/github-panel.tsx` | `gh` CLI backed issues/PRs |
| `ui/src/app/workspace-store.ts` | Named/pinned/colored workspaces + layout persistence |
| `docs/ARCHITECTURE.md` | Process model + RPC + security |
| `docs/FEATURE_MATRIX.md` | Capability vs OMP authority map |
| `.github/workflows/release.yml` | Tag → signed/notarized publish |

---

## Phase 0 — Foundations (unblocks everything)

### Task 0.1: Profile-aware OMP process context helper

**Files:**
- Create: `src-tauri/src/omp_context.rs`
- Modify: `src-tauri/src/lib.rs` (mod + exports)
- Modify: `src-tauri/src/commands/mod.rs` (`list_available_models`, any future auth/config)
- Modify: `src-tauri/src/session/mod.rs` (pass profile/cwd consistently)
- Test: `src-tauri/src/omp_context.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Write failing tests for context resolution**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn prefers_explicit_profile_over_default() {
        let ctx = OmpProcessContext {
            cwd: PathBuf::from("/tmp/proj"),
            profile: Some("work".into()),
            omp_bin: PathBuf::from("omp"),
        };
        let args = ctx.base_rpc_args(true);
        assert!(args.windows(2).any(|w| w == ["--profile", "work"]));
        assert!(args.windows(2).any(|w| w == ["--cwd", "/tmp/proj"]));
    }

    #[test]
    fn omits_profile_flag_when_none() {
        let ctx = OmpProcessContext {
            cwd: PathBuf::from("/tmp/proj"),
            profile: None,
            omp_bin: PathBuf::from("omp"),
        };
        let args = ctx.base_rpc_args(true);
        assert!(!args.iter().any(|a| a == "--profile"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml omp_context -- --nocapture`  
Expected: compile error / missing type

- [ ] **Step 3: Implement minimal helper**

```rust
// src-tauri/src/omp_context.rs
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct OmpProcessContext {
    pub cwd: PathBuf,
    pub profile: Option<String>,
    pub omp_bin: PathBuf,
}

impl OmpProcessContext {
    pub fn base_rpc_args(&self, no_session: bool) -> Vec<String> {
        let mut args = vec![
            "--mode".into(),
            "rpc".into(),
            "--cwd".into(),
            self.cwd.display().to_string(),
        ];
        if let Some(profile) = self.profile.as_deref().filter(|p| !p.is_empty()) {
            args.push("--profile".into());
            args.push(profile.to_string());
        }
        if no_session {
            args.push("--no-session".into());
        }
        args
    }
}
```

Wire `list_available_models` to use active session cwd/profile when present, else settings default profile + temp cwd.

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml omp_context`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/omp_context.rs src-tauri/src/lib.rs src-tauri/src/commands/mod.rs src-tauri/src/session/mod.rs
git commit -m "$(cat <<'EOF'
fix(host): resolve OMP cwd/profile for ephemeral RPC

Ensure model discovery and future auth commands inherit the
active project/profile instead of a blind temp cwd.
EOF
)"
```

### Task 0.2: Safe `rpc_command` allowlist + typed helpers in UI

**Files:**
- Modify: `src-tauri/src/commands/mod.rs` (optional allowlist log/metrics only if needed)
- Modify: `ui/src/lib/tauri.ts`
- Modify: `ui/src/session/session-store.ts`
- Test: `ui/tests/stores.test.ts`

- [ ] **Step 1: Add UI helpers**

```ts
// ui/src/lib/tauri.ts
getAvailableCommands: (sessionId: string) =>
  invoke<unknown>("rpc_command", {
    sessionId,
    command: "get_available_commands",
    params: {},
  }),

getSessionStats: (sessionId: string) =>
  invoke<unknown>("rpc_command", {
    sessionId,
    command: "get_session_stats",
    params: {},
  }),

compactSession: (sessionId: string, customInstructions?: string) =>
  invoke<unknown>("rpc_command", {
    sessionId,
    command: "compact",
    params: customInstructions ? { customInstructions } : {},
  }),

exportSessionHtml: (sessionId: string, outputPath?: string) =>
  invoke<unknown>("rpc_command", {
    sessionId,
    command: "export_html",
    params: outputPath ? { outputPath } : {},
  }),

setSubagentSubscription: (
  sessionId: string,
  level: "off" | "progress" | "events",
) =>
  invoke<unknown>("rpc_command", {
    sessionId,
    command: "set_subagent_subscription",
    params: { level },
  }),

getSubagentMessages: (
  sessionId: string,
  params: {
    subagentId?: string;
    sessionFile?: string;
    fromByte?: number;
  },
) =>
  invoke<unknown>("rpc_command", {
    sessionId,
    command: "get_subagent_messages",
    params,
  }),

getLoginProviders: (sessionId: string) =>
  invoke<unknown>("rpc_command", {
    sessionId,
    command: "get_login_providers",
    params: {},
  }),

loginProvider: (sessionId: string, providerId: string) =>
  invoke<unknown>("rpc_command", {
    sessionId,
    command: "login",
    params: { providerId },
  }),
```

- [ ] **Step 2: Tests for helper presence / store wiring stubs**
- [ ] **Step 3: `npm --prefix ui test` PASS**
- [ ] **Step 4: Commit** `feat(ui): add typed stock RPC helpers`

### Task 0.3: Docs skeleton for maturity/docs scores

**Files:**
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/FEATURE_MATRIX.md`
- Modify: `README.md` (link both; scoreboard target blurb optional)

- [ ] **Step 1: Write ARCHITECTURE.md** covering Tauri host, per-tab RPC, PTY, SSH, memory SQLite, event bridge, 1 MiB frame limit, stock OMP boundary
- [ ] **Step 2: Write FEATURE_MATRIX.md** with columns: Capability | OMP authority | Desktop surface | Status (`done`/`phase-N`/`wont`)
- [ ] **Step 3: Commit** `docs: add architecture and feature matrix`

**Phase 0 exit criteria:** profile-aware ephemeral RPC; typed RPC helpers; docs exist; full `npm test && npm run lint` green.

---

## Phase 1 — Session Library (largest daily-driver gap)

### Task 1.1: Rust session library scanner

**Files:**
- Create: `src-tauri/src/session_library.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Test: unit tests inside `session_library.rs` using temp dirs

**Types:**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricSessionSummary {
    pub id: String,
    pub path: String,
    pub project: String,
    pub cwd: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
    pub model: Option<String>,
    pub size_bytes: u64,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchHit {
    pub session: HistoricSessionSummary,
    pub line: usize,
    pub snippet: String,
}
```

**Commands to add + register in `lib.rs`:**

- `list_historic_sessions(include_archived: bool) -> Vec<HistoricSessionSummary>`
- `search_historic_sessions(query: String, limit: Option<usize>) -> Vec<SessionSearchHit>`
- `archive_historic_session(path: String) -> ()`
- `unarchive_historic_session(path: String) -> ()`
- `delete_historic_session(path: String) -> ()` (trash if available, else `remove_file` with confirm from UI)
- `rename_historic_session(path: String, title: String) -> ()` (studio-style alias file under `~/.omp/agent/omp-desktop-session-aliases.json`, do **not** rewrite JSONL header unless using RPC `set_session_name` on a live session)
- `reveal_historic_session(path: String) -> ()` optional via opener

**Scanner rules:**

1. Root = `dirs::home_dir()/.omp/agent/sessions`
2. Archive root = `dirs::home_dir()/.omp/agent/sessions-archived` (create on first archive)
3. Only read paths contained under those roots (reject `..` / absolute escapes)
4. Parse first ~64KB + stream count of `type=="message"` for size; full parse only for search hits
5. Sort by `updated_at` desc
6. Cap list default 500; search default 50 hits

- [ ] **Step 1: Failing unit tests** with fixture JSONL in `tempfile`
- [ ] **Step 2: Implement scanner + path containment**
- [ ] **Step 3: `cargo test --manifest-path src-tauri/Cargo.toml session_library` PASS**
- [ ] **Step 4: Register commands**
- [ ] **Step 5: Commit** `feat(host): historical OMP session library backend`

### Task 1.2: UI session library panel

**Files:**
- Modify: `ui/src/session/types.ts` (add historic types)
- Modify: `ui/src/lib/tauri.ts`
- Create: `ui/src/panels/session-library-panel.tsx`
- Modify: `ui/src/panels/sessions-panel.tsx` (tabs: Open | Library)
- Modify: `ui/src/app/shell.tsx` / `palette.tsx` if needed
- Modify: `ui/src/styles.css`
- Test: `ui/tests/session-library.test.ts` (pure filter helpers)

**UX contract:**

- Search box filters title/cwd/project client-side; button triggers host full-text search
- Rows show title, project, relative updated time, message count, model
- Actions: Open (calls existing `openFolder(cwd, pathOrId)` / `create_session` resume), Archive, Restore, Delete (confirm), Copy path, Reveal
- Empty states for no history / no matches
- Keep manual resume input as advanced footer

- [ ] **Step 1: Types + api bindings**
- [ ] **Step 2: Panel UI**
- [ ] **Step 3: Wire resume to existing create/resume path**
- [ ] **Step 4: Tests for filter/sort helpers**
- [ ] **Step 5: Manual smoke** — open Library, resume a real `~/.omp/agent/sessions/**/*.jsonl`
- [ ] **Step 6: Commit** `feat(ui): browse and resume historical sessions`

**Phase 1 exit criteria:** User never needs to paste a raw session id for normal resume; search finds text inside past transcripts.

---

## Phase 2 — Subagents + Attention

### Task 2.1: Subagent event subscription + richer model

**Files:**
- Modify: `ui/src/session/types.ts`

```ts
export interface SubagentInfo {
  id: string;
  name: string;
  agent?: string;
  agentSource?: string;
  status: string;
  progress?: string;
  parentId?: string | null;
  sessionFile?: string | null;
  toolCount?: number;
  tokens?: number;
  currentTool?: string | null;
  lastIntent?: string | null;
}
```

- Modify: `ui/src/session/session-store.ts`
  - On session ready: `set_subagent_subscription` level `"events"` (fallback `"progress"`)
  - Handle `subagent_lifecycle`, `subagent_progress`, `subagent_event` in `applyOmpEvent`
  - Store tree-capable list per session
  - `loadSubagentMessages(sessionId, subagentId, sessionFile?, fromByte?)`
- Test: event reducer unit tests with fixture frames

- [ ] **Step 1: Failing reducer tests**
- [ ] **Step 2: Implement event handling**
- [ ] **Step 3: Commit** `feat(session): subscribe to subagent event stream`

### Task 2.2: Subagent tree + inspector UI

**Files:**
- Create: `ui/src/panels/subagent-tree.ts` (pure hierarchy build)
- Create: `ui/src/panels/subagent-inspector.tsx`
- Modify: `ui/src/panels/subagents-panel.tsx`
- Modify: `ui/src/styles.css`

**UX:**

- Collapsible parent/child tree
- Select node → inspector shows progress, tools, tokens, live/completed transcript via `get_subagent_messages`
- Cancel control only if stock RPC/tool path exists; otherwise hide (no fake buttons)

- [ ] Implement + test tree builder
- [ ] Wire inspector
- [ ] Commit `feat(ui): hierarchical subagent inspector`

### Task 2.3: Cross-session attention inbox

**Files:**
- Create: `ui/src/session/attention.ts` (pure projection)
- Create: `ui/src/panels/attention-panel.tsx`
- Modify: `ui/src/app/layout-store.ts` add `"attention"` panel id
- Modify: `ui/src/app/rails.tsx`, `shell.tsx`, `palette.tsx`
- Modify: `ui/src/session/session-store.ts` to keep `extensionUiRequests` for **all** sessions (already map-shaped — expose aggregate selector)

**Item kinds:** `approval` | `question` | `confirmation` | `plan` | `failed` derived from extension UI + system errors

**Actions:** jump to session + focus dialog; respond via existing `respondExtensionUi`

- [ ] Tests for aggregation/dedupe
- [ ] Panel + rail entry
- [ ] Commit `feat(ui): cross-session attention inbox`

**Phase 2 exit criteria:** Multi-session users can see who needs input without clicking every tab; subagent drill-in shows real child transcripts.

---

## Phase 3 — Structured transcript + review

### Task 3.1: Tool card parsers (pure)

**Files:**
- Create: `ui/src/session/tool-render.ts`
- Create: `ui/src/session/tool-render.test.ts`

Parse `edit` unified diffs into `{ target, adds, rems, lines[] }`; detect `bash` output; detect `eval` cells; keep raw fallback.

- [ ] TDD parsers
- [ ] Commit `feat(ui): parse structured tool payloads`

### Task 3.2: Tool cards + diff view in transcript

**Files:**
- Create: `ui/src/session/diff-view.tsx`
- Create: `ui/src/session/tool-cards.tsx`
- Modify: `ui/src/session/transcript.tsx` (`case "tool"`)
- Modify: `ui/src/session/types.ts` if tool items need structured fields
- Modify: `ui/src/session/session-store.ts` to attach structured detail when tools end
- Modify: `ui/src/styles.css`

**Minimum viable cards:**

- `edit` → diff view (+/− counts, scrollable hunks; scrub optional v2)
- `bash` → mono output, exit if present
- `read` / `search` → path + summary
- `eval` → highlighted-ish mono blocks (no new heavy deps required; optional later)
- default → existing `<pre>`

- [ ] Implement
- [ ] Visual smoke with a coding prompt
- [ ] Commit `feat(ui): structured tool cards and diffs`

### Task 3.3: Review panel (read-only first)

**Files:**
- Create: `ui/src/panels/review-panel.tsx`
- Modify: layout/rails/shell
- Modify: session-store to index file paths touched by edit tools in the active turn

**v1:** list files changed this turn + open diff  
**v2 (only if safe):** keep/discard via git checkout/apply **with explicit confirm**; do not claim OMP `review.apply` unless verified in stock OMP

- [ ] Commit `feat(ui): turn review panel (read-only diffs)`

### Task 3.4: Runtime strip — stats / TPS / cost

**Files:**
- Modify: `ui/src/session/session-store.ts` (`readSessionRuntimeStatus`, turn timing)
- Modify: `ui/src/app/shell.tsx` status chips
- Use `get_session_stats` after `turn_end`

Show: model, thinking, context %, tokens in/out if present, optional cost, crude TPS from turn wall time.

- [ ] Commit `feat(ui): session stats and throughput chips`

**Phase 3 exit criteria:** Coding sessions are readable without opening a terminal; edit diffs are first-class.

---

## Phase 4 — Composer completeness

### Task 4.1: Slash command autocomplete

**Files:**
- Create: `ui/src/session/slash.ts`
- Create: `ui/src/session/slash.test.ts`
- Modify: `ui/src/session/composer.tsx`
- Modify: session-store to cache `get_available_commands` per session

**Behavior:**

- Typing `/` opens popup filtered by `get_available_commands`
- Tab/Enter inserts command skeleton
- Prefer executing via normal prompt text (OMP slash handling) unless command is a host-only action
- Host actions mapped explicitly: compact → `compact`, export → `export_html` + save dialog

- [ ] TDD matcher
- [ ] UI popup
- [ ] Commit `feat(ui): slash command autocomplete`

### Task 4.2: Safe image attachments

**Files:**
- Create: `src-tauri/src/image_attach.rs`
- Modify: `src-tauri/src/session/mod.rs` `prompt` to accept optional images
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `ui/src/session/composer.tsx` (paste/drop)
- Modify: `ui/src/lib/tauri.ts`
- Tests: encode/budget tests in Rust

**Hard rules:**

1. Decode image in Rust
2. Downscale longest edge (e.g. 1600px) + JPEG/WebP quality ladder
3. Build final RPC frame and **reject** if `serde_json` bytes ≥ `MAX_RPC_FRAME_BYTES - 32 KiB` headroom
4. UI validates count (≤ 4) and shows compressed size before send
5. Never base64-expand multi-megabyte screenshots client-side into a single unbounded frame

- [ ] Failing budget test with ~1MB PNG fixture
- [ ] Implement compressor
- [ ] UI paste/drop
- [ ] Commit `feat: safe image attachments under RPC frame budget`

### Task 4.3: File reference chips (local paths)

**Files:**
- Modify: `ui/src/session/composer.tsx`
- Optional: Tauri dialog multi-select files → insert `` `path` `` or `@path` tokens into draft (text-only v1)

No host file-content injection until token budget UI exists.

- [ ] Commit `feat(ui): attach file path chips to composer`

**Phase 4 exit criteria:** Power users can drive OMP commands and images without leaving the composer.

---

## Phase 5 — Auth / providers / usage

### Task 5.1: Login providers UI

**Files:**
- Create: `ui/src/panels/providers-panel.tsx` or section in `settings-panel.tsx`
- Use `get_login_providers` + `login` on a short-lived or active session with **profile-aware** context
- `open_url` already handled in session-store — keep using system browser

- [ ] Commit `feat(ui): provider login via stock OMP RPC`

### Task 5.2: Usage dashboard (host-truth only)

**Files:**
- Extend runtime strip / settings with `get_session_stats` fields
- Do **not** display raw API keys
- Redact tokens in any diagnostics export

- [ ] Commit `feat(ui): show session usage stats`

**Phase 5 exit criteria:** New users can authenticate providers in-app; costs/context are visible.

---

## Phase 6 — Workspaces, files, git context

### Task 6.1: Workspace store

**Files:**
- Create: `ui/src/app/workspace-store.ts` (persist to `localStorage` key `omp-desktop.workspaces.v1`)
- Modify: sessions sidebar to group by workspace/project
- Fields: `{ id, label, cwd, color, pinned, hidden }`

- [ ] Tests for grouping
- [ ] Commit `feat(ui): named workspaces and project grouping`

### Task 6.2: Layout persistence

**Files:**
- Modify: `ui/src/app/layout-store.ts` — persist `pinned`, `drawer`, `sessionsSidebarOpen` via `localStorage`
- Optional widths later

- [ ] Commit `feat(ui): persist panel layout`

### Task 6.3: Git branch chip

**Files:**
- Create: `src-tauri/src/git_status.rs` (`git rev-parse --abbrev-ref HEAD`, `git status --porcelain` bounded)
- Command `get_git_status(cwd: String)`
- Shell header chip

No long-lived watcher required in v1 (poll on focus / every 15s while focused).

- [ ] Commit `feat: show git branch and dirty state`

### Task 6.4: Project file tree (read-only)

**Files:**
- Commands: `list_project_dir(path)`, `read_project_file(path, maxBytes)`
- UI under Project panel
- Hard path containment under session cwd (and remote policy unchanged)

- [ ] Commit `feat(ui): read-only project file browser`

**Phase 6 exit criteria:** Multi-project users get Studio-like workspace ergonomics without Electron.

---

## Phase 7 — Catalogs + GitHub

### Task 7.1: Local catalogs

**Files:**
- Create: `src-tauri/src/catalog.rs` reading `~/.omp/agent` MCP/skills/agents config (best-effort parse)
- UI panel tabs: Skills (exists) / MCP / Agents / Commands (live session commands)

- [ ] Commit `feat: browse MCP, agents, and commands`

### Task 7.2: GitHub panel via `gh`

**Files:**
- Create: `src-tauri/src/github.rs` (`gh repo view/issue list/pr list --json ...`)
- UI panel; degrade gracefully if `gh` missing

- [ ] Commit `feat: GitHub issues and PR panel`

**Phase 7 exit criteria:** Discoverability matches Studio’s local cockpit strengths.

---

## Phase 8 — Packaging, Linux, release maturity

### Task 8.1: Release workflow

**Files:**
- Create: `.github/workflows/release.yml` on `v*` tags
- Modify: `.github/workflows/desktop.yml` keep PR CI
- Modify: `src-tauri/tauri.conf.json` versioning notes
- README install section with release links

**Release job must:**

1. Run tests/lint
2. Build macOS universal + Windows NSIS (+ Linux deb/AppImage matrix)
3. Upload to GitHub Release
4. (Follow-up) signing/notarization secrets when available

- [ ] Commit `ci: publish desktop GitHub releases on tags`

### Task 8.2: Linux target

**Files:**
- Extend matrix with `ubuntu-latest` bundle
- Document deps in README

- [ ] Commit `feat(ci): linux desktop bundles`

### Task 8.3: Updater (after first public release)

**Files:**
- Add `tauri-plugin-updater` carefully with pubkey
- Only enable when release pipeline is real

- [ ] Commit `feat: in-app update checks`

### Task 8.4: E2E smoke

**Files:**
- Create: `ui/e2e/smoke.spec.ts` or Playwright against `tauri` dev if feasible; otherwise scripted `cargo test` + UI unit gates in CI
- Document manual QA checklist expansion in README

- [ ] Commit `test: expand release smoke coverage`

**Phase 8 exit criteria:** Strangers can install from Releases; packaging score jumps; maturity visible.

---

## Phase 9 — Polish that wins UX without scope creep

### Task 9.1: Plan approve/revise actions

Use existing todos + composer prompts:

- Buttons: Approve plan / Request changes  
- Sends structured follow-up text (no fake OMP plan protocol)

### Task 9.2: Session minimap (optional, low priority)

Port apoc idea only after Phases 1–4.

### Task 9.3: Performance

- Cap transcript render window (virtualize or window last N messages with “load older”)
- Avoid holding global SessionManager lock across long RPC (fix if still true in `commands/mod.rs`)

- [ ] Commit as needed per item

---

## Implementation order (ship sequence)

```text
Phase 0 foundations
  → Phase 1 session library          ## biggest product jump
  → Phase 2 subagents + attention    ## multi-session ops
  → Phase 3 structured transcript    ## Codex-like readability
  → Phase 4 composer                 ## power-user speed
  → Phase 5 auth/usage
  → Phase 6 workspaces/files/git
  → Phase 7 catalogs/GitHub
  → Phase 8 releases/Linux
  → Phase 9 polish
```

Each phase = mergeable PR series. Do not open one 4k-line PR.

## Verification gates (every phase)

```bash
npm test
npm run lint
npm run ui:build
# phase-specific:
cargo test --manifest-path src-tauri/Cargo.toml
# manual:
npm run dev
# exercise the new path on a real omp session
```

## Scoreboard checkpoint after Phase 4 (expected)

[INFERENCE] ~86–88/100 — ahead of Studio on stock-OMP Tauri path for core coding UX; still behind T4 on multi-host fleet until/unless stock OMP grows host APIs.

## Scoreboard checkpoint after Phase 8 (target)

[INFERENCE] ≥91/100 — #1 **stock-OMP** desktop: better Windows story than T4, better native/SSH/memory than Studio, real releases, deeper session/subagent/review UX.

## Risk register

| Risk | Mitigation |
|---|---|
| Image frames exceed 1 MiB | Server-side compress + hard reject |
| Destructive config writes | Never rewrite whole YAML; use OMP APIs / surgical edits |
| Fake T4 keep/discard without authority | Read-only review until proven safe |
| Session scan slow on huge libraries | Bound reads, lazy search, cap list |
| CI signing secrets missing | Ship unsigned releases first, document; add notarization next |
| Scope explosion | Non-goals list is binding |

## Self-review (plan author)

1. **Spec coverage:** Competitive gaps from the comparison (session library, subagents/attention, diffs/review, slash/images, auth/usage, workspaces/files/git, catalogs/GitHub, releases/Linux, docs/tests) each map to a phase/task.
2. **Placeholders:** None intentional; code samples are starting points implementers must adapt to exact serde shapes from live `get_state` / JSONL.
3. **Type consistency:** `HistoricSessionSummary`, richer `SubagentInfo`, panel id `attention` introduced once and reused.
4. **T4 trap avoided:** No authority-bridge dependency in the critical path.

---

## Execution handoff

Plan complete for commit at:

`docs/superpowers/plans/2026-07-21-number-one-roadmap.md`

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute phase-by-phase in one session with checkpoints  

Start at **Phase 0 / Task 0.1** unless directed otherwise.
