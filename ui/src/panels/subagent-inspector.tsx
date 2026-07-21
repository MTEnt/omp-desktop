import { useEffect, useMemo, useState } from "react";

import { useSessionStore } from "../session/session-store.ts";
import type { SubagentInfo } from "../session/types.ts";
import { EmptyState } from "./empty-state.tsx";

type InspectorMessage = {
  id: string;
  role: string;
  text: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const messageText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const record = asRecord(value);
  if (!record) return "";
  for (const key of ["text", "content", "message", "body"]) {
    const candidate = record[key];
    if (typeof candidate === "string") return candidate;
  }
  if (Array.isArray(record.content)) {
    return record.content
      .map((part) => {
        if (typeof part === "string") return part;
        const partRecord = asRecord(part);
        if (!partRecord) return "";
        if (typeof partRecord.text === "string") return partRecord.text;
        if (typeof partRecord.content === "string") return partRecord.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
};

const extractMessages = (response: unknown): InspectorMessage[] | null => {
  if (response == null) return [];
  if (Array.isArray(response)) {
    return response.map((item, index) => {
      const record = asRecord(item);
      const role =
        (record && typeof record.role === "string" && record.role) ||
        (record && typeof record.kind === "string" && record.kind) ||
        "message";
      const text = messageText(item) || JSON.stringify(item);
      return { id: `msg-${index}`, role, text };
    });
  }

  const root = asRecord(response);
  if (!root) return null;

  const data = asRecord(root.data);
  const candidates = [root.messages, data?.messages, root.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return extractMessages(candidate);
    }
  }

  return null;
};

const formatMeta = (label: string, value: string | number | null | undefined) => {
  if (value == null || value === "") return null;
  return (
    <div className="subagent-inspector__meta-row" key={label}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
};

export type SubagentInspectorProps = {
  sessionId: string;
  subagent: SubagentInfo;
  onBack: () => void;
};

export const SubagentInspector = ({
  sessionId,
  subagent,
  onBack,
}: SubagentInspectorProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<unknown>(null);

  useEffect(() => {
    if (!subagent.sessionFile && !subagent.id) {
      setRaw(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let disposed = false;
    setIsLoading(true);
    setError(null);
    setRaw(null);

    void useSessionStore
      .getState()
      .loadSubagentMessages(sessionId, {
        subagentId: subagent.id,
        sessionFile: subagent.sessionFile ?? undefined,
      })
      .then((response) => {
        if (disposed) return;
        setRaw(response);
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [sessionId, subagent.id, subagent.sessionFile]);

  const messages = useMemo(() => extractMessages(raw), [raw]);
  const title = subagent.agent ? `${subagent.name} · ${subagent.agent}` : subagent.name;

  return (
    <div className="subagent-inspector" aria-label={`Subagent ${subagent.name}`}>
      <header className="subagent-inspector__header">
        <button type="button" className="panel-button" onClick={onBack}>
          Back
        </button>
        <div className="subagent-inspector__title">
          <strong>{title}</strong>
          <span className={`subagent-status subagent-status--${subagent.status}`}>
            {subagent.status}
          </span>
        </div>
      </header>

      <dl className="subagent-inspector__meta">
        {formatMeta("Last intent", subagent.lastIntent)}
        {formatMeta("Current tool", subagent.currentTool)}
        {formatMeta("Tools", subagent.toolCount)}
        {formatMeta("Tokens", subagent.tokens)}
        {formatMeta("Session file", subagent.sessionFile)}
        {subagent.progress ? formatMeta("Progress", subagent.progress) : null}
      </dl>

      <section className="subagent-inspector__messages" aria-label="Subagent messages">
        {isLoading && <EmptyState>Loading transcript…</EmptyState>}
        {!isLoading && error && (
          <EmptyState>Could not load transcript: {error}</EmptyState>
        )}
        {!isLoading && !error && messages && messages.length === 0 && (
          <EmptyState>No messages recorded for this subagent.</EmptyState>
        )}
        {!isLoading && !error && messages && messages.length > 0 && (
          <ol className="subagent-inspector__message-list">
            {messages.map((message) => (
              <li key={message.id}>
                <span className="subagent-inspector__role">{message.role}</span>
                <p>{message.text}</p>
              </li>
            ))}
          </ol>
        )}
        {!isLoading && !error && messages === null && raw != null && (
          <pre className="subagent-inspector__raw">
            {JSON.stringify(raw, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
};
