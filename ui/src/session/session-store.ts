import { create } from "zustand";
import {
  api,
  isTauriRuntime,
  openDirectoryDialog,
  openExternalUrl,
} from "../lib/tauri.ts";
import type {
  ActivityItem,
  AppSettings,
  AvailableModel,
  ModelRoleAssignment,
  ModelRoleScope,
  RemoteTarget,
  SkillInfo,
  LaunchRecipe,
  ExtensionUiRequest,
  ExtensionUiResponse,
  CompanionTarget,
  BrowserArtifact,
  SessionInfo,
  SubagentInfo,
  TodoPhase,
  TranscriptItem,
  ReviewFile,
} from "./types.ts";
import {
  buildAttentionInbox,
  type AttentionItem,
} from "./attention.ts";
import { parseToolPayload } from "./tool-render.ts";
import {
  reviewFileFromTool,
  upsertReviewFile,
} from "./review.ts";
import {
  EMPTY_TURN_STATS,
  mergeTurnStats,
  parseSessionStats,
  type SessionTurnStats,
} from "./session-stats.ts";
import {
  HOST_SLASH_COMMANDS,
  mergeSlashCommands,
  normalizeCommandsPayload,
  type SlashCommand,
} from "./slash.ts";

export type { SessionTurnStats } from "./session-stats.ts";
export {
  EMPTY_TURN_STATS,
  parseSessionStats,
  formatTokenChip,
  formatTpsChip,
  formatCostChip,
  formatTurnStatsTitle,
} from "./session-stats.ts";

type OmpEvent = Record<string, unknown>;

export interface SessionStore {
  settings: AppSettings | null;
  modelRoles: ModelRoleAssignment[];
  modelRolesConfigPath: string | null;
  modelRoleScope: ModelRoleScope;
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
  reviewFiles: Record<string, ReviewFile[]>;
  states: Record<string, unknown>;
  turnStats: Record<string, SessionTurnStats>;
  commandsBySession: Record<string, SlashCommand[]>;
  turnTiming: Record<string, number>;
  error: string | null;
  streaming: Record<string, boolean>;
  extensionUiRequests: Record<string, ExtensionUiRequest[]>;
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
  refreshSessionStats: (sessionId: string) => Promise<void>;
  loadSubagents: (sessionId: string) => Promise<void>;
  loadAvailableCommands: (sessionId: string) => Promise<void>;
  loadSubagentMessages: (
    sessionId: string,
    input: { subagentId?: string; sessionFile?: string; fromByte?: number },
  ) => Promise<unknown>;
  send: (
    message: string,
    streamingBehavior?: string,
    images?: Array<string | { dataBase64: string; mimeType?: string | null }>,
  ) => Promise<boolean>;
  abort: () => Promise<void>;
  applyOmpEvent: (sessionId: string, event: unknown) => void;
  respondExtensionUi: (
    sessionId: string,
    requestId: string,
    response: ExtensionUiResponse,
  ) => Promise<boolean>;
  updateAssistantText: (sessionId: string, itemId: string, text: string) => Promise<boolean>;
  markExited: (sessionId: string) => void;
  clearError: () => void;
  roleMemoryCache: Record<string, { preamble: string; loadedAt: number }>;
  ensureRoleMemoryPreamble: (role: string, sessionId: string) => Promise<string>;
}

const EMPTY_TRANSCRIPT: TranscriptItem[] = [];
const EMPTY_ACTIVITY: ActivityItem[] = [];
const EMPTY_TODOS: TodoPhase[] = [];
const EMPTY_SUBAGENTS: SubagentInfo[] = [];
const EMPTY_REVIEW_FILES: ReviewFile[] = [];

const modelRoleCwd = (state: {
  sessions: SessionInfo[];
  activeSessionId: string | null;
}): string | undefined => {
  const session = state.sessions.find(
    (candidate) => candidate.id === state.activeSessionId,
  );
  return session && !session.remote ? session.cwd : undefined;
};

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

export const selectActiveReviewFiles = (state: SessionStore): ReviewFile[] =>
  state.activeSessionId
    ? (state.reviewFiles[state.activeSessionId] ?? EMPTY_REVIEW_FILES)
    : EMPTY_REVIEW_FILES;

export const selectActiveSession = (
  state: SessionStore,
): SessionInfo | undefined =>
  state.sessions.find((session) => session.id === state.activeSessionId);

export const selectActiveRuntimeSnapshot = (
  state: SessionStore,
): unknown =>
  state.activeSessionId ? state.states[state.activeSessionId] : undefined;

