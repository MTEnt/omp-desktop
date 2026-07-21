import { create } from "zustand";

export type PanelId =
  | "sessions"
  | "project"
  | "settings"
  | "terminal"
  | "plan"
  | "activity"
  | "attention"
  | "review"
  | "subagents"
  | "jobs"
  | "memory"
  | "scratchpad"
  | "browser"
  | "companion"
  | "launch"
  | "catalog"
  | "github";

export const LAYOUT_STORAGE_KEY = "omp-desktop.layout.v1";

const PANEL_IDS: Record<PanelId, true> = {
  sessions: true,
  project: true,
  settings: true,
  terminal: true,
  plan: true,
  activity: true,
  attention: true,
  review: true,
  subagents: true,
  jobs: true,
  memory: true,
  scratchpad: true,
  browser: true,
  companion: true,
  launch: true,
  catalog: true,
  github: true,
};

export interface LayoutPersistedState {
  drawer: PanelId | null;
  pinned: PanelId[];
  sessionsSidebarOpen: boolean;
}

interface LayoutStore extends LayoutPersistedState {
  openDrawer: (panel: PanelId) => void;
  closeDrawer: () => void;
  togglePin: (panel: PanelId) => void;
  toggleDrawer: (panel: PanelId) => void;
  setSessionsSidebarOpen: (open: boolean) => void;
  toggleSessionsSidebar: () => void;
}

const isPanelId = (value: unknown): value is PanelId =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(PANEL_IDS, value);

/** Parse a localStorage payload into a partial layout state; drops invalid panel ids. */
export const parseLayoutState = (
  raw: string | null,
): Partial<LayoutPersistedState> => {
  if (raw == null || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    const record = parsed as Record<string, unknown>;
    const next: Partial<LayoutPersistedState> = {};

    if ("drawer" in record) {
      if (record.drawer === null) {
        next.drawer = null;
      } else if (isPanelId(record.drawer)) {
        next.drawer = record.drawer;
      }
    }

    if (Array.isArray(record.pinned)) {
      next.pinned = record.pinned.filter(isPanelId);
    }

    if (typeof record.sessionsSidebarOpen === "boolean") {
      next.sessionsSidebarOpen = record.sessionsSidebarOpen;
    }

    return next;
  } catch {
    return {};
  }
};

export const loadLayoutState = (): Partial<LayoutPersistedState> => {
  if (typeof localStorage === "undefined") return {};
  try {
    return parseLayoutState(localStorage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    return {};
  }
};

export const saveLayoutState = (state: LayoutPersistedState): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        drawer: state.drawer,
        pinned: state.pinned,
        sessionsSidebarOpen: state.sessionsSidebarOpen,
      } satisfies LayoutPersistedState),
    );
  } catch {
    // ignore quota / private mode
  }
};

const persist = (
  drawer: PanelId | null,
  pinned: PanelId[],
  sessionsSidebarOpen: boolean,
): LayoutPersistedState => {
  const next = { drawer, pinned, sessionsSidebarOpen };
  saveLayoutState(next);
  return next;
};

const initial = loadLayoutState();

export const useLayoutStore = create<LayoutStore>()((set) => ({
  drawer: initial.drawer ?? null,
  pinned: initial.pinned ?? [],
  sessionsSidebarOpen: initial.sessionsSidebarOpen ?? false,

  openDrawer: (panel) =>
    set((state) => persist(panel, state.pinned, state.sessionsSidebarOpen)),
  closeDrawer: () =>
    set((state) => persist(null, state.pinned, state.sessionsSidebarOpen)),
  togglePin: (panel) =>
    set((state) =>
      persist(
        state.drawer,
        state.pinned.includes(panel)
          ? state.pinned.filter((candidate) => candidate !== panel)
          : [...state.pinned, panel],
        state.sessionsSidebarOpen,
      ),
    ),
  toggleDrawer: (panel) =>
    set((state) =>
      persist(
        state.drawer === panel ? null : panel,
        state.pinned,
        state.sessionsSidebarOpen,
      ),
    ),
  setSessionsSidebarOpen: (open) =>
    set((state) => persist(state.drawer, state.pinned, open)),
  toggleSessionsSidebar: () =>
    set((state) =>
      persist(state.drawer, state.pinned, !state.sessionsSidebarOpen),
    ),
}));
