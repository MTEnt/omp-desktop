import type { ExtensionUiRequest, SessionInfo } from "./types.ts";

export type AttentionKind =
  | "approval"
  | "question"
  | "confirmation"
  | "plan"
  | "failed"
  | "input";

export interface AttentionItem {
  key: string;
  sessionId: string;
  sessionTitle: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  requestId: string;
  method: ExtensionUiRequest["method"];
}

export function classifyExtensionRequest(
  req: ExtensionUiRequest,
): AttentionKind | null {
  switch (req.method) {
    case "confirm": {
      const haystack = `${req.title ?? ""} ${req.message ?? ""}`.toLowerCase();
      if (/\bapprov/.test(haystack)) return "approval";
      if (/\bplan\b/.test(haystack)) return "plan";
      return "confirmation";
    }
    case "select":
      return "question";
    case "input":
    case "editor":
      return "input";
    case "notify":
      return req.notifyType === "error" ? "failed" : null;
    case "cancel":
    case "open_url":
    case "setStatus":
    case "setWidget":
    case "setTitle":
    case "set_editor_text":
      return null;
    default:
      return null;
  }
}

const itemTitle = (req: ExtensionUiRequest, kind: AttentionKind): string => {
  if (req.title?.trim()) return req.title.trim();
  switch (kind) {
    case "approval":
      return "Approval needed";
    case "confirmation":
      return "Confirmation needed";
    case "question":
      return "Question";
    case "input":
      return "Input needed";
    case "plan":
      return "Plan review";
    case "failed":
      return "Error";
  }
};

const itemDetail = (req: ExtensionUiRequest): string => {
  const message = req.message?.trim();
  if (message) return message;
  if (req.placeholder?.trim()) return req.placeholder.trim();
  if (req.options && req.options.length > 0) {
    return req.options.join(" · ");
  }
  return "";
};

export function buildAttentionInbox(input: {
  sessions: SessionInfo[];
  extensionUiRequests: Record<string, ExtensionUiRequest[]>;
  sessionErrors?: Record<string, string | null | undefined>;
}): AttentionItem[] {
  const seen = new Set<string>();
  const items: AttentionItem[] = [];

  for (const session of input.sessions) {
    const requests = input.extensionUiRequests[session.id] ?? [];
    for (const request of requests) {
      const kind = classifyExtensionRequest(request);
      if (!kind) continue;

      const key = `${session.id}:${request.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      items.push({
        key,
        sessionId: session.id,
        sessionTitle: session.title || session.id,
        kind,
        title: itemTitle(request, kind),
        detail: itemDetail(request),
        requestId: request.id,
        method: request.method,
      });
    }

    const sessionError = input.sessionErrors?.[session.id];
    if (typeof sessionError === "string" && sessionError.trim()) {
      const key = `${session.id}:error`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          key,
          sessionId: session.id,
          sessionTitle: session.title || session.id,
          kind: "failed",
          title: "Session error",
          detail: sessionError.trim(),
          requestId: "error",
          method: "notify",
        });
      }
    }
  }

  return items;
}
