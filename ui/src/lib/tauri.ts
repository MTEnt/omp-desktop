import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { open as tauriShellOpen } from "@tauri-apps/plugin-shell";

import type {
  AppSettings,
  SetupStatus,
  AvailableModel,
  RemoteTarget,
  SshHostInfo,
  SshProbeResult,
  SshRecent,
  SkillInfo,
  RemoteDirListing,
  JobCard,
  ModelRolesSnapshot,
  PersistentAgent,
  RoleMemoryNote,
  RoleScratchpad,
  SessionInfo,
  ExtensionUiResponse,
} from "../session/types.ts";

const getInternals = (): { invoke?: unknown } | null => {
  if (typeof window === "undefined") return null;
  const w = window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } };
  return w.__TAURI_INTERNALS__ ?? null;
};

export const isTauriRuntime = (): boolean =>
  typeof getInternals()?.invoke === "function";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(
      `Tauri API unavailable (invoke missing). Open OMP Desktop via the native app launcher, not a plain browser tab. Command: ${cmd}`,
    );
  }
  return tauriInvoke<T>(cmd, args);
}

export const api = {
  getSettings: () => invoke<AppSettings>("get_settings"),

  getSetupStatus: () => invoke<SetupStatus>("get_setup_status"),

  installImpeccable: () => invoke<SetupStatus>("install_impeccable"),

  getModelRoles: () => invoke<ModelRolesSnapshot>("get_model_roles"),

  setModelRole: (role: string, selector: string) =>
    invoke<ModelRolesSnapshot>("set_model_role", { role, selector }),

  listAvailableModels: () => invoke<AvailableModel[]>("list_available_models"),

  saveSettings: (settings: AppSettings) =>
    invoke<void>("save_settings", { settings }),

  listSessions: () => invoke<SessionInfo[]>("list_sessions"),

  createSession: (cwd: string, resume?: string, remote?: RemoteTarget | null) =>
    invoke<SessionInfo>("create_session", {
      cwd,
      resume: resume ?? null,
      remote: remote ?? null,
    }),

  listSshHosts: () => invoke<SshHostInfo[]>("list_ssh_hosts"),

  addSshHost: (input: {
    name: string;
    host: string;
    user?: string | null;
    port?: number | null;
    keyPath?: string | null;
    description?: string | null;
  }) =>
    invoke<SshHostInfo>("add_ssh_host", {
      name: input.name,
      host: input.host,
      user: input.user ?? null,
      port: input.port ?? null,
      keyPath: input.keyPath ?? null,
      description: input.description ?? null,
    }),

  testSshConnection: (remote: RemoteTarget) =>
    invoke<SshProbeResult>("test_ssh_connection", { remote }),

  createSshSession: (remote: RemoteTarget) =>
    invoke<SessionInfo>("create_ssh_session", { remote }),

  listRemoteDir: (remote: RemoteTarget, path?: string | null) =>
    invoke<RemoteDirListing>("list_remote_dir", {
      remote,
      path: path ?? null,
    }),

  listSshRecents: () => invoke<SshRecent[]>("list_ssh_recents"),

  listSkills: () => invoke<SkillInfo[]>("list_skills"),

  closeSession: (sessionId: string) =>
    invoke<void>("close_session", { sessionId }),

  openPty: (sessionId: string, cwd: string) =>
    invoke<void>("open_pty", { sessionId, cwd }),

  writePty: (sessionId: string, data: string) =>
    invoke<void>("write_pty", { sessionId, data }),

  resizePty: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("resize_pty", { sessionId, cols, rows }),

  closePty: (sessionId: string) => invoke<void>("close_pty", { sessionId }),

  prompt: (sessionId: string, message: string, streamingBehavior?: string) =>
    invoke<unknown>("prompt", {
      sessionId,
      message,
      streamingBehavior: streamingBehavior ?? null,
    }),

  abort: (sessionId: string) => invoke<unknown>("abort", { sessionId }),

  getState: (sessionId: string) => invoke<unknown>("get_state", { sessionId }),

  rpcCommand: (
    sessionId: string,
    command: string,
    params: Record<string, unknown> = {},
  ) => invoke<unknown>("rpc_command", { sessionId, command, params }),

  respondExtensionUi: (
    sessionId: string,
    requestId: string,
    response: ExtensionUiResponse,
  ) =>
    invoke<void>("respond_extension_ui", {
      sessionId,
      requestId,
      response,
    }),

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
    invoke<RoleScratchpad>("save_role_scratchpad", {
      role,
      projectKey,
      content,
    }),

  listAgents: (projectKey?: string | null) =>
    invoke<PersistentAgent[]>("list_agents", { projectKey: projectKey ?? null }),

  listJobs: (projectKey?: string | null) =>
    invoke<JobCard[]>("list_jobs", { projectKey: projectKey ?? null }),

  postTurnHousekeeping: (input: {
    sessionId: string;
    projectKey: string;
    projectLabel: string;
    role?: string;
    summary?: string;
  }) =>
    invoke<void>("post_turn_housekeeping", {
      sessionId: input.sessionId,
      projectKey: input.projectKey,
      projectLabel: input.projectLabel,
      role: input.role ?? null,
      summary: input.summary ?? null,
    }),

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

export async function openExternalUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported external URL protocol: ${url.protocol}`);
  }
  if (!isTauriRuntime()) {
    window.open(url.toString(), "_blank", "noopener,noreferrer");
    return;
  }
  await tauriShellOpen(url.toString());
}

export async function openDirectoryDialog(): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error(
      "Folder picker requires the native OMP Desktop window (Tauri).",
    );
  }
  const selected = await tauriOpen({
    directory: true,
    multiple: false,
    title: "Open folder",
  });
  if (!selected) return null;
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}

export async function listenTauriEvent<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  return tauriListen<T>(event, ({ payload }) => handler(payload));
}
