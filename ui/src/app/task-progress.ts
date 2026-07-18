import type { TodoPhase, TodoTask } from "../session/types.ts";

export type TaskChipStatus = "pending" | "active" | "done";

export interface TaskProgressChip {
  id: string;
  label: string;
  status: TaskChipStatus;
}

export interface TaskProgressModel {
  goal: string;
  goalIsPlaceholder: boolean;
  goalIsOverride: boolean;
  phaseName: string | null;
  doneCount: number;
  totalCount: number;
  base: number;
  ceiling: number;
  crawling: boolean;
  allDone: boolean;
  empty: boolean;
  chips: TaskProgressChip[];
  overflowCount: number;
}

const DONE = new Set(["done", "completed"]);
const ACTIVE = new Set(["in_progress", "in-progress", "active", "running"]);

export const isTaskDone = (status: string): boolean =>
  DONE.has(status.trim().toLowerCase());

export const isTaskActive = (status: string): boolean =>
  ACTIVE.has(status.trim().toLowerCase());

export const flattenTasks = (phases: TodoPhase[]): TodoTask[] =>
  phases.flatMap((phase) => phase.tasks);

export const countProgress = (
  phases: TodoPhase[],
): { doneCount: number; totalCount: number; base: number } => {
  const tasks = flattenTasks(phases);
  const totalCount = tasks.length;
  const doneCount = tasks.filter((task) => isTaskDone(task.status)).length;
  const base = totalCount === 0 ? 0 : doneCount / totalCount;
  return { doneCount, totalCount, base };
};

export const findActivePhase = (phases: TodoPhase[]): TodoPhase | null => {
  for (const phase of phases) {
    if (phase.tasks.some((task) => isTaskActive(task.status))) return phase;
  }
  for (const phase of phases) {
    if (phase.tasks.some((task) => !isTaskDone(task.status))) return phase;
  }
  return phases.length > 0 ? phases[phases.length - 1]! : null;
};

export const resolveGoalTitle = (input: {
  phases: TodoPhase[];
  override: string | null | undefined;
}): { goal: string; goalIsPlaceholder: boolean; goalIsOverride: boolean; phaseName: string | null } => {
  const trimmed = input.override?.trim() ?? "";
  const phase = findActivePhase(input.phases);
  const phaseName = phase?.name ?? null;

  if (trimmed) {
    return {
      goal: trimmed,
      goalIsPlaceholder: false,
      goalIsOverride: true,
      phaseName,
    };
  }

  if (phaseName) {
    return {
      goal: phaseName,
      goalIsPlaceholder: false,
      goalIsOverride: false,
      phaseName,
    };
  }

  return {
    goal: "Set a session goal…",
    goalIsPlaceholder: true,
    goalIsOverride: false,
    phaseName: null,
  };
};

export const buildChips = (
  phases: TodoPhase[],
  maxVisible = 6,
): { chips: TaskProgressChip[]; overflowCount: number } => {
  const phase = findActivePhase(phases);
  if (!phase) return { chips: [], overflowCount: 0 };

  const mapped: TaskProgressChip[] = phase.tasks.map((task) => {
    let status: TaskChipStatus = "pending";
    if (isTaskDone(task.status)) status = "done";
    else if (isTaskActive(task.status)) status = "active";
    return {
      id: task.id,
      label: task.content,
      status,
    };
  });

  if (mapped.length <= maxVisible) {
    return { chips: mapped, overflowCount: 0 };
  }

  return {
    chips: mapped.slice(0, maxVisible),
    overflowCount: mapped.length - maxVisible,
  };
};

export const crawlCeiling = (base: number, totalCount: number): number => {
  if (totalCount <= 0) return base;
  if (base >= 1) return 1;
  return Math.min(1, base + 0.9 / totalCount);
};

export const deriveTaskProgress = (input: {
  phases: TodoPhase[];
  override?: string | null;
  streaming?: boolean;
  maxChips?: number;
}): TaskProgressModel => {
  const { doneCount, totalCount, base } = countProgress(input.phases);
  const goal = resolveGoalTitle({
    phases: input.phases,
    override: input.override,
  });
  const { chips, overflowCount } = buildChips(
    input.phases,
    input.maxChips ?? 6,
  );
  const hasActiveTask = flattenTasks(input.phases).some((task) =>
    isTaskActive(task.status),
  );
  const incomplete = totalCount > 0 && doneCount < totalCount;
  const crawling =
    incomplete && (hasActiveTask || input.streaming === true);
  const allDone = totalCount > 0 && doneCount === totalCount;
  const ceiling = crawling ? crawlCeiling(base, totalCount) : base;

  return {
    goal: goal.goal,
    goalIsPlaceholder: goal.goalIsPlaceholder,
    goalIsOverride: goal.goalIsOverride,
    phaseName: goal.phaseName,
    doneCount,
    totalCount,
    base,
    ceiling,
    crawling,
    allDone,
    empty: totalCount === 0,
    chips,
    overflowCount,
  };
};

const STORAGE_KEY = "omp-desktop.goal-override.v1";

export const loadGoalOverrides = (): Record<string, string> => {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
};

export const saveGoalOverrides = (map: Record<string, string>): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
};

/** Ease display progress toward a target (0–1). */
export const stepDisplayProgress = (
  current: number,
  target: number,
  dtMs: number,
  crawling: boolean,
): number => {
  const clampedCurrent = Math.min(1, Math.max(0, current));
  const clampedTarget = Math.min(1, Math.max(0, target));
  if (Math.abs(clampedTarget - clampedCurrent) < 0.0005) return clampedTarget;

  // Completions / regressions settle faster than the slow active crawl.
  const tau = crawling && clampedTarget >= clampedCurrent ? 2800 : 280;
  const alpha = 1 - Math.exp(-dtMs / tau);
  return clampedCurrent + (clampedTarget - clampedCurrent) * alpha;
};
