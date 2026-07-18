# Task Progress Strip — Design

**Date:** 2026-07-19  
**Status:** Approved for implementation  
**App:** OMP Desktop

## Summary

Add a minimal **hybrid task completion visualizer** as an always-on **header strip** above the chat column. It shows a session goal (auto from OMP todos/plan, optionally overridden) and a **calm crawl** progress bar driven by live todo phases, with compact step chips for the current phase.

## Goals

- Make slow agent work feel continuous without faking completion.
- Surface plan/todo progress without opening the Plan panel.
- Stay visually quiet; motion only while work is active.

## Non-goals

- Job-board pinning
- Editing todos from the strip
- Celebration confetti/sound
- New Rust/RPC APIs
- Showing the strip on the empty home (no active session)

## Placement

- Inside the main chat column, **above** the transcript, full chat width.
- Only when `activeSessionId` is set.
- Does not replace the Plan panel; Plan remains the detailed view.

## Anatomy

1. **Goal row**
   - Eyebrow: `GOAL` plus optional `done/total`
   - Title: resolved goal string (ellipsis + tooltip)
   - When override active: small clear control (`↺`)
2. **Calm crawl bar**
   - Track + fill
3. **Step chips**
   - Current phase tasks as compact chips with status dots
   - Cap visible chips (~6) + `+N` overflow

## Data

### Existing

- `TodoPhase[]` from session store (`selectActiveTodos`)
- `streaming[sessionId]` boolean
- Task statuses already normalized as strings (`pending`, `in_progress`, `done`, `completed`, etc.)

### New (UI-only)

- Per-session goal override map: `Record<sessionId, string>`
- Persist to `localStorage` key `omp-desktop.goal-override.v1`

## Goal title resolution

1. Non-empty override → override  
2. Else phase containing an `in_progress` task → that phase name  
3. Else first phase with incomplete tasks → that phase name  
4. Else last phase name if any phases exist  
5. Else placeholder: `Set a session goal…`

## Progress math

- Treat task done if status is `done` or `completed` (case-insensitive).
- Treat task active if status is `in_progress` or `in-progress` or `active`.
- `base = doneCount / totalCount` when `totalCount > 0`, else `0`.
- Display fill:
  - Idle: `display = base`
  - Active crawl when (active task exists OR streaming) AND incomplete todos remain:
    - Ceiling = `min(1, base + 0.9 / totalCount)` (if totalCount=0, no crawl)
    - Ease display toward ceiling asymptotically; never cross next full notch until real completion
  - On `base` increase: ease quickly to new base
  - All done: `display = 1`, success styling

## Motion

- Real progress changes: ~500–700ms ease-out width transition
- Active crawl: slow ease toward ceiling (~8–12s feel), soft strip glow pulse
- Active chip dot: gentle opacity pulse
- `prefers-reduced-motion: reduce`: no pulse/crawl; jump to real base only

## Interaction

- Click goal title → inline edit
- Enter or blur → save override (trim; empty save clears override)
- Escape → cancel edit
- Clear control → remove override, return to auto title

## Empty states

| State | UI |
|-------|----|
| No session | Strip unmounted |
| Session, no todos, no override | Collapsed: placeholder goal, ghost bar, no chips, no motion |
| Session, no todos, override set | Show override goal, ghost bar |
| Todos present | Full anatomy |
| All tasks done | 100% bar, muted success, chips all done |

## Components

- `ui/src/app/task-progress-strip.tsx` — UI + edit chrome
- `ui/src/app/use-task-progress.ts` — pure derivation + crawl display state + override persistence
- Styles in `ui/src/styles.css`
- Mount from `ui/src/app/shell.tsx` in the chat column

## Testing

- Unit-test pure helpers: done detection, goal resolution, base progress, ceiling.
- Manual: open session with todos (or mock store), verify crawl while streaming, snap on complete, override round-trip, reduced-motion.

## Success criteria

- Hybrid goal (auto + override) works per session.
- Bar reflects real todo completion and calm-crawls only while work is active.
- Strip is minimal and matches titanium dark cockpit.
- No new backend surface.
