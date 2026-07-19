import { create } from "zustand";
import { api, openDirectoryDialog } from "../lib/tauri.ts";
import type {
  ActivityItem,
  AppSettings,
  AvailableModel,
  ModelRoleAssignment,
  RemoteTarget,
  SkillInfo,
  LaunchRecipe,
  CompanionTarget,
  BrowserArtifact,
  SessionInfo,
  SubagentInfo,
  TodoPhase,
  TranscriptItem,
} from "./types.ts";

type OmpEvent = Record<string, unknown>;

export interface SessionStore {
  settings: AppSettings | null;
  modelRoles: ModelRoleAssignment[];
  modelRolesConfigPath: string | null;
  availableModels: AvailableModel[];
  availableModelsLoaded: boolean;
  loadSettings: () => Promise<void>;
  loadModelRoles: () => Promise<void>;
  loadAvailableModels: () => Promise<void>;
  setModelRole: (role: string, selector: string) => Promise<boolean>;
  saveSettings: (settings: AppSettings) => Promise<boolean>;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  transcripts: Record<string, TranscriptItem[]>;
  activity: Record<string, ActivityItem[]>;
  todos: Record<string, TodoPhase[]>;
  subagents: Record<string, SubagentInfo[]>;
  states: Record<string, unknown>;
  error: string | null;
  streaming: Record<string, boolean>;
  bootstrap: () => Promise<void>;
  setActive: (sessionId: string | null) => void;
  openFolder: (cwd?: string, resume?: string) => Promise<void>;
  openSshSession: (remote: RemoteTarget) => Promise<void>;
  browserArtifacts: Record<string, BrowserArtifact[]>;
  companions: Record<string, CompanionTarget[]>;
  activeCompanionId: string | null;
  skills: SkillInfo[];
  skillsLoaded: boolean;
  loadSkills: () => Promise<void>;
  launchRecipe: (recipe: LaunchRecipe, vars?: Record<string, string>) => Promise<boolean>;
  launchSkill: (skillName: string, args?: string) => Promise<boolean>;
  launchBrowser: (url: string, headed?: boolean) => Promise<boolean>;
  setActiveCompanion: (id: string | null) => void;
  clearBrowserArtifacts: (sessionId?: string) => void;
  restartSession: (sessionId: string) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  refreshState: (sessionId: string) => Promise<void>;
  loadSubagents: (sessionId: string) => Promise<void>;
  send: (message: string, streamingBehavior?: string) => Promise<boolean>;
  abort: () => Promise<void>;
  applyOmpEvent: (sessionId: string, event: unknown) => void;
  updateAssistantText: (sessionId: string, itemId: string, text: string) => Promise<boolean>;
  markExited: (sessionId: string) => void;
  clearError: () => void;
  roleMemoryCache: Record<string, { preamble: string; loadedAt: number }>;
  ensureRoleMemoryPreamble: (role: string, cwd: string, sessionId: string) => Promise<string>;
}

const EMPTY_TRANSCRIPT: TranscriptItem[] = [];
const EMPTY_ACTIVITY: ActivityItem[] = [];
const EMPTY_TODOS: TodoPhase[] = [];
const EMPTY_SUBAGENTS: SubagentInfo[] = [];

export const selectActiveTranscript = (
  state: SessionStore,
): TranscriptItem[] =>
  state.activeSessionId
    ? (state.transcripts[state.activeSessionId] ?? EMPTY_TRANSCRIPT)
    : EMPTY_TRANSCRIPT;

export const selectActiveActivity = (state: SessionStore): ActivityItem[] =>
  state.activeSessionId
    ? (state.activity[state.activeSessionId] ?? EMPTY_ACTIVITY)
    : EMPTY_ACTIVITY;

export const selectActiveTodos = (state: SessionStore): TodoPhase[] =>
  state.activeSessionId
    ? (state.todos[state.activeSessionId] ?? EMPTY_TODOS)
    : EMPTY_TODOS;

export const selectActiveStreaming = (state: SessionStore): boolean =>
  state.activeSessionId
    ? state.streaming[state.activeSessionId] === true
    : false;

export const selectActiveSubagents = (state: SessionStore): SubagentInfo[] =>
  state.activeSessionId
    ? (state.subagents[state.activeSessionId] ?? EMPTY_SUBAGENTS)
    : EMPTY_SUBAGENTS;

export const selectActiveSession = (
  state: SessionStore,
): SessionInfo | undefined =>
  state.sessions.find((session) => session.id === state.activeSessionId);

export const selectActiveRuntimeSnapshot = (
  state: SessionStore,
): unknown =>
  state.activeSessionId ? state.states[state.activeSessionId] : undefined;

export const selectIsActiveStreaming = (state: SessionStore): boolean =>
  state.activeSessionId
    ? state.streaming[state.activeSessionId] === true
    : false;

const isRecord = (value: unknown): value is OmpEvent =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): OmpEvent | null =>
  isRecord(value) ? value : null;

export interface SessionRuntimeStatus {
  model: string | null;
  modelId: string | null;
  provider: string | null;
  thinkingLevel: string | null;
  contextPercent: number | null;
}

const formatModelLabel = (
  provider: string | null,
  modelId: string | null,
  fallback: string | null,
): string | null => {
  if (provider && modelId) return `${provider}/${modelId}`;
  return modelId ?? fallback;
};

