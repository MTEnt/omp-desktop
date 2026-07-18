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
}

export type TranscriptItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; thinking?: string }
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
