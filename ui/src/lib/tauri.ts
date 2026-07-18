import { invoke } from "@tauri-apps/api/core";

import type { AppSettings, AvailableModel, JobCard, ModelRolesSnapshot, PersistentAgent, RoleMemoryNote, RoleScratchpad, SessionInfo } from "../session/types.ts";

export const api = {
  getSettings: () => invoke<AppSettings>("get_settings"),

  getModelRoles: () => invoke<ModelRolesSnapshot>("get_model_roles"),

  setModelRole: (role: string, selector: string) =>
    invoke<ModelRolesSnapshot>("set_model_role", { role, selector }),

  listAvailableModels: () => invoke<AvailableModel[]>("list_available_models"),

  saveSettings: (settings: AppSettings) =>
    invoke<void>("save_settings", { settings }),

  listSessions: () => invoke<SessionInfo[]>("list_sessions"),

  createSession: (cwd: string, resume?: string) =>
    invoke<SessionInfo>("create_session", { cwd, resume: resume ?? null }),

  closeSession: (sessionId: string) =>
    invoke<void>("close_session", { sessionId }),

  openPty: (sessionId: string, cwd: string) =>
    invoke<void>("open_pty", { sessionId, cwd }),

  writePty: (sessionId: string, data: string) =>
    invoke<void>("write_pty", { sessionId, data }),

  resizePty: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("resize_pty", { sessionId, cols, rows }),

  closePty: (sessionId: string) =>
    invoke<void>("close_pty", { sessionId }),

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

  rewriteAssistantMessage: (
    sessionId: string,
    text: string,
    responseId?: string | null,
  ) =>
    invoke<{ sessionFile: string; entryId: string; responseId?: string | null }>(
      "rewrite_assistant_message",
      { sessionId, text, responseId: responseId ?? null },
    ),

  listRoleNotes: (role: string, projectKey: string) =>
    invoke<RoleMemoryNote[]>("list_role_notes", { role, projectKey }),
  addRoleNote: (input: {
    role: string;
    projectKey: string;
    kind: string;
    title: string;
    body: string;
    sourceSessionId?: string | null;
  }) =>
    invoke<RoleMemoryNote>("add_role_note", {
      role: input.role,
      projectKey: input.projectKey,
      kind: input.kind,
      title: input.title,
      body: input.body,
      sourceSessionId: input.sourceSessionId ?? null,
    }),
  deleteRoleNote: (id: number) => invoke<void>("delete_role_note", { id }),
  getRoleScratchpad: (role: string, projectKey: string) =>
    invoke<RoleScratchpad>("get_role_scratchpad", { role, projectKey }),
  saveRoleScratchpad: (role: string, projectKey: string, content: string) =>
    invoke<RoleScratchpad>("save_role_scratchpad", { role, projectKey, content }),
  listAgents: (projectKey?: string | null) =>
    invoke<PersistentAgent[]>("list_agents", { projectKey: projectKey ?? null }),
  listJobs: (projectKey?: string | null) =>
    invoke<JobCard[]>("list_jobs", { projectKey: projectKey ?? null }),
  upsertJob: (job: {
    id: string;
    projectKey: string;
    projectLabel: string;
    title: string;
    detail: string;
    status: string;
    assigneeAgentId?: string | null;
    assigneeRole?: string | null;
    sessionId?: string | null;
  }) =>
    invoke<JobCard>("upsert_job", {
      id: job.id,
      projectKey: job.projectKey,
      projectLabel: job.projectLabel,
      title: job.title,
      detail: job.detail,
      status: job.status,
      assigneeAgentId: job.assigneeAgentId ?? null,
      assigneeRole: job.assigneeRole ?? null,
      sessionId: job.sessionId ?? null,
    }),
};
