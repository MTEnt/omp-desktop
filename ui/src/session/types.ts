export type ApprovalMode = "yolo" | "write" | "alwaysAsk";

export type SessionStatus = "starting" | "ready" | "error" | "exited";

export interface RemoteSessionInfo {
  hostName: string;
  host: string;
  user?: string | null;
  port?: number | null;
  keyPath?: string | null;
  remoteCwd: string;
  label: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  profile?: string | null;
  status: SessionStatus;
  remote?: RemoteSessionInfo | null;
}

export interface SshHostInfo {
  name: string;
  host: string;
  user?: string | null;
  port?: number | null;
  keyPath?: string | null;
  description?: string | null;
  source: string;
  scope?: string | null;
}

export interface RemoteTarget {
  hostName: string;
  host: string;
  user?: string | null;
  port?: number | null;
  keyPath?: string | null;
  remoteCwd: string;
}

export interface SshProbeResult {
  ok: boolean;
  message: string;
  remoteCwd?: string | null;
}

export interface AppSettings {
  approvalMode: ApprovalMode;
  ompBinary?: string | null;
  defaultModel?: string | null;
  defaultThinking?: string | null;
  defaultProfile?: string | null;
  theme: string;
  /** False until the first-launch walkthrough is finished. */
  onboardingCompleted?: boolean;
}

export interface SetupStatus {
  ompFound: boolean;
  ompPath?: string | null;
  ompVersion?: string | null;
  ompSupported: boolean;
  minimumOmpVersion: string;
  impeccableSkillPresent: boolean;
  impeccableSkillPath?: string | null;
  impeccableRulesPresent: boolean;
  onboardingCompleted: boolean;
  homeDir?: string | null;
}

export interface ExtensionUiRequest {
  id: string;
  method:
    | "select"
    | "confirm"
    | "input"
    | "editor"
    | "cancel"
    | "notify"
    | "setStatus"
    | "setWidget"
    | "setTitle"
    | "set_editor_text"
    | "open_url";
  title?: string;
  message?: string;
  placeholder?: string;
  prefill?: string;
  options?: string[];
  timeout?: number;
  targetId?: string;
  url?: string;
  launchUrl?: string;
  instructions?: string;
  notifyType?: "info" | "warning" | "error";
  statusKey?: string;
  statusText?: string;
  text?: string;
}

export type ExtensionUiResponse =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true; timedOut?: boolean };

export type TranscriptItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; thinking?: string; responseId?: string }
  | {
      id: string;
      kind: "tool";
      name: string;
      detail: string;
      status: "running" | "done" | "error";
    }
  | { id: string; kind: "system"; text: string };

export interface ActivityItem {
  id: string;
  at: number;
  text: string;
}

export interface SubagentInfo {
  id: string;
  name: string;
  status: string;
  progress?: string;
}

export interface TodoTask {
  id: string;
  content: string;
  status: string;
}

export interface TodoPhase {
  id: string;
  name: string;
  tasks: TodoTask[];
}

export interface ModelRoleAssignment {
  role: string;
  selector: string;
  provider?: string | null;
  modelId?: string | null;
  thinking?: string | null;
  shortLabel: string;
  source?: ModelRoleScope;
}

export interface ModelRolesSnapshot {
  configPath?: string | null;
  scope: ModelRoleScope;
  roles: ModelRoleAssignment[];
}

export type ModelRoleScope = "global" | "project";

export interface AvailableModel {
  provider: string;
  id: string;
  name: string;
  selector: string;
  reasoning: boolean;
  thinkingEfforts: string[];
}

export interface RoleMemoryNote {
  id: number;
  role: string;
  projectKey: string;
  kind: string;
  title: string;
  body: string;
  sourceSessionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RoleScratchpad {
  role: string;
  projectKey: string;
  content: string;
  updatedAt: number;
}

export interface PersistentAgent {
  id: string;
  role: string;
  displayName: string;
  projectKey: string;
  status: string;
  currentJob?: string | null;
  lastSessionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface JobCard {
  id: string;
  projectKey: string;
  projectLabel: string;
  title: string;
  detail: string;
  status: string;
  assigneeAgentId?: string | null;
  assigneeRole?: string | null;
  sessionId?: string | null;
  createdAt: number;
  updatedAt: number;
}


export interface RemoteDirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface RemoteDirListing {
  path: string;
  parent?: string | null;
  entries: RemoteDirEntry[];
}

export interface SshRecent {
  hostName: string;
  host: string;
  user?: string | null;
  port?: number | null;
  keyPath?: string | null;
  remoteCwd: string;
  label: string;
  lastUsedMs: number;
}

export interface BrowserArtifact {
  id: string;
  sessionId: string;
  at: number;
  tabName?: string | null;
  url?: string | null;
  action?: string | null;
  note?: string | null;
  /** data URL or https URL */
  imageUrl?: string | null;
  rawDetail?: string | null;
}

export interface CompanionTarget {
  id: string;
  sessionId: string;
  url: string;
  title: string;
  at: number;
  source: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: string;
}

export interface LaunchRecipe {
  id: string;
  group: string;
  label: string;
  detail: string;
  keywords: string;
  /** prompt sent to active session */
  prompt: string;
  openPanel?: "browser" | "companion" | "launch" | "plan" | "terminal";
}
