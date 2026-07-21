import { create } from "zustand";

import type { SessionInfo } from "../session/types.ts";

export const WORKSPACE_STORAGE_KEY = "omp-desktop.workspaces.v1";

export const WORKSPACE_COLOR_PRESETS = [
  "#00b4ff",
  "#7ee787",
  "#d2a8ff",
  "#ffa657",
  "#ff7b72",
  "#79c0ff",
] as const;

export interface Workspace {
  id: string;
  label: string;
  cwd: string;
  color: string;
  pinned: boolean;
  hidden: boolean;
}

export interface WorkspaceGroup {
  workspace: Workspace | null;
  /** Normalized cwd key used for grouping when workspace is null. */
  cwdKey: string;
  label: string;
  color: string | null;
  sessions: SessionInfo[];
}

interface WorkspaceStore {
  workspaces: Workspace[];
  upsertWorkspace: (
    input: Partial<Omit<Workspace, "cwd">> & { cwd: string },
  ) => Workspace;
  removeWorkspace: (id: string) => void;
  togglePin: (id: string) => void;
  toggleHidden: (id: string) => void;
  updateWorkspace: (
    id: string,
    patch: Partial<Pick<Workspace, "label" | "color" | "pinned" | "hidden">>,
  ) => void;
  workspaceForCwd: (cwd: string) => Workspace | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Light path normalize: trim, unify separators, drop trailing slashes (except root). */
export const normalizeCwd = (cwd: string): string => {
  let value = cwd.trim().replaceAll("\\", "/");
  if (!value) return "";

  // Collapse repeated slashes but keep leading protocol-style // for remote keys.
  if (value.startsWith("//") && !value.startsWith("///")) {
    value = `//${value.slice(2).replace(/\/{2,}/g, "/")}`;
  } else {
    value = value.replace(/\/{2,}/g, "/");
  }

  if (value.length > 1 && value.endsWith("/")) {
    value = value.replace(/\/+$/g, "");
  }

  // Windows drive letter consistency: C:/foo
  if (/^[a-zA-Z]:\//.test(value)) {
    value = value[0]!.toUpperCase() + value.slice(1);
  }

  return value;
};

export const basenameFromCwd = (cwd: string): string => {
  const normalized = normalizeCwd(cwd);
  if (!normalized) return "Workspace";
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) || normalized || "Workspace";
};

export const defaultColorForCwd = (cwd: string): string => {
  const key = normalizeCwd(cwd);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return WORKSPACE_COLOR_PRESETS[hash % WORKSPACE_COLOR_PRESETS.length]!;
};

const newWorkspaceId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const parseWorkspaces = (raw: unknown): Workspace[] => {
  if (!Array.isArray(raw)) return [];
  const out: Workspace[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const cwd = typeof entry.cwd === "string" ? normalizeCwd(entry.cwd) : "";
    if (!cwd || seen.has(cwd)) continue;
    seen.add(cwd);

    const id =
      typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : newWorkspaceId();
    const label =
      typeof entry.label === "string" && entry.label.trim()
        ? entry.label.trim()
        : basenameFromCwd(cwd);
    const color =
      typeof entry.color === "string" && entry.color.trim()
        ? entry.color.trim()
        : defaultColorForCwd(cwd);

    out.push({
      id,
      label,
      cwd,
      color,
      pinned: entry.pinned === true,
      hidden: entry.hidden === true,
    });
  }

  return out;
};

export const loadWorkspaces = (): Workspace[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return [];
    return parseWorkspaces(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
};

export const saveWorkspaces = (workspaces: Workspace[]): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaces));
  } catch {
    // ignore quota / private mode
  }
};

export const workspaceForCwd = (
  cwd: string,
  workspaces: readonly Workspace[],
): Workspace | undefined => {
  const key = normalizeCwd(cwd);
  if (!key) return undefined;
  return workspaces.find((workspace) => normalizeCwd(workspace.cwd) === key);
};

const sessionGroupKey = (session: SessionInfo): string => {
  if (session.remote) {
    const remoteRoot = session.remote.remoteCwd.trim() || "~";
    const suffix = remoteRoot.startsWith("/") ? remoteRoot : `/${remoteRoot}`;
    return normalizeCwd(`ssh://${session.remote.hostName}${suffix}`);
  }
  return normalizeCwd(session.cwd);
};

const fallbackGroupLabel = (session: SessionInfo, cwdKey: string): string => {
  if (session.remote) {
    const remoteRoot = session.remote.remoteCwd.replace(/\/+$/g, "");
    const folder = remoteRoot.split("/").filter(Boolean).at(-1) || "~";
    return `${session.remote.hostName}:${folder}`;
  }
  return basenameFromCwd(cwdKey || session.cwd);
};

/**
 * Group open sessions by workspace cwd when a named workspace exists,
 * otherwise by normalized cwd folder. Pinned named workspaces sort first.
 */
