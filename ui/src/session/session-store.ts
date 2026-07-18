import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";

import { api } from "../lib/tauri.ts";
import type {
  ActivityItem,
  AppSettings,
  SessionInfo,
  SubagentInfo,
  TodoPhase,
  TranscriptItem,
} from "./types.ts";

type OmpEvent = Record<string, unknown>;

export interface SessionStore {
  settings: AppSettings | null;
  loadSettings: () => Promise<void>;
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
  closeSession: (sessionId: string) => Promise<void>;
  refreshState: (sessionId: string) => Promise<void>;
  loadSubagents: (sessionId: string) => Promise<void>;
  send: (message: string, streamingBehavior?: string) => Promise<boolean>;
  abort: () => Promise<void>;
  applyOmpEvent: (sessionId: string, event: unknown) => void;
  markExited: (sessionId: string) => void;
}

const EMPTY_TRANSCRIPT: TranscriptItem[] = [];

export const selectActiveTranscript = (
  state: SessionStore,
): TranscriptItem[] =>
  state.activeSessionId
    ? (state.transcripts[state.activeSessionId] ?? EMPTY_TRANSCRIPT)
    : EMPTY_TRANSCRIPT;

const isRecord = (value: unknown): value is OmpEvent =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): OmpEvent | null =>
  isRecord(value) ? value : null;

export interface SessionRuntimeStatus {
  model: string | null;
  thinkingLevel: string | null;
  contextPercent: number | null;
}

export const readSessionRuntimeStatus = (
  snapshot: unknown,
): SessionRuntimeStatus => {
  const envelope = asRecord(snapshot);
  const state = asRecord(envelope?.data) ?? envelope;
  const contextUsage = asRecord(state?.contextUsage);

  return {
    model: typeof state?.model === "string" ? state.model : null,
    thinkingLevel:
      typeof state?.thinkingLevel === "string" ? state.thinkingLevel : null,
    contextPercent:
      typeof contextUsage?.percent === "number" &&
      Number.isFinite(contextUsage.percent)
        ? contextUsage.percent
        : null,
  };
};

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

export const useSessionStore = create<SessionStore>()((set, get) => ({
  settings: null,
  sessions: [],
  activeSessionId: null,
  transcripts: {},
  activity: {},
  todos: {},
  subagents: {},
  states: {},
  error: null,
  streaming: {},

  bootstrap: async () => {
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
      const selectedCwd =
        cwd ??
        (await open({
          directory: true,
          multiple: false,
          title: "Open folder",
        }));
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
        error: null,
      }));
    } catch (error) {
      set({ error: `Unable to open folder: ${errorMessage(error)}` });
    }
  },

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
      await api.prompt(sessionId, text, streamingBehavior);
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
      if (type === "agent_end") void get().refreshState(sessionId);
      return;
    }

    if (type === "message_update") {
      const assistantEvent = asRecord(event.assistantMessageEvent);
      const delta = assistantEvent
        ? readString(assistantEvent, "delta", "text")
        : readString(event, "delta", "text");
      const eventType = assistantEvent
        ? readString(assistantEvent, "type")
        : readString(event, "messageType");
      if (eventType !== "text_delta" || delta === undefined) return;

      set((state) => {
        const current = state.transcripts[sessionId] ?? [];
        const messageId =
          (assistantEvent
            ? readString(assistantEvent, "messageId")
            : undefined) ?? readString(event, "messageId");
        const last = current.at(-1);

        if (
          last?.kind === "assistant" &&
          (messageId === undefined || messageId === last.id)
        ) {
          return {
            transcripts: {
              ...state.transcripts,
              [sessionId]: [
                ...current.slice(0, -1),
                { ...last, text: last.text + delta },
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
                id: messageId ?? nextItemId(current, "assistant"),
                kind: "assistant",
                text: delta,
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

      return {
        transcripts: { ...state.transcripts, [sessionId]: nextTranscript },
        activity: { ...state.activity, [sessionId]: nextActivity },
      };
    });
  },

  markExited: (sessionId) => {
    if (!get().sessions.some((session) => session.id === sessionId)) return;
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, status: "exited" } : session,
      ),
      streaming: { ...state.streaming, [sessionId]: false },
    }));
  },
}));