export const readSessionRuntimeStatus = (
  snapshot: unknown,
): SessionRuntimeStatus => {
  const envelope = asRecord(snapshot);
  const state = asRecord(envelope?.data) ?? envelope;
  const contextUsage = asRecord(state?.contextUsage);
  const modelValue = state?.model;
  const modelRecord = asRecord(modelValue);
  const modelId =
    (modelRecord ? readString(modelRecord, "id", "modelId", "name") : undefined) ??
    (typeof modelValue === "string" ? modelValue : null);
  const provider =
    (modelRecord ? readString(modelRecord, "provider") : undefined) ?? null;

  return {
    model: formatModelLabel(provider, modelId, typeof modelValue === "string" ? modelValue : null),
    modelId,
    provider,
    thinkingLevel:
      typeof state?.thinkingLevel === "string" ? state.thinkingLevel : null,
    contextPercent:
      typeof contextUsage?.percent === "number" &&
      Number.isFinite(contextUsage.percent)
        ? contextUsage.percent
        : null,
  };
};

export const PRIMARY_MODEL_ROLES = [
  "default",
  "smol",
  "slow",
  "plan",
] as const;

const readString = (
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
};

const normalizeTodoPhases = (snapshot: unknown): TodoPhase[] => {
  const envelope = asRecord(snapshot);
  const value = (asRecord(envelope?.data) ?? envelope)?.todoPhases;
  if (!Array.isArray(value)) return [];

  const phases: TodoPhase[] = [];
  for (const [phaseIndex, candidate] of value.entries()) {
    const phase = asRecord(candidate);
    if (!phase || !Array.isArray(phase.tasks)) continue;

    const tasks: TodoPhase["tasks"] = [];
    for (const [taskIndex, taskCandidate] of phase.tasks.entries()) {
      const task = asRecord(taskCandidate);
      if (!task) continue;
      const content = readString(task, "content");
      if (!content) continue;
      tasks.push({
        id: readString(task, "id") ?? `task-${phaseIndex + 1}-${taskIndex + 1}`,
        content,
        status: readString(task, "status") ?? "pending",
      });
    }

    phases.push({
      id: readString(phase, "id") ?? `phase-${phaseIndex + 1}`,
      name: readString(phase, "name") ?? `Phase ${phaseIndex + 1}`,
      tasks,
    });
  }
  return phases;
};

const normalizeSubagents = (response: unknown): SubagentInfo[] => {
  const envelope = asRecord(response);
  const payload = envelope?.data ?? response;
  const value = asRecord(payload)?.subagents ?? payload;
  if (!Array.isArray(value)) return [];
  const subagents: SubagentInfo[] = [];
  for (const [index, candidate] of value.entries()) {
    const subagent = asRecord(candidate);
    if (!subagent) continue;
    const id =
      readString(subagent, "id", "agentId", "sessionId") ??
      `subagent-${index + 1}`;
    const progressValue = subagent.progress;
    const progress =
      typeof progressValue === "string" || typeof progressValue === "number"
        ? String(progressValue)
        : readString(subagent, "task", "currentTask");
    subagents.push({
      id,
      name: readString(subagent, "name", "label") ?? id,
      status: readString(subagent, "status", "state") ?? "unknown",
      ...(progress ? { progress } : {}),
    });
  }
  return subagents;
};

const formatDetail = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value, null, 2) ?? String(value);
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : formatDetail(error) || "Unknown error";

const isAlreadyClosedError = (error: unknown): boolean =>
  errorMessage(error).toLowerCase().includes("session not found");

const formatOpenSessionError = (error: unknown): string => {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("omp not found") ||
    lower.includes("no such file") ||
    lower.includes("enoent") ||
    (lower.includes("omp") && lower.includes("path"))
  ) {
    return `${message} Open Settings to set the omp binary path, or install omp and ensure it is on PATH.`;
  }
  return `Unable to open folder: ${message}`;
};

const withoutSession = <T>(
  values: Record<string, T>,
  sessionId: string,
): Record<string, T> => {
  const next = { ...values };
  delete next[sessionId];
  return next;
};

const firstDetail = (event: OmpEvent, ...keys: string[]): string => {
  for (const key of keys) {
    if (event[key] !== undefined) return formatDetail(event[key]);
  }
  return "";
};

const nextItemId = (items: { id: string }[], prefix: string): string => {
  let sequence = 1;
  const ids = new Set(items.map((item) => item.id));
  while (ids.has(`${prefix}-${sequence}`)) sequence += 1;
  return `${prefix}-${sequence}`;
};

const appendActivity = (
  current: ActivityItem[],
  text: string,
  event: OmpEvent,
): ActivityItem[] => [
  ...current,
  {
    id: nextItemId(current, "activity"),
    at: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
    text,
  },
];

const toolIdentity = (
  event: OmpEvent,
  current: TranscriptItem[],
): { id: string; name: string } => {
  const tool = asRecord(event.tool);
  return {
    id:
      readString(event, "toolCallId", "toolExecutionId", "toolUseId") ??
      (tool ? readString(tool, "id") : undefined) ??
      nextItemId(current, "tool"),
    name:
      readString(event, "toolName", "name") ??
      (tool ? readString(tool, "name") : undefined) ??
      "Tool",
  };
};


