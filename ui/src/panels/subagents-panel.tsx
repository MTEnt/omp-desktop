import { useEffect, useState } from "react";

import { useSessionStore } from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";

export const SubagentsPanel = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const subagents = useSessionStore((state) =>
    state.activeSessionId ? (state.subagents[state.activeSessionId] ?? []) : [],
  );
  const loadSubagents = useSessionStore((state) => state.loadSubagents);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!activeSessionId) return;
    let disposed = false;
    setIsLoading(true);
    void loadSubagents(activeSessionId).finally(() => {
      if (!disposed) setIsLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [activeSessionId, loadSubagents]);

  if (!activeSessionId) {
    return <EmptyState>Select a session to inspect delegated work.</EmptyState>;
  }

  if (isLoading && subagents.length === 0) {
    return <EmptyState>Loading delegated agents…</EmptyState>;
  }

  if (subagents.length === 0) {
    return <EmptyState>Delegated agents will report progress here.</EmptyState>;
  }

  return (
    <div className="subagent-list" aria-label="Subagents">
      <div className="subagent-summary">
        <strong>{subagents.length}</strong>
        <span>reporting</span>
      </div>
      {subagents.map((subagent) => (
        <article className="subagent-row" key={subagent.id}>
          <div>
            <strong>{subagent.name}</strong>
            <span className={`subagent-status subagent-status--${subagent.status}`}>
              {subagent.status}
            </span>
          </div>
          {subagent.progress && <p>{subagent.progress}</p>}
        </article>
      ))}
    </div>
  );
};
