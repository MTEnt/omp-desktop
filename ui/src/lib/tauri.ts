import { invoke } from "@tauri-apps/api/core";

import type { AppSettings, SessionInfo } from "../session/types.ts";

export const api = {
  getSettings: () => invoke<AppSettings>("get_settings"),

  saveSettings: (settings: AppSettings) =>
    invoke<void>("save_settings", { settings }),

  listSessions: () => invoke<SessionInfo[]>("list_sessions"),

  createSession: (cwd: string, resume?: string) =>
    invoke<SessionInfo>("create_session", { cwd, resume: resume ?? null }),

  closeSession: (sessionId: string) =>
    invoke<void>("close_session", { sessionId }),

  prompt: (
    sessionId: string,
    message: string,
    streamingBehavior?: string,
  ) =>
    invoke<unknown>("prompt", {
      sessionId,
      message,
      streamingBehavior: streamingBehavior ?? null,
    }),

  abort: (sessionId: string) => invoke<unknown>("abort", { sessionId }),

  getState: (sessionId: string) =>
    invoke<unknown>("get_state", { sessionId }),

  rpcCommand: (
    sessionId: string,
    command: string,
    params: Record<string, unknown> = {},
  ) => invoke<unknown>("rpc_command", { sessionId, command, params }),
};
