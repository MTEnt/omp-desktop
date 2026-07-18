# Task Progress Strip Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Add a hybrid calm-crawl task completion strip above chat, driven by OMP todos with optional goal override.

**Architecture:** Pure derivation helpers + React strip component mounted in shell chat column. No Rust changes.

**Tech Stack:** React 19, TypeScript, existing Zustand session store, CSS animations.

---

### Task 1: Pure progress helpers + tests

**Files:**
- Create: `ui/src/app/task-progress.ts`
- Create: `ui/src/app/task-progress.test.ts`

### Task 2: Hook for crawl display + overrides

**Files:**
- Create: `ui/src/app/use-task-progress.ts`

### Task 3: Strip component + styles + shell mount

**Files:**
- Create: `ui/src/app/task-progress-strip.tsx`
- Modify: `ui/src/app/shell.tsx`
- Modify: `ui/src/styles.css`

### Task 4: Build verify + commit