const projectKeyFromCwd = (cwd: string) => cwd.replaceAll("\\", "/");


const LOCALHOST_URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>]*)?/gi;

const DATA_IMAGE_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g;


const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const collectBrowserArtifactsFromUnknown = (
  value: unknown,
  sessionId: string,
  toolId: string,
  at: number,
  fallbackName?: string,
): BrowserArtifact[] => {
  const artifacts: BrowserArtifact[] = [];
  const visit = (node: unknown, depth = 0) => {
    if (node == null || depth > 6) return;
    if (typeof node === "string") {
      const matches = node.match(DATA_IMAGE_RE);
      if (matches) {
        for (const [index, imageUrl] of matches.entries()) {
          artifacts.push({
            id: `${toolId}-img-${index}-${at}`,
            sessionId,
            at,
            tabName: fallbackName,
            imageUrl: imageUrl.replace(/\s+/g, ""),
            note: "screenshot",
          });
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const url = asString(rec.url) ?? asString(rec.pageUrl);
    const tabName =
      asString(rec.name) ?? asString(rec.tab) ?? asString(rec.tabName) ?? fallbackName;
    const action = asString(rec.action);

    const shots = rec.screenshots;
    if (Array.isArray(shots)) {
      shots.forEach((shot, index) => {
        if (!shot || typeof shot !== "object") return;
        const s = shot as Record<string, unknown>;
        const imageUrl =
          asString(s.dataUrl) ??
          asString(s.data_url) ??
          (asString(s.base64) ? `data:image/png;base64,${asString(s.base64)}` : undefined) ??
          (asString(s.data) && String(s.data).startsWith("data:")
            ? asString(s.data)
            : asString(s.data)
              ? `data:image/png;base64,${asString(s.data)}`
              : undefined) ??
          asString(s.url) ??
          asString(s.path);
        if (!imageUrl) return;
        artifacts.push({
          id: `${toolId}-shot-${index}-${at}`,
          sessionId,
          at,
          tabName,
          url,
          action,
          imageUrl,
          note: asString(s.label) ?? "screenshot",
        });
      });
    }

    for (const key of ["screenshot", "image", "png", "imageBase64", "base64"]) {
      const v = rec[key];
      if (typeof v === "string" && v.length > 32) {
        const imageUrl = v.startsWith("data:")
          ? v
          : key.toLowerCase().includes("base64") || /^[A-Za-z0-9+/=]+$/.test(v.slice(0, 80))
            ? `data:image/png;base64,${v}`
            : v.startsWith("http") || v.startsWith("/")
              ? v
              : undefined;
        if (imageUrl) {
          artifacts.push({
            id: `${toolId}-${key}-${at}`,
            sessionId,
            at,
            tabName,
            url,
            action,
            imageUrl,
            note: key,
          });
        }
      }
    }

    if (action === "open" || url) {
      artifacts.push({
        id: `${toolId}-meta-${at}-${artifacts.length}`,
        sessionId,
        at,
        tabName,
        url,
        action,
        note: action ?? "browser",
      });
    }

    for (const nested of Object.values(rec)) visit(nested, depth + 1);
  };
  visit(value);
  const seen = new Set<string>();
  return artifacts.filter((item) => {
    const key = `${item.imageUrl ?? ""}|${item.url ?? ""}|${item.action ?? ""}|${item.note ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(item.imageUrl || item.url || item.action);
  });
};

const extractCompanionsFromText = (
  text: string,
  sessionId: string,
  source: string,
  at: number,
): CompanionTarget[] => {
  if (!text) return [];
  const matches = text.match(LOCALHOST_URL_RE) ?? [];
  const seen = new Set<string>();
  const out: CompanionTarget[] = [];
  for (const url of matches) {
    const clean = url.replace(/[),.;]+$/g, "");
    if (seen.has(clean)) continue;
    seen.add(clean);
    let title = "Local companion";
    try {
      const parsed = new URL(clean);
      title = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    } catch {
      // keep default
    }
    out.push({
      id: `${sessionId}-${clean}`,
      sessionId,
      url: clean,
      title,
      at,
      source,
    });
  }
  return out;
};

export const LAUNCH_RECIPES: LaunchRecipe[] = [
  {
    id: "brainstorm",
    group: "Workflows",
    label: "Start Superpowers brainstorm",
    detail: "Design brainstorm with visual companion when useful",
    keywords: "superpowers brainstorm design companion",
    openPanel: "companion",
    prompt: [
      "Read skill://brainstorming and follow it fully.",
      "Start a collaborative design brainstorm for: {{topic}}",
      "If visual comparison helps, offer/start the visual companion and keep mockups updated.",
      "Ask one clarifying question at a time. Do not implement code until I approve a design.",
    ].join("\n"),
  },
  {
    id: "impeccable-critique",
    group: "Workflows",
    label: "Impeccable critique",
    detail: "Run design critique on the current UI surface",
    keywords: "impeccable critique design review",
    openPanel: "launch",
    prompt: [
      "Read skill://impeccable and follow setup.",
      "Then read skill://impeccable/reference/critique.md and run a critique on: {{target}}",
      "Score issues and propose concrete fixes. Do not rewrite the whole UI unless asked.",
    ].join("\n"),
  },
  {
    id: "impeccable-polish",
    group: "Workflows",
    label: "Impeccable polish",
    detail: "Final craft pass on a page/component",
    keywords: "impeccable polish ui craft",
    openPanel: "launch",
    prompt: [
      "Read skill://impeccable and skill://impeccable/reference/polish.md.",
      "Polish: {{target}}",
      "Keep existing brand language; eliminate AI-slop patterns; verify contrast and spacing.",
    ].join("\n"),
  },
  {
    id: "browser-headless",
    group: "Browser",
    label: "Headless browser session",
    detail: "Open URL with OMP browser tool and snapshot",
    keywords: "browser headless playwright screenshot",
    openPanel: "browser",
    prompt: [
      "Use the browser tool (headless) for this task.",
      "1) browser open name=desktop url={{url}}",
      "2) run a snapshot/observe and take a screenshot",
      "3) summarize the page structure, key CTAs, and any obvious UX/a11y issues",
      "Keep the tab named desktop open for follow-ups.",
    ].join("\n"),
  },
  {
    id: "browser-headed",
    group: "Browser",
    label: "Visible browser session",
    detail: "Open a headed browser when possible and snapshot",
    keywords: "browser headed visible ui",
    openPanel: "browser",
    prompt: [
      "Use the browser tool. Prefer a visible/headed browser if settings allow; otherwise headless is fine.",
      "Open name=desktop url={{url}}, observe the page, screenshot, and report what you see.",
      "Leave the tab open for iterative interaction.",
    ].join("\n"),
  },
  {
    id: "browser-qa",
    group: "Browser",
    label: "Browser QA pass",
    detail: "Click through critical path and report bugs",
    keywords: "qa test crawl regression",
    openPanel: "browser",
    prompt: [
      "Use the browser tool against {{url}} (tab name=desktop).",
      "Perform a focused QA pass of the main user path described as: {{topic}}",
      "Capture screenshots at key steps. Return bugs with severity, repro, and suggested fix.",
    ].join("\n"),
  },
];

const applyTemplate = (template: string, vars: Record<string, string> = {}) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `[${key}]`);

export const useSessionStore = create<SessionStore>()((set, get) => ({
  settings: null,
  modelRoles: [],
  modelRolesConfigPath: null,
  availableModels: [],
  availableModelsLoaded: false,
  sessions: [],
  activeSessionId: null,
  transcripts: {},
  activity: {},
  todos: {},
  subagents: {},
  states: {},
  error: null,
  streaming: {},
  browserArtifacts: {},
  companions: {},
  activeCompanionId: null,
  skills: [],
  skillsLoaded: false,
  roleMemoryCache: {},

  bootstrap: async () => {
    void get().loadModelRoles();
    void get().loadAvailableModels();
    try {
      const [settings, sessions] = await Promise.all([
        api.getSettings(),
        api.listSessions(),
      ]);
      set((state) => ({
        settings,
        sessions,
        activeSessionId:
          state.activeSessionId &&
          sessions.some((session) => session.id === state.activeSessionId)
            ? state.activeSessionId
            : (sessions[0]?.id ?? null),
      }));
    } catch (error) {
      console.error("Unable to bootstrap OMP Desktop", error);
    }
  },

  loadSettings: async () => {
    try {
      const settings = await api.getSettings();
      set({ settings, error: null });
    } catch (error) {
      set({ error: `Unable to load settings: ${errorMessage(error)}` });
    }
  },

  loadModelRoles: async () => {
    try {
      const snapshot = await api.getModelRoles();
      set({
        modelRoles: snapshot.roles ?? [],
        modelRolesConfigPath: snapshot.configPath ?? null,
      });
    } catch (error) {
      // Roles are supplemental chrome; don't block the app.
      console.warn("Unable to load model roles", error);
      set({ modelRoles: [], modelRolesConfigPath: null });
    }
  },

  loadAvailableModels: async () => {
    try {
      const models = await api.listAvailableModels();
      set({ availableModels: models, availableModelsLoaded: true });
    } catch (error) {
      console.warn("Unable to load available models", error);
      set({ availableModels: [], availableModelsLoaded: true });
    }
  },

  setModelRole: async (role, selector) => {
    try {
      const snapshot = await api.setModelRole(role, selector);
      set({
        modelRoles: snapshot.roles ?? [],
        modelRolesConfigPath: snapshot.configPath ?? null,
        error: null,
      });
      return true;
    } catch (error) {
      set({ error: `Unable to set ${role} model: ${errorMessage(error)}` });
      return false;
    }
  },

  saveSettings: async (settings) => {
    try {
      await api.saveSettings(settings);
      set({ settings, error: null });
      return true;
    } catch (error) {
      set({ error: `Unable to save settings: ${errorMessage(error)}` });
      return false;
    }
  },

  setActive: (sessionId) => set({ activeSessionId: sessionId }),

  openFolder: async (cwd, resume) => {
    try {
      const selectedCwd = cwd ?? (await openDirectoryDialog());
      if (!selectedCwd) return;

      const session = await api.createSession(selectedCwd, resume);
      set((state) => ({
        sessions: [
          ...state.sessions.filter((candidate) => candidate.id !== session.id),
          session,
        ],
        activeSessionId: session.id,
        transcripts: { ...state.transcripts, [session.id]: [] },
        activity: { ...state.activity, [session.id]: [] },
        todos: { ...state.todos, [session.id]: [] },
        subagents: { ...state.subagents, [session.id]: [] },
        states: { ...state.states, [session.id]: {} },
        streaming: { ...state.streaming, [session.id]: false },
        browserArtifacts: { ...state.browserArtifacts, [session.id]: [] },
        companions: { ...state.companions, [session.id]: [] },
        error: null,
      }));
      void get().ensureRoleMemoryPreamble("default", session.cwd, session.id);
    } catch (error) {
      set({ error: formatOpenSessionError(error) });
    }
  },

  openSshSession: async (remote) => {
    try {
      const session = await api.createSshSession(remote);
      const label = session.remote?.label ?? remote.hostName;
      const remoteCwd = session.remote?.remoteCwd ?? remote.remoteCwd;
      const hello = [
        `Connected to remote **${label}**.`,
        "",
        `Remote project root: \`${remoteCwd}\``,
        "",
        "Hard rules for this session:",
        `1. Treat \`${remoteCwd}\` as the only project root.`,
        `2. Use OMP host \`${remote.hostName}\` and \`ssh://${remote.hostName}/...\` paths for file tools.`,
        "3. Do not edit the local desktop stub workspace as if it were the project.",
        "4. The integrated terminal is attached to the remote host.",
      ].join("\n");
      set((state) => ({
        sessions: [
          ...state.sessions.filter((candidate) => candidate.id !== session.id),
          session,
        ],
        activeSessionId: session.id,
        transcripts: {
          ...state.transcripts,
          [session.id]: [
            {
              id: `sys-remote-${session.id}`,
              kind: "system",
              text: hello,
            },
          ],
        },
        activity: {
          ...state.activity,
          [session.id]: [
            {
              id: `act-remote-${session.id}`,
              at: Date.now(),
              text: `SSH session ready · ${label}`,
            },
          ],
        },
        todos: { ...state.todos, [session.id]: [] },
        subagents: { ...state.subagents, [session.id]: [] },
        states: { ...state.states, [session.id]: {} },
        streaming: { ...state.streaming, [session.id]: false },
        browserArtifacts: { ...state.browserArtifacts, [session.id]: [] },
        companions: { ...state.companions, [session.id]: [] },
        error: null,
      }));
      void get().ensureRoleMemoryPreamble("default", session.cwd, session.id);
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : `Unable to open SSH session: ${String(error)}`,
      });
    }
  },

  restartSession: async (sessionId) => {
    const session = get().sessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      set({ error: "Unable to restart: session not found." });
      return;
    }

    const cwd = session.cwd;
    const remote = session.remote
      ? {
          hostName: session.remote.hostName,
          host: session.remote.host,
          user: session.remote.user ?? null,
          port: session.remote.port ?? null,
          keyPath: null,
          remoteCwd: session.remote.remoteCwd,
        }
      : null;
    try {
      await get().closeSession(sessionId);
    } catch {
      // closeSession already surfaces non-fatal errors; continue restart.
    }
    if (remote) {
      await get().openSshSession(remote);
      return;
    }
    await get().openFolder(cwd);
  },

  clearError: () => set({ error: null }),

  closeSession: async (sessionId) => {
    const current = get();
    const closingIndex = current.sessions.findIndex(
      (session) => session.id === sessionId,
    );
    if (closingIndex === -1) return;

    set((state) => {
      const sessions = state.sessions.filter(
        (session) => session.id !== sessionId,
      );
      const activeSessionId =
        state.activeSessionId === sessionId
          ? (sessions[closingIndex]?.id ??
            sessions[closingIndex - 1]?.id ??
            null)
          : state.activeSessionId;

      return {
        sessions,
        activeSessionId,
        transcripts: withoutSession(state.transcripts, sessionId),
        activity: withoutSession(state.activity, sessionId),
        todos: withoutSession(state.todos, sessionId),
        subagents: withoutSession(state.subagents, sessionId),
        states: withoutSession(state.states, sessionId),
        streaming: withoutSession(state.streaming, sessionId),
        browserArtifacts: withoutSession(state.browserArtifacts, sessionId),
        companions: withoutSession(state.companions, sessionId),
        error: null,
      };
    });

    try {
      await api.closeSession(sessionId);
    } catch (error) {
      if (!isAlreadyClosedError(error)) {
        set({ error: `Unable to close session: ${errorMessage(error)}` });
      }
    }
  },

  refreshState: async (sessionId) => {
    try {
      const snapshot = await api.getState(sessionId);
      if (!get().sessions.some((session) => session.id === sessionId)) return;
      set((state) => ({
        states: { ...state.states, [sessionId]: snapshot },
        todos: {
          ...state.todos,
          [sessionId]: normalizeTodoPhases(snapshot),
        },
      }));
    } catch (error) {
      if (get().sessions.some((session) => session.id === sessionId)) {
        set({ error: `Unable to refresh session: ${errorMessage(error)}` });
      }
    }
  },

  loadSubagents: async (sessionId) => {
    try {
      await api.rpcCommand(sessionId, "set_subagent_subscription", {
        level: "progress",
      });
      const response = await api.rpcCommand(sessionId, "get_subagents");
      if (!get().sessions.some((session) => session.id === sessionId)) return;
      set((state) => ({
        subagents: {
          ...state.subagents,
          [sessionId]: normalizeSubagents(response),
        },
      }));
    } catch (error) {
      if (get().sessions.some((session) => session.id === sessionId)) {
        set({ error: `Unable to load subagents: ${errorMessage(error)}` });
      }
    }
  },

  send: async (message, streamingBehavior) => {
    const sessionId = get().activeSessionId;
    const text = message.trim();
    if (!sessionId || !text) return false;

    set((state) => {
      const current = state.transcripts[sessionId] ?? [];
      return {
        transcripts: {
          ...state.transcripts,
          [sessionId]: [
            ...current,
            { id: nextItemId(current, "user"), kind: "user", text },
          ],
        },
      };
    });

    try {
      const session = get().sessions.find((item) => item.id === sessionId);
      let preamble = "";
      if (session) {
        const cacheKey = `default::${projectKeyFromCwd(session.cwd)}`;
        const cached = get().roleMemoryCache[cacheKey];
        if (cached && Date.now() - cached.loadedAt < 30_000) {
          preamble = cached.preamble;
        } else {
          // Don't stall first token on memory IPC; warm cache in background.
          void get().ensureRoleMemoryPreamble("default", session.cwd, sessionId);
        }
      }
      await api.prompt(sessionId, `${preamble}${text}`, streamingBehavior);
      return true;
    } catch (error) {
      set((state) => {
        const current = state.transcripts[sessionId] ?? [];
        return {
          transcripts: {
            ...state.transcripts,
            [sessionId]: [
              ...current,
              {
                id: nextItemId(current, "system"),
                kind: "system",
                text: `Unable to send message: ${errorMessage(error)}`,
              },
            ],
          },
        };
      });
      return false;
    }
  },

  abort: async () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;

    try {
      await api.abort(sessionId);
    } catch (error) {
      set((state) => {
        const current = state.transcripts[sessionId] ?? [];
        return {
          transcripts: {
            ...state.transcripts,
            [sessionId]: [
              ...current,
              {
                id: nextItemId(current, "system"),
                kind: "system",
                text: `Unable to abort: ${errorMessage(error)}`,
              },
            ],
          },
        };
      });
    }
  },

  applyOmpEvent: (sessionId, event) => {
    if (!get().sessions.some((session) => session.id === sessionId)) return;
    if (!isRecord(event)) return;
    const type = readString(event, "type");

    if (type === "agent_start" || type === "agent_end") {
      set((state) => ({
        streaming: {
          ...state.streaming,
          [sessionId]: type === "agent_start",
        },
      }));
      if (type === "agent_end") {
        // Never block the UI/stream path: refresh + memory/job board work runs after the turn.
        void get().refreshState(sessionId);
        const session = get().sessions.find((item) => item.id === sessionId);
        if (session) {
          const projectKey = projectKeyFromCwd(session.cwd);
          const projectLabel =
            session.cwd.split(/[\\/]/).filter(Boolean).at(-1) || session.title;
          const transcript = get().transcripts[sessionId] ?? [];
          const lastUser = [...transcript]
            .reverse()
            .find((item) => item.kind === "user");
          const lastAssistant = [...transcript]
            .reverse()
            .find((item) => item.kind === "assistant");
          const summary = [
            lastUser ? `User: ${lastUser.text.slice(0, 240)}` : "",
            lastAssistant && lastAssistant.kind === "assistant"
              ? `Assistant: ${lastAssistant.text.slice(0, 240)}`
              : "",
          ]
            .filter(Boolean)
            .join(" | ");
          void api
            .postTurnHousekeeping({
              sessionId,
              projectKey,
              projectLabel,
              role: "default",
              summary: summary || "Turn complete",
            })
            .catch(() => undefined);
          // Warm role-memory cache while the user reads the reply.
          void get().ensureRoleMemoryPreamble("default", session.cwd, sessionId);
        }
      }
      return;
    }

    if (type === "message_end") {
      const message = asRecord(event.message);
      if (message?.role !== "assistant") return;
      const responseId = readString(message, "responseId");
      const content = message.content;
      let text = "";
      let thinking = "";
      if (Array.isArray(content)) {
        for (const block of content) {
          const entry = asRecord(block);
          if (!entry) continue;
          if (entry.type === "text" && typeof entry.text === "string") {
            text += entry.text;
          }
          if (entry.type === "thinking" && typeof entry.thinking === "string") {
            thinking += entry.thinking;
          }
        }
      }
      set((state) => {
        const current = state.transcripts[sessionId] ?? [];
        const last = current.at(-1);
        if (last?.kind === "assistant") {
          return {
            transcripts: {
              ...state.transcripts,
              [sessionId]: [
                ...current.slice(0, -1),
                {
                  ...last,
                  id: responseId ?? last.id,
                  responseId: responseId ?? last.responseId,
                  text: text || last.text,
                  thinking: thinking || last.thinking,
                },
              ],
            },
          };
        }
        return {
          transcripts: {
            ...state.transcripts,
            [sessionId]: [
              ...current,
              {
                id: responseId ?? nextItemId(current, "assistant"),
                kind: "assistant",
                text,
                thinking: thinking || undefined,
                responseId: responseId,
              },
            ],
          },
        };
      });
      return;
    }

    if (type === "message_update") {
      const assistantEvent = asRecord(event.assistantMessageEvent);
      const message = asRecord(event.message);
      const delta = assistantEvent
        ? readString(assistantEvent, "delta", "text", "thinking")
        : readString(event, "delta", "text", "thinking");
      const eventType = assistantEvent
        ? readString(assistantEvent, "type")
        : readString(event, "messageType", "type");
      const isText = eventType === "text_delta" || eventType === "text";
      const isThinking =
        eventType === "thinking_delta" ||
        eventType === "thinking" ||
        eventType === "reasoning_delta";
      if ((!isText && !isThinking) || delta === undefined) return;
      const responseId = message ? readString(message, "responseId") : undefined;

      set((state) => {
        const current = state.transcripts[sessionId] ?? [];
        const messageId =
          responseId ??
          (assistantEvent
            ? readString(assistantEvent, "messageId")
            : undefined) ??
          readString(event, "messageId");
        const last = current.at(-1);
        const canMerge =
          last?.kind === "assistant" &&
          (messageId === undefined ||
            messageId === last.id ||
            messageId === last.responseId);

        if (canMerge && last?.kind === "assistant") {
          const nextItem = isThinking
            ? {
                ...last,
                thinking: `${last.thinking ?? ""}${delta}`,
                responseId: responseId ?? last.responseId,
                id: responseId ?? last.id,
              }
            : {
                ...last,
                text: `${last.text}${delta}`,
                responseId: responseId ?? last.responseId,
                id: responseId ?? last.id,
              };
          return {
            transcripts: {
              ...state.transcripts,
              [sessionId]: [...current.slice(0, -1), nextItem],
            },
          };
        }

        return {
          transcripts: {
            ...state.transcripts,
            [sessionId]: [
              ...current,
              {
                id: messageId ?? nextItemId(current, "assistant"),
                kind: "assistant",
                text: isText ? delta : "",
                thinking: isThinking ? delta : undefined,
                responseId,
              },
            ],
          },
        };
      });
      return;
    }

    if (
      type !== "tool_execution_start" &&
      type !== "tool_execution_update" &&
      type !== "tool_execution_end"
    ) {
      return;
    }

    set((state) => {
      const transcript = state.transcripts[sessionId] ?? [];
      const activity = state.activity[sessionId] ?? [];
      const tool = toolIdentity(event, transcript);
      const existingIndex = transcript.findIndex(
        (item) => item.kind === "tool" && item.id === tool.id,
      );
      const existing = transcript[existingIndex];
      const toolName =
        tool.name === "Tool" && existing?.kind === "tool"
          ? existing.name
          : tool.name;
      const isEnd = type === "tool_execution_end";
      const isError =
        event.isError === true ||
        event.status === "error" ||
        event.error !== undefined;
      const detail = isEnd
        ? firstDetail(event, "result", "output", "error", "detail")
        : firstDetail(event, "detail", "update", "args", "input", "parameters");
      const item: TranscriptItem = {
        id: tool.id,
        kind: "tool",
        name: toolName,
        detail,
        status: isEnd ? (isError ? "error" : "done") : "running",
      };
      const nextTranscript = [...transcript];

      if (existingIndex === -1) {
        nextTranscript.push(item);
      } else if (existing?.kind === "tool") {
        nextTranscript[existingIndex] = {
          ...item,
          detail: detail || existing.detail,
        };
      } else {
        nextTranscript[existingIndex] = item;
      }

      let nextActivity = activity;
      if (type === "tool_execution_start") {
        nextActivity = appendActivity(activity, `${toolName} started`, event);
      } else if (type === "tool_execution_end") {
        nextActivity = appendActivity(
          activity,
          `${toolName} ${isError ? "failed" : "completed"}`,
          event,
        );
      }

      const at = Date.now();
      let browserArtifacts = state.browserArtifacts[sessionId] ?? [];
      let companions = state.companions[sessionId] ?? [];
      let activeCompanionId = state.activeCompanionId;

      if (isEnd) {
        const blob = [
          detail,
          formatDetail(event.result),
          formatDetail(event.details),
          formatDetail(event.output),
          formatDetail(event),
        ].join("\n");


        if (toolName.toLowerCase().includes("browser") || blob.includes("screenshot") || blob.includes("data:image")) {
          const extracted = collectBrowserArtifactsFromUnknown(
            {
              details: event.details,
              result: event.result,
              output: event.output,
              detail: event.detail,
              raw: blob,
            },
            sessionId,
            tool.id,
            at,
            toolName,
          );
          if (extracted.length) {
            browserArtifacts = [...extracted, ...browserArtifacts].slice(0, 40);
          }
        }

        const foundCompanions = extractCompanionsFromText(blob, sessionId, toolName, at);
        if (foundCompanions.length) {
          const existing = new Set(companions.map((item) => item.url));
          const merged = [
            ...foundCompanions.filter((item) => !existing.has(item.url)),
            ...companions,
          ].slice(0, 20);
          companions = merged;
          activeCompanionId = foundCompanions[0]?.id ?? activeCompanionId;
          window.dispatchEvent(
            new CustomEvent("omp-desktop:open-panel", { detail: "companion" }),
          );
        }
      }

      return {
        transcripts: { ...state.transcripts, [sessionId]: nextTranscript },
        activity: { ...state.activity, [sessionId]: nextActivity },
        browserArtifacts: { ...state.browserArtifacts, [sessionId]: browserArtifacts },
        companions: { ...state.companions, [sessionId]: companions },
        activeCompanionId,
      };
    });
  },



  loadSkills: async () => {
    try {
      const skills = await api.listSkills();
      set({ skills, skillsLoaded: true });
    } catch (error) {
      console.warn("Unable to list skills", error);
      set({ skills: [], skillsLoaded: true });
    }
  },

  setActiveCompanion: (id) => set({ activeCompanionId: id }),

  clearBrowserArtifacts: (sessionId) => {
    if (!sessionId) {
      set({ browserArtifacts: {} });
      return;
    }
    set((state) => {
      const next = { ...state.browserArtifacts };
      delete next[sessionId];
      return { browserArtifacts: next };
    });
  },

  launchRecipe: async (recipe, vars = {}) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) {
      set({ error: "Open a session before launching a workflow." });
      return false;
    }
    const prompt = applyTemplate(recipe.prompt, {
      topic: vars.topic ?? vars.target ?? "the current project",
      target: vars.target ?? vars.topic ?? "the current UI",
      url: vars.url ?? "http://localhost:5173",
      ...vars,
    });
    const ok = await get().send(prompt);
    if (ok && recipe.openPanel) {
      window.dispatchEvent(
        new CustomEvent("omp-desktop:open-panel", { detail: recipe.openPanel }),
      );
    }
    return ok;
  },

  launchSkill: async (skillName, args = "") => {
    const sessionId = get().activeSessionId;
    if (!sessionId) {
      set({ error: "Open a session before launching a skill." });
      return false;
    }
    const prompt = [
      `Read skill://${skillName} and follow it.`,
      args.trim() ? `User request: ${args.trim()}` : "Proceed with the default flow for this skill.",
    ].join("\n");
    const ok = await get().send(prompt);
    if (ok) {
      window.dispatchEvent(
        new CustomEvent("omp-desktop:open-panel", { detail: "launch" }),
      );
    }
    return ok;
  },

  launchBrowser: async (url, headed = false) => {
    const recipe = LAUNCH_RECIPES.find((item) =>
      headed ? item.id === "browser-headed" : item.id === "browser-headless",
    );
    if (!recipe) return false;
    return get().launchRecipe(recipe, { url });
  },

  ensureRoleMemoryPreamble: async (role, cwd, sessionId) => {
    const projectKey = projectKeyFromCwd(cwd);
    const cacheKey = `${role}::${projectKey}`;
    const cached = get().roleMemoryCache[cacheKey];
    if (cached && Date.now() - cached.loadedAt < 30_000) {
      return cached.preamble;
    }
    try {
      const [notes, pad] = await Promise.all([
        api.listRoleNotes(role, projectKey),
        api.getRoleScratchpad(role, projectKey),
      ]);
      const noteLines = notes
        .slice(0, 6)
        .map((note) => `- (${note.kind}) ${note.title}: ${note.body}`)
        .join("\n");
      let preamble = "";
      if (pad.content.trim() || noteLines) {
        const parts = [
          `<desktop-role-memory role="${role}" project="${projectKey}">`,
          "Persistent role memory/scratchpad from OMP Desktop. Prefer current user instructions and repo state when they conflict.",
        ];
        if (pad.content.trim()) {
          parts.push("Scratchpad:", pad.content.trim().slice(0, 2000));
        }
        if (noteLines) {
          parts.push("Memory notes:", noteLines);
        }
        parts.push(`Session: ${sessionId}`, "</desktop-role-memory>");
        preamble = `${parts.join("\n")}\n\n`;
      }
      set((state) => ({
        roleMemoryCache: {
          ...state.roleMemoryCache,
          [cacheKey]: { preamble, loadedAt: Date.now() },
        },
      }));
      return preamble;
    } catch {
      return cached?.preamble ?? "";
    }
  },

  updateAssistantText: async (sessionId, itemId, text) => {
    const current = get().transcripts[sessionId] ?? [];
    const target = current.find(
      (item) => item.kind === "assistant" && item.id === itemId,
    );
    if (!target || target.kind !== "assistant") {
      set({ error: "Assistant message not found in transcript." });
      return false;
    }

    // Optimistic local update
    set((state) => ({
      transcripts: {
        ...state.transcripts,
        [sessionId]: (state.transcripts[sessionId] ?? []).map((item) =>
          item.kind === "assistant" && item.id === itemId
            ? { ...item, text }
            : item,
        ),
      },
      error: null,
    }));

    try {
      await api.rewriteAssistantMessage(
        sessionId,
        text,
        target.responseId ?? null,
      );
      return true;
    } catch (error) {
      // Roll back local text on failure
      set((state) => ({
        transcripts: {
          ...state.transcripts,
          [sessionId]: (state.transcripts[sessionId] ?? []).map((item) =>
            item.kind === "assistant" && item.id === itemId
              ? { ...item, text: target.text }
              : item,
          ),
        },
        error: `Unable to rewrite session history: ${errorMessage(error)}`,
      }));
      return false;
    }
  },

  markExited: (sessionId) => {
    if (!get().sessions.some((session) => session.id === sessionId)) return;
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, status: "exited" } : session,
      ),
      streaming: { ...state.streaming, [sessionId]: false },
      error:
        state.activeSessionId === sessionId
          ? "Session process exited. Restart to continue in this folder."
          : state.error,
    }));
  },
}));
