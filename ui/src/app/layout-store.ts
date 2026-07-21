import { create } from "zustand";

export type PanelId =
  | "sessions"
  | "project"
  | "agents"
  | "settings"
  | "terminal"
  | "plan"
  | "activity"
  | "subagents"
  | "jobs"
  | "memory"
  | "scratchpad"
  | "browser"
  | "companion"
  | "launch";

interface LayoutStore {
  drawer: PanelId | null;
  pinned: PanelId[];
  sessionsSidebarOpen: boolean;
  agentsFocusRole: string | null;
  openDrawer: (panel: PanelId) => void;
  closeDrawer: () => void;
  togglePin: (panel: PanelId) => void;
  toggleDrawer: (panel: PanelId) => void;
  setSessionsSidebarOpen: (open: boolean) => void;
  toggleSessionsSidebar: () => void;
  setAgentsFocusRole: (role: string | null) => void;
}

export const useLayoutStore = create<LayoutStore>()((set) => ({
  drawer: null,
  pinned: [],
  sessionsSidebarOpen: false,
  agentsFocusRole: null,
  openDrawer: (panel) => set({ drawer: panel }),
  closeDrawer: () => set({ drawer: null }),
  togglePin: (panel) =>
    set((state) => ({
      pinned: state.pinned.includes(panel)
        ? state.pinned.filter((candidate) => candidate !== panel)
        : [...state.pinned, panel],
    })),
  toggleDrawer: (panel) =>
    set((state) => ({ drawer: state.drawer === panel ? null : panel })),
  setSessionsSidebarOpen: (open) => set({ sessionsSidebarOpen: open }),
  toggleSessionsSidebar: () =>
    set((state) => ({ sessionsSidebarOpen: !state.sessionsSidebarOpen })),
  setAgentsFocusRole: (role) => set({ agentsFocusRole: role }),
}));
