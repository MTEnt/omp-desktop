export type ApprovalMode = "yolo" | "write" | "alwaysAsk";

export type SessionStatus = "starting" | "ready" | "error" | "exited";

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  profile?: string | null;
  status: SessionStatus;
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
  impeccableSkillPresent: boolean;
  impeccableSkillPath?: string | null;
  impeccableRulesPresent: boolean;
  onboardingCompleted: boolean;
  homeDir?: string | null;
}

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
}

export interface ModelRolesSnapshot {
  configPath?: string | null;
  roles: ModelRoleAssignment[];
}

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
