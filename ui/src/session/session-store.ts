import { create } from "zustand";

import { api } from "../lib/tauri.ts";
import type {
  ActivityItem,
  AppSettings,
  SessionInfo,
  TodoPhase,
  TranscriptItem,
} from "./types.ts";

type OmpEvent = Record<string, unknown>;

export interface SessionStore {
  settings: AppSettings | null;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  transcripts: Record<string, TranscriptItem[]>;
  activity: Record<string, ActivityItem[]>;
  todos: Record<string, TodoPhase[]>;
  subagents: Record<string, unknown[]>;
  states: Record<string, unknown>;
  streaming: Record<string, boolean>;
  bootstrap: () => Promise<void>;
  setActive: (sessionId: string | null) => void;
  openFolder: (cwd?: string) => Promise<void>;
  send: (message: string, streamingBehavior?: string) => Promise<void>;
  abort: () => Promise<void>;
  applyOmpEvent: (sessionId: string, event: OmpEvent) => void;
  markExited: (sessionId: string) => void;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

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

const formatDetail = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value, null, 2) ?? String(value);
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

  setActive: (sessionId) => set({ activeSessionId: sessionId }),

  openFolder: async (cwd) => {
    if (!cwd) return;
    const session = await api.createSession(cwd);
    set((state) => ({
      sessions: [
        ...state.sessions.filter((candidate) => candidate.id !== session.id),
        session,
      ],
      activeSessionId: session.id,
    }));
  },

  send: async (message, streamingBehavior) => {
    const sessionId = get().activeSessionId;
    const text = message.trim();
    if (!sessionId || !text) return;

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

    await api.prompt(sessionId, text, streamingBehavior);
  },

  abort: async () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    await api.abort(sessionId);
  },

  applyOmpEvent: (sessionId, event) => {
    const type = readString(event, "type");

    if (type === "agent_start" || type === "agent_end") {
      set((state) => ({
        streaming: {
          ...state.streaming,
          [sessionId]: type === "agent_start",
        },
      }));
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

  markExited: (sessionId) =>
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, status: "exited" } : session,
      ),
      streaming: { ...state.streaming, [sessionId]: false },
    })),
}));