export const selectActiveTurnStats = (
  state: SessionStore,
): SessionTurnStats =>
  state.activeSessionId
    ? (state.turnStats[state.activeSessionId] ?? EMPTY_TURN_STATS)
    : EMPTY_TURN_STATS;

export const selectIsActiveStreaming = (state: SessionStore): boolean =>
  state.activeSessionId
    ? state.streaming[state.activeSessionId] === true
    : false;

export const selectAttentionInbox = (state: SessionStore): AttentionItem[] =>
  buildAttentionInbox({
    sessions: state.sessions,
    extensionUiRequests: state.extensionUiRequests,
  });

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

const EXTENSION_UI_METHODS: ExtensionUiRequest["method"][] = [
  "select",
  "confirm",
  "input",
  "editor",
  "cancel",
  "notify",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
  "open_url",
];

const parseExtensionUiRequest = (
  event: Record<string, unknown>,
): ExtensionUiRequest | null => {
  const id = readString(event, "id");
  const method = readString(event, "method");
  if (
    !id ||
    !method ||
    !EXTENSION_UI_METHODS.some((candidate) => candidate === method)
  ) {
    return null;
  }
  const options = Array.isArray(event.options)
    ? event.options.filter((option): option is string => typeof option === "string")
    : undefined;
  return {
    id,
    method: method as ExtensionUiRequest["method"],
    title: readString(event, "title"),
    message: readString(event, "message"),
    placeholder: readString(event, "placeholder"),
    prefill: readString(event, "prefill"),
    options,
    timeout:
      typeof event.timeout === "number" && Number.isFinite(event.timeout)
        ? event.timeout
        : undefined,
    targetId: readString(event, "targetId"),
    url: readString(event, "url"),
    launchUrl: readString(event, "launchUrl"),
    instructions: readString(event, "instructions"),
    notifyType: readString(event, "notifyType") as
      | ExtensionUiRequest["notifyType"]
      | undefined,
    statusKey: readString(event, "statusKey"),
    statusText: readString(event, "statusText"),
    text: readString(event, "text"),
  };
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

const readNumber = (
  value: Record<string, unknown>,
  ...keys: string[]
): number | undefined => {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};

const normalizeSubagent = (
  candidate: unknown,
  index: number,
): SubagentInfo | null => {
  const subagent = asRecord(candidate);
  if (!subagent) return null;
  const progressValue = subagent.progress;
  const progressRecord = asRecord(progressValue);
  const id =
    readString(subagent, "id", "agentId", "sessionId") ??
    (progressRecord ? readString(progressRecord, "id") : undefined) ??
    `subagent-${index + 1}`;
  let recentOutput: string | undefined;
  if (Array.isArray(progressRecord?.recentOutput)) {
    for (let outputIndex = progressRecord.recentOutput.length - 1; outputIndex >= 0; outputIndex -= 1) {
      const output = progressRecord.recentOutput[outputIndex];
      if (typeof output === "string" && output.trim()) {
        recentOutput = output;
        break;
      }
    }
  }
  const lastIntent =
    (progressRecord
      ? readString(progressRecord, "lastIntent")
      : undefined) ?? readString(subagent, "lastIntent");
  const currentTool =
    (progressRecord
      ? readString(progressRecord, "currentTool")
      : undefined) ??
    readString(subagent, "currentTool") ??
    null;
  const progress =
    typeof progressValue === "string" || typeof progressValue === "number"
      ? String(progressValue)
      : lastIntent ??
        (currentTool ?? undefined) ??
        recentOutput ??
        readString(subagent, "task", "currentTask", "description");
  const rawStatus =
    readString(subagent, "status", "state") ??
    (progressRecord ? readString(progressRecord, "status") : undefined) ??
    "unknown";
  const agent = readString(subagent, "agent", "agentName");
  const agentSource = readString(subagent, "agentSource", "source");
  const parentId =
    readString(subagent, "parentId", "parent", "parentAgentId") ?? null;
  const sessionFile =
    readString(subagent, "sessionFile", "session_path", "sessionPath") ?? null;
  const toolCount =
    (progressRecord
      ? readNumber(progressRecord, "toolCount")
      : undefined) ?? readNumber(subagent, "toolCount");
  const tokens =
    (progressRecord ? readNumber(progressRecord, "tokens") : undefined) ??
    readNumber(subagent, "tokens");
  return {
    id,
    name: readString(subagent, "name", "label", "agent") ?? id,
    ...(agent ? { agent } : {}),
    ...(agentSource ? { agentSource } : {}),
    status: rawStatus === "started" ? "running" : rawStatus,
    ...(progress ? { progress } : {}),
    parentId,
    sessionFile,
    ...(toolCount !== undefined ? { toolCount } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
    currentTool,
    ...(lastIntent ? { lastIntent } : {}),
  };
};

const mergeSubagentInfo = (
  existing: SubagentInfo,
  next: SubagentInfo,
): SubagentInfo => {
  const merged: SubagentInfo = {
    ...existing,
    id: next.id,
    name: next.name,
    status: next.status,
  };
  if (next.progress !== undefined) merged.progress = next.progress;
  else if (existing.progress !== undefined) merged.progress = existing.progress;

  if (next.agent !== undefined) merged.agent = next.agent;
  else if (existing.agent !== undefined) merged.agent = existing.agent;

  if (next.agentSource !== undefined) merged.agentSource = next.agentSource;
  else if (existing.agentSource !== undefined) {
    merged.agentSource = existing.agentSource;
  }

  if (next.parentId !== undefined && next.parentId !== null) {
    merged.parentId = next.parentId;
  } else if (existing.parentId !== undefined) {
    merged.parentId = existing.parentId;
  } else {
    merged.parentId = next.parentId ?? null;
  }

  if (next.sessionFile !== undefined && next.sessionFile !== null) {
    merged.sessionFile = next.sessionFile;
  } else if (existing.sessionFile !== undefined) {
    merged.sessionFile = existing.sessionFile;
  } else {
    merged.sessionFile = next.sessionFile ?? null;
  }

  if (next.toolCount !== undefined) merged.toolCount = next.toolCount;
  else if (existing.toolCount !== undefined) merged.toolCount = existing.toolCount;

  if (next.tokens !== undefined) merged.tokens = next.tokens;
  else if (existing.tokens !== undefined) merged.tokens = existing.tokens;

  if (next.currentTool !== undefined && next.currentTool !== null) {
    merged.currentTool = next.currentTool;
  } else if (existing.currentTool !== undefined) {
    merged.currentTool = existing.currentTool;
  } else {
    merged.currentTool = next.currentTool ?? null;
  }

  if (next.lastIntent !== undefined) merged.lastIntent = next.lastIntent;
  else if (existing.lastIntent !== undefined) {
    merged.lastIntent = existing.lastIntent;
  }

  return merged;
};

const normalizeSubagents = (response: unknown): SubagentInfo[] => {
  const envelope = asRecord(response);
  const payload = envelope?.data ?? response;
  const value = asRecord(payload)?.subagents ?? payload;
  if (!Array.isArray(value)) return [];
  const subagents: SubagentInfo[] = [];
  for (const [index, candidate] of value.entries()) {
    const subagent = normalizeSubagent(candidate, index);
    if (subagent) subagents.push(subagent);
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

const mergeSessionRuntimeState = (
  states: Record<string, unknown>,
  sessionId: string,
  patch: OmpEvent,
): Record<string, unknown> => ({
  ...states,
  [sessionId]: {
    ...(asRecord(states[sessionId]) ?? {}),
    ...patch,
  },
});

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


const normalizeProjectPath = (path: string): string => path.replaceAll("\\", "/");

export const projectKeyForSession = (session: SessionInfo): string => {
  if (!session.remote) return normalizeProjectPath(session.cwd);
  const remoteRoot = session.remote.remoteCwd.trim() || "~";
  const suffix = remoteRoot.startsWith("/") ? remoteRoot : `/${remoteRoot}`;
  return `ssh://${session.remote.hostName}${suffix}`;
};

export const projectLabelForSession = (session: SessionInfo): string => {
  if (!session.remote) {
    return normalizeProjectPath(session.cwd).split("/").filter(Boolean).at(-1) || session.title;
  }
  const remoteRoot = session.remote.remoteCwd.replace(/\/+$/g, "");
  const folder = remoteRoot.split("/").filter(Boolean).at(-1) || "~";
  return `${session.remote.hostName}:${folder}`;
};


const LOCALHOST_URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>]*)?/gi;

const LOCAL_COMPANION_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
]);