export const groupSessionsByWorkspace = (
  sessions: readonly SessionInfo[],
  workspaces: readonly Workspace[],
): WorkspaceGroup[] => {
  const buckets = new Map<
    string,
    {
      workspace: Workspace | null;
      cwdKey: string;
      label: string;
      color: string | null;
      sessions: SessionInfo[];
      order: number;
    }
  >();

  sessions.forEach((session, index) => {
    const cwdKey = sessionGroupKey(session);
    const named =
      workspaceForCwd(session.remote ? cwdKey : session.cwd, workspaces) ??
      workspaces.find((workspace) => normalizeCwd(workspace.cwd) === cwdKey) ??
      null;

    const key = named?.id ?? `cwd:${cwdKey || session.id}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.sessions.push(session);
      return;
    }

    buckets.set(key, {
      workspace: named,
      cwdKey: named ? normalizeCwd(named.cwd) : cwdKey,
      label: named?.label ?? fallbackGroupLabel(session, cwdKey),
      color: named?.color ?? null,
      sessions: [session],
      order: index,
    });
  });

  const groups = [...buckets.values()];
  groups.sort((a, b) => {
    const aPinned = a.workspace?.pinned === true ? 0 : 1;
    const bPinned = b.workspace?.pinned === true ? 0 : 1;
    if (aPinned !== bPinned) return aPinned - bPinned;

    const aNamed = a.workspace ? 0 : 1;
    const bNamed = b.workspace ? 0 : 1;
    if (aNamed !== bNamed) return aNamed - bNamed;

    const labelCmp = a.label.localeCompare(b.label, undefined, {
      sensitivity: "base",
    });
    if (labelCmp !== 0) return labelCmp;
    return a.order - b.order;
  });

  return groups.map(({ workspace, cwdKey, label, color, sessions: grouped }) => ({
    workspace,
    cwdKey,
    label,
    color,
    sessions: grouped,
  }));
};

const persist = (workspaces: Workspace[]): Workspace[] => {
  saveWorkspaces(workspaces);
  return workspaces;
};

export const useWorkspaceStore = create<WorkspaceStore>()((set, get) => ({
  workspaces: loadWorkspaces(),

  upsertWorkspace: (input) => {
    const cwd = normalizeCwd(input.cwd);
    if (!cwd) {
      throw new Error("Workspace cwd is required");
    }

    const current = get().workspaces;
    const existing = workspaceForCwd(cwd, current);
    let nextWorkspace: Workspace;

    if (existing) {
      nextWorkspace = {
        ...existing,
        label:
          typeof input.label === "string" && input.label.trim()
            ? input.label.trim()
            : existing.label,
        color:
          typeof input.color === "string" && input.color.trim()
            ? input.color.trim()
            : existing.color,
        pinned:
          typeof input.pinned === "boolean" ? input.pinned : existing.pinned,
        hidden:
          typeof input.hidden === "boolean" ? input.hidden : existing.hidden,
        cwd,
      };
      const workspaces = persist(
        current.map((workspace) =>
          workspace.id === existing.id ? nextWorkspace : workspace,
        ),
      );
      set({ workspaces });
      return nextWorkspace;
    }

    nextWorkspace = {
      id:
        typeof input.id === "string" && input.id.trim()
          ? input.id.trim()
          : newWorkspaceId(),
      label:
        typeof input.label === "string" && input.label.trim()
          ? input.label.trim()
          : basenameFromCwd(cwd),
      cwd,
      color:
        typeof input.color === "string" && input.color.trim()
          ? input.color.trim()
          : defaultColorForCwd(cwd),
      pinned: input.pinned === true,
      hidden: input.hidden === true,
    };

    set({ workspaces: persist([...current, nextWorkspace]) });
    return nextWorkspace;
  },

  removeWorkspace: (id) => {
    set((state) => ({
      workspaces: persist(
        state.workspaces.filter((workspace) => workspace.id !== id),
      ),
    }));
  },

  togglePin: (id) => {
    set((state) => ({
      workspaces: persist(
        state.workspaces.map((workspace) =>
          workspace.id === id
            ? { ...workspace, pinned: !workspace.pinned }
            : workspace,
        ),
      ),
    }));
  },

  toggleHidden: (id) => {
    set((state) => ({
      workspaces: persist(
        state.workspaces.map((workspace) =>
          workspace.id === id
            ? { ...workspace, hidden: !workspace.hidden }
            : workspace,
        ),
      ),
    }));
  },

  updateWorkspace: (id, patch) => {
    set((state) => ({
      workspaces: persist(
        state.workspaces.map((workspace) => {
          if (workspace.id !== id) return workspace;
          return {
            ...workspace,
            label:
              typeof patch.label === "string" && patch.label.trim()
                ? patch.label.trim()
                : workspace.label,
            color:
              typeof patch.color === "string" && patch.color.trim()
                ? patch.color.trim()
                : workspace.color,
            pinned:
              typeof patch.pinned === "boolean"
                ? patch.pinned
                : workspace.pinned,
            hidden:
              typeof patch.hidden === "boolean"
                ? patch.hidden
                : workspace.hidden,
          };
        }),
      ),
    }));
  },

  workspaceForCwd: (cwd) => workspaceForCwd(cwd, get().workspaces),
}));