export const normalizeLocalCompanionUrl = (raw: string): string | null => {
  try {
    const parsed = new URL(raw.trim());
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !LOCAL_COMPANION_HOSTS.has(parsed.hostname) ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
};

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
    const clean = normalizeLocalCompanionUrl(url.replace(/[),.;]+$/g, ""));
    if (!clean) continue;
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
  modelRoleScope: "global",
  availableModels: [],
  availableModelsLoaded: false,
  sessions: [],
  activeSessionId: null,
  transcripts: {},
  activity: {},
  todos: {},
  subagents: {},
  reviewFiles: {},
  commandsBySession: {},
  states: {},
  turnStats: {},
  turnTiming: {},
  error: null,
  streaming: {},
  extensionUiRequests: {},
  browserArtifacts: {},
  companions: {},
  activeCompanionId: null,
  skills: [],
  skillsLoaded: false,
  roleMemoryCache: {},

  bootstrap: async () => {
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
      void get().loadModelRoles();
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
    const cwd = modelRoleCwd(get());
    try {
      const snapshot = await api.getModelRoles(cwd);
      if (modelRoleCwd(get()) !== cwd) return;
      set({
        modelRoles: snapshot.roles ?? [],
        modelRolesConfigPath: snapshot.configPath ?? null,
        modelRoleScope: snapshot.scope ?? "global",
      });
    } catch (error) {
      // Roles are supplemental chrome; don't block the app.
      console.warn("Unable to load model roles", error);
      if (modelRoleCwd(get()) === cwd) {
        set({
          modelRoles: [],
          modelRolesConfigPath: null,
          modelRoleScope: "global",
        });
      }
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
    const cwd = modelRoleCwd(get());
    try {
      const snapshot = await api.setModelRole(role, selector, cwd);
      if (modelRoleCwd(get()) !== cwd) {
        void get().loadModelRoles();
        return true;
      }
      set({
        modelRoles: snapshot.roles ?? [],
        modelRolesConfigPath: snapshot.configPath ?? null,
        modelRoleScope: snapshot.scope ?? "global",
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

  setActive: (sessionId) => {
    set({ activeSessionId: sessionId });
    if (isTauriRuntime()) void get().loadModelRoles();
  },

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
        reviewFiles: { ...state.reviewFiles, [session.id]: [] },
        states: { ...state.states, [session.id]: {} },
        turnStats: {
          ...state.turnStats,
          [session.id]: { ...EMPTY_TURN_STATS },
        },
        turnTiming: withoutSession(state.turnTiming, session.id),
        streaming: { ...state.streaming, [session.id]: false },
        browserArtifacts: { ...state.browserArtifacts, [session.id]: [] },
        companions: { ...state.companions, [session.id]: [] },
        error: null,
      }));
      void get().loadAvailableCommands(session.id);
      void get().ensureRoleMemoryPreamble("default", session.id);
      void get().loadSubagents(session.id);
      if (isTauriRuntime()) void get().loadModelRoles();
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
        reviewFiles: { ...state.reviewFiles, [session.id]: [] },
        states: { ...state.states, [session.id]: {} },
        turnStats: {
          ...state.turnStats,
          [session.id]: { ...EMPTY_TURN_STATS },
        },
        turnTiming: withoutSession(state.turnTiming, session.id),
        streaming: { ...state.streaming, [session.id]: false },
        browserArtifacts: { ...state.browserArtifacts, [session.id]: [] },
        companions: { ...state.companions, [session.id]: [] },
        error: null,
      }));
      void get().ensureRoleMemoryPreamble("default", session.id);
      void get().loadAvailableCommands(session.id);
      void get().loadSubagents(session.id);
      if (isTauriRuntime()) void get().loadModelRoles();
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
          keyPath: session.remote.keyPath ?? null,
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
        reviewFiles: withoutSession(state.reviewFiles, sessionId),
        states: withoutSession(state.states, sessionId),
        commandsBySession: withoutSession(state.commandsBySession, sessionId),
        turnStats: withoutSession(state.turnStats, sessionId),
        turnTiming: withoutSession(state.turnTiming, sessionId),
        streaming: withoutSession(state.streaming, sessionId),
        browserArtifacts: withoutSession(state.browserArtifacts, sessionId),
        companions: withoutSession(state.companions, sessionId),
        extensionUiRequests: withoutSession(
          state.extensionUiRequests,
          sessionId,
        ),
        error: null,
      };
    });
    if (isTauriRuntime()) void get().loadModelRoles();

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

  refreshSessionStats: async (sessionId) => {
    try {
      const raw = await api.getSessionStats(sessionId);
      if (!get().sessions.some((session) => session.id === sessionId)) return;
      const parsed = parseSessionStats(raw);
      set((state) => {
        const previous = state.turnStats[sessionId];
        const lastTurnMs = previous?.lastTurnMs ?? null;
        return {
          turnStats: {
            ...state.turnStats,
            [sessionId]: mergeTurnStats(previous, parsed, { lastTurnMs }),
          },
        };
      });
    } catch {
      // Stats are optional chrome; never surface transport noise in the strip.
    }
  },

  loadAvailableCommands: async (sessionId) => {
    try {
      const raw = await api.getAvailableCommands(sessionId);
      if (!get().sessions.some((session) => session.id === sessionId)) return;
      const remote = normalizeCommandsPayload(raw);
      const commands = mergeSlashCommands(HOST_SLASH_COMMANDS, remote);
      set((state) => ({
        commandsBySession: {
          ...state.commandsBySession,
          [sessionId]: commands,
        },
      }));
    } catch {
      if (!get().sessions.some((session) => session.id === sessionId)) return;
      set((state) => ({
        commandsBySession: {
          ...state.commandsBySession,
          [sessionId]: [...HOST_SLASH_COMMANDS],
        },
      }));
    }
  },

  loadSubagents: async (sessionId) => {
    try {
      try {
        await api.setSubagentSubscription(sessionId, "events");
      } catch {
        await api.setSubagentSubscription(sessionId, "progress");
      }
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

  loadSubagentMessages: async (sessionId, input) => {
    return api.getSubagentMessages(sessionId, input);
  },

  send: async (message, streamingBehavior, images) => {
    const sessionId = get().activeSessionId;
    const text = message.trim();
    const imagePayload = images?.length ? images : undefined;
    if (!sessionId || (!text && !imagePayload)) return false;

    const transcriptText =
      text ||
      (imagePayload
        ? `[${imagePayload.length} image${imagePayload.length === 1 ? "" : "s"}]`
        : "");

    set((state) => {
      const current = state.transcripts[sessionId] ?? [];
      return {
        transcripts: {
          ...state.transcripts,
          [sessionId]: [
            ...current,
            { id: nextItemId(current, "user"), kind: "user", text: transcriptText },
          ],
        },
      };
    });

    try {
      const session = get().sessions.find((item) => item.id === sessionId);
      let preamble = "";
      if (session) {
        const cacheKey = `default::${projectKeyForSession(session)}`;
        const cached = get().roleMemoryCache[cacheKey];
        if (cached && Date.now() - cached.loadedAt < 30_000) {
          preamble = cached.preamble;
        } else {
          // Don't stall first token on memory IPC; warm cache in background.
          void get().ensureRoleMemoryPreamble("default", sessionId);
        }
      }
      await api.prompt(
        sessionId,
        `${preamble}${text}`,
        streamingBehavior,
        imagePayload,
      );
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

  respondExtensionUi: async (sessionId, requestId, response) => {
    const request = (get().extensionUiRequests[sessionId] ?? []).find(
      (candidate) => candidate.id === requestId,
    );
    if (!request) return false;

    set((state) => ({
      extensionUiRequests: {
        ...state.extensionUiRequests,
        [sessionId]: (state.extensionUiRequests[sessionId] ?? []).filter(
          (candidate) => candidate.id !== requestId,
        ),
      },
    }));
    try {
      await api.respondExtensionUi(sessionId, requestId, response);
      return true;
    } catch (error) {
      set((state) => {
        if (!state.sessions.some((session) => session.id === sessionId)) {
          return { error: errorMessage(error) };
        }
        const queued = state.extensionUiRequests[sessionId] ?? [];
        return {
          extensionUiRequests: {
            ...state.extensionUiRequests,
            [sessionId]: queued.some(
              (candidate) => candidate.id === request.id,
            )
              ? queued
              : [request, ...queued],
          },
          error: `Unable to answer OMP dialog: ${errorMessage(error)}`,
        };
      });
      return false;
    }
  },

  applyOmpEvent: (sessionId, event) => {
    if (!get().sessions.some((session) => session.id === sessionId)) return;
    if (!isRecord(event)) return;
    const type = readString(event, "type");

    if (type === "rpc_frame_error") {
      const message =
        readString(event, "error") ?? "OMP RPC transport reported an unknown error";
      const originalType = readString(event, "originalType");
      set((state) => ({
        error: `OMP RPC transport error: ${message}`,
        activity: {
          ...state.activity,
          [sessionId]: appendActivity(
            state.activity[sessionId] ?? [],
            originalType
              ? `RPC transport error · ${originalType}`
              : "RPC transport error",
            event,
          ),
        },
      }));
      return;
    }

    if (type === "extension_ui_request") {
      const request = parseExtensionUiRequest(event);
      if (!request) return;

      if (request.method === "cancel") {
        if (!request.targetId) return;
        set((state) => ({
          extensionUiRequests: {
            ...state.extensionUiRequests,
            [sessionId]: (
              state.extensionUiRequests[sessionId] ?? []
            ).filter((candidate) => candidate.id !== request.targetId),
          },
        }));
        return;
      }

      if (request.method === "open_url") {
        const url = request.launchUrl ?? request.url;
        if (url) {
          void openExternalUrl(url).catch((error) =>
            set({ error: `Unable to open sign-in URL: ${errorMessage(error)}` }),
          );
        }
        return;
      }

      if (request.method === "notify") {
        set((state) => ({
          activity: {
            ...state.activity,
            [sessionId]: appendActivity(
              state.activity[sessionId] ?? [],
              request.message ?? "OMP notification",
              event,
            ),
          },
        }));
        return;
      }

      if (request.method === "set_editor_text") {
        if (request.text !== undefined) {
          window.dispatchEvent(
            new CustomEvent("omp-desktop:set-composer-text", {
              detail: { sessionId, text: request.text },
            }),
          );
        }
        return;
      }

      if (request.method === "setTitle" && request.title) {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? { ...session, title: request.title ?? session.title }
              : session,
          ),
        }));
        return;
      }

      if (request.method === "setStatus") {
        if (request.statusText) {
          set((state) => ({
            activity: {
              ...state.activity,
              [sessionId]: appendActivity(
                state.activity[sessionId] ?? [],
                request.statusKey
                  ? `${request.statusKey} · ${request.statusText}`
                  : request.statusText ?? "OMP status updated",
                event,
              ),
            },
          }));
        }
        return;
      }

      if (
        request.method !== "select" &&
        request.method !== "confirm" &&
        request.method !== "input" &&
        request.method !== "editor"
      ) {
        return;
      }

      set((state) => {
        const queued = state.extensionUiRequests[sessionId] ?? [];
        if (queued.some((candidate) => candidate.id === request.id)) {
          return state;
        }
        return {
          extensionUiRequests: {
            ...state.extensionUiRequests,
            [sessionId]: [...queued, request],
          },
        };
      });
      return;
    }

    if (
      type === "subagent_lifecycle" ||
      type === "subagent_progress" ||
      type === "subagent_event"
    ) {
      const payload = asRecord(event.payload) ?? asRecord(event);
      if (!payload) return;
      const eventName =
        readString(payload, "event", "eventType", "kind", "type") ?? type;
      const hasIdentity =
        Boolean(
          readString(payload, "id", "agentId", "sessionId") ??
            (asRecord(payload.progress)
              ? readString(asRecord(payload.progress)!, "id")
              : undefined),
        ) || type !== "subagent_event";
      set((state) => {
        const current = state.subagents[sessionId] ?? [];
        let subagents = current;
        let next: SubagentInfo | null = null;
        if (hasIdentity) {
          next = normalizeSubagent(payload, current.length);
          if (next) {
            const existingIndex = current.findIndex(
              (subagent) => subagent.id === next!.id,
            );
            subagents = [...current];
            if (existingIndex === -1) {
              subagents.push(next);
            } else {
              subagents[existingIndex] = mergeSubagentInfo(
                subagents[existingIndex],
                next,
              );
            }
          }
        }
        const activityText =
          type === "subagent_lifecycle" && next
            ? `${next.name} · ${next.status}`
            : type === "subagent_event" &&
                (eventName.startsWith("tool_execution_") ||
                  eventName.includes("tool"))
              ? `${next?.name ?? readString(payload, "name", "agent", "label") ?? "subagent"} · ${eventName}${
                  next?.currentTool || readString(payload, "currentTool", "tool")
                    ? ` · ${next?.currentTool ?? readString(payload, "currentTool", "tool")}`
                    : ""
                }`
              : type === "subagent_event"
                ? `${next?.name ?? readString(payload, "name", "agent", "label") ?? "subagent"} · ${eventName}`
                : null;
        const activity = activityText
          ? {
              ...state.activity,
              [sessionId]: appendActivity(
                state.activity[sessionId] ?? [],
                activityText,
                event,
              ),
            }
          : state.activity;
        if (subagents === current && activity === state.activity) {
          return state;
        }
        return {
          subagents: {
            ...state.subagents,
            [sessionId]: subagents,
          },
          activity,
        };
      });
      return;
    }

    if (type === "thinking_level_changed") {
      const thinkingLevel = readString(event, "thinkingLevel", "resolved");
      if (!thinkingLevel) return;
      set((state) => ({
        states: mergeSessionRuntimeState(state.states, sessionId, {
          thinkingLevel,
        }),
      }));
      return;
    }

    if (type === "auto_compaction_start" || type === "auto_compaction_end") {
      const started = type === "auto_compaction_start";
      const action = readString(event, "action");
      const aborted = event.aborted === true;
      set((state) => ({
        states: mergeSessionRuntimeState(state.states, sessionId, {
          isCompacting: started,
        }),
        activity: {
          ...state.activity,
          [sessionId]: appendActivity(
            state.activity[sessionId] ?? [],
            `Context compaction ${
              started ? "started" : aborted ? "aborted" : "completed"
            }${action ? ` · ${action}` : ""}`,
            event,
          ),
        },
      }));
      return;
    }

    if (type === "notice") {
      const message = readString(event, "message") ?? "OMP notification";
      const level = readString(event, "level");
      set((state) => ({
        ...(level === "error" ? { error: message } : {}),
        activity: {
          ...state.activity,
          [sessionId]: appendActivity(
            state.activity[sessionId] ?? [],
            message,
            event,
          ),
        },
      }));
      return;
    }

    if (type === "auto_retry_start" || type === "auto_retry_end") {
      const started = type === "auto_retry_start";
      const attempt =
        typeof event.attempt === "number" ? ` · attempt ${event.attempt}` : "";
      const succeeded = event.success === true;
      set((state) => ({
        activity: {
          ...state.activity,
          [sessionId]: appendActivity(
            state.activity[sessionId] ?? [],
            started
              ? `Model retry scheduled${attempt}`
              : `Model retry ${succeeded ? "recovered" : "ended"}${attempt}`,
            event,
          ),
        },
      }));
      return;
    }

    if (
      type === "retry_fallback_applied" ||
      type === "retry_fallback_succeeded"
    ) {
      const from = readString(event, "from");
      const to = readString(event, "to", "model");
      set((state) => ({
        activity: {
          ...state.activity,
          [sessionId]: appendActivity(
            state.activity[sessionId] ?? [],
            type === "retry_fallback_applied"
              ? `Model fallback${from && to ? ` · ${from} → ${to}` : ""}`
              : `Model fallback succeeded${to ? ` · ${to}` : ""}`,
            event,
          ),
        },
      }));
      return;
    }

    if (type === "todo_reminder" || type === "todo_auto_clear") {
      void get().refreshState(sessionId);
      return;
    }

    if (type === "ttsr_triggered" || type === "goal_updated" || type === "irc_message") {
      const label =
        type === "ttsr_triggered"
          ? "TTSR guidance applied"
          : type === "goal_updated"
            ? event.goal == null
              ? "Goal cleared"
              : "Goal updated"
            : "IRC message received";
      set((state) => ({
        activity: {
          ...state.activity,
          [sessionId]: appendActivity(
            state.activity[sessionId] ?? [],
            label,
            event,
          ),
        },
      }));
      return;
    }

    if (
      type === "agent_start" ||
      type === "agent_end" ||
      type === "turn_start" ||
      type === "turn_end"
    ) {
      const isStart = type === "agent_start" || type === "turn_start";
      const isEnd = type === "agent_end" || type === "turn_end";
      const willContinue = type === "agent_end" && event.willContinue === true;

      if (isStart) {
        set((state) => ({
          streaming: {
            ...state.streaming,
            [sessionId]:
              type === "agent_start" ? true : state.streaming[sessionId],
          },
          turnTiming: {
            ...state.turnTiming,
            [sessionId]: Date.now(),
          },
        }));
        return;
      }

      if (isEnd) {
        const endedAt = Date.now();
        set((state) => {
          const startedAt = state.turnTiming[sessionId];
          const lastTurnMs =
            typeof startedAt === "number" && endedAt >= startedAt
              ? endedAt - startedAt
              : state.turnStats[sessionId]?.lastTurnMs ?? null;
          const previous = state.turnStats[sessionId];
          const nextStats = previous
            ? mergeTurnStats(previous, previous, { lastTurnMs })
            : {
                ...EMPTY_TURN_STATS,
                lastTurnMs,
                tps: null,
              };
          const nextTiming = { ...state.turnTiming };
          delete nextTiming[sessionId];
          return {
            streaming: {
              ...state.streaming,
              [sessionId]:
                type === "agent_end" ? willContinue : state.streaming[sessionId],
            },
            turnTiming: nextTiming,
            turnStats: {
              ...state.turnStats,
              [sessionId]: nextStats,
            },
          };
        });

        if (type === "agent_end" && willContinue) {
          return;
        }

        // Never block the UI/stream path: refresh + memory/job board work runs after the turn.
        if (type === "agent_end" || type === "turn_end") {
          void get().refreshState(sessionId);
          void get().refreshSessionStats(sessionId);
        }

        if (type === "agent_end" && !willContinue) {
          const session = get().sessions.find((item) => item.id === sessionId);
          if (session) {
            const projectKey = projectKeyForSession(session);
            const projectLabel = projectLabelForSession(session);
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
            void get().ensureRoleMemoryPreamble("default", sessionId);
          }
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
          const nextResponseId = responseId ?? last.responseId;
          const nextThinking = thinking || last.thinking;
          const nextItem: Extract<TranscriptItem, { kind: "assistant" }> = {
            id: responseId ?? last.id,
            kind: "assistant",
            text: text || last.text,
          };
          if (nextThinking) nextItem.thinking = nextThinking;
          if (nextResponseId !== undefined) {
            nextItem.responseId = nextResponseId;
          }
          return {
            transcripts: {
              ...state.transcripts,
              [sessionId]: [...current.slice(0, -1), nextItem],
            },
          };
        }
        const nextItem: Extract<TranscriptItem, { kind: "assistant" }> = {
          id: responseId ?? nextItemId(current, "assistant"),
          kind: "assistant",
          text,
        };
        if (thinking) nextItem.thinking = thinking;
        if (responseId !== undefined) nextItem.responseId = responseId;
        return {
          transcripts: {
            ...state.transcripts,
            [sessionId]: [...current, nextItem],
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
          const nextResponseId = responseId ?? last.responseId;
          const nextThinking = isThinking
            ? `${last.thinking ?? ""}${delta}`
            : last.thinking;
          const nextItem: Extract<TranscriptItem, { kind: "assistant" }> = {
            id: responseId ?? last.id,
            kind: "assistant",
            text: isText ? `${last.text}${delta}` : last.text,
          };
          if (nextThinking) nextItem.thinking = nextThinking;
          if (nextResponseId !== undefined) {
            nextItem.responseId = nextResponseId;
          }
          return {
            transcripts: {
              ...state.transcripts,
              [sessionId]: [...current.slice(0, -1), nextItem],
            },
          };
        }

        const nextItem: Extract<TranscriptItem, { kind: "assistant" }> = {
          id: messageId ?? nextItemId(current, "assistant"),
          kind: "assistant",
          text: isText ? delta : "",
        };
        if (isThinking && delta) nextItem.thinking = delta;
        if (responseId !== undefined) nextItem.responseId = responseId;
        return {
          transcripts: {
            ...state.transcripts,
            [sessionId]: [...current, nextItem],
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
      const mergedDetail =
        existing?.kind === "tool" ? detail || existing.detail : detail;
      const parsed = parseToolPayload(toolName, mergedDetail || "");
      const item: TranscriptItem = {
        id: tool.id,
        kind: "tool",
        name: toolName,
        detail: mergedDetail,
        status: isEnd ? (isError ? "error" : "done") : "running",
        ...(parsed.kind !== "raw" ? { parsed } : {}),
      };
      const nextTranscript = [...transcript];

      if (existingIndex === -1) {
        nextTranscript.push(item);
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

      let nextReviewFiles = state.reviewFiles[sessionId] ?? EMPTY_REVIEW_FILES;
      const reviewEntry = reviewFileFromTool(
        toolName,
        mergedDetail || "",
        tool.id,
        item.status,
      );
      if (reviewEntry) {
        nextReviewFiles = upsertReviewFile(nextReviewFiles, reviewEntry);
      }


      return {
        transcripts: { ...state.transcripts, [sessionId]: nextTranscript },
        activity: { ...state.activity, [sessionId]: nextActivity },
        browserArtifacts: { ...state.browserArtifacts, [sessionId]: browserArtifacts },
        companions: { ...state.companions, [sessionId]: companions },
        activeCompanionId,
        reviewFiles: { ...state.reviewFiles, [sessionId]: nextReviewFiles },
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

  ensureRoleMemoryPreamble: async (role, sessionId) => {
    const session = get().sessions.find((item) => item.id === sessionId);
    if (!session) return "";
    const projectKey = projectKeyForSession(session);
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
      extensionUiRequests: withoutSession(
        state.extensionUiRequests,
        sessionId,
      ),
      error:
        state.activeSessionId === sessionId
          ? "Session process exited. Restart to continue in this folder."
          : state.error,
    }));
  },
}));
