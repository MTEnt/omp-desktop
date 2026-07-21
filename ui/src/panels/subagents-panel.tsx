import { useEffect, useMemo, useState } from "react";

import {
  selectActiveSubagents,
  useSessionStore,
} from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";
import { SubagentInspector } from "./subagent-inspector.tsx";
import {
  buildSubagentTree,
  flattenSubagentTree,
} from "./subagent-tree.ts";

export const SubagentsPanel = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const subagents = useSessionStore(selectActiveSubagents);
  const loadSubagents = useSessionStore((state) => state.loadSubagents);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(null);
  }, [activeSessionId]);

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

  const treeNodes = useMemo(
    () => flattenSubagentTree(buildSubagentTree(subagents)),
    [subagents],
  );

  const selected = useMemo(
    () => subagents.find((agent) => agent.id === selectedId) ?? null,
    [selectedId, subagents],
  );

  if (!activeSessionId) {
    return <EmptyState>Select a session to inspect delegated work.</EmptyState>;
  }

  if (selected) {
    return (
      <SubagentInspector
        sessionId={activeSessionId}
        subagent={selected}
        onBack={() => setSelectedId(null)}
      />
    );
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
      {treeNodes.map((node) => (
        <button
          type="button"
          className="subagent-row subagent-row--button"
          key={node.agent.id}
          style={{ paddingLeft: `${11 + node.depth * 14}px` }}
          onClick={() => setSelectedId(node.agent.id)}
        >
          <div>
            <strong>
              {node.depth > 0 ? (
                <span className="subagent-row__branch" aria-hidden="true">
                  {"└ ".repeat(Math.min(node.depth, 1))}
                </span>
              ) : null}
              {node.agent.name}
              {node.agent.agent ? (
                <span className="subagent-row__agent">{node.agent.agent}</span>
              ) : null}
            </strong>
            <span
              className={`subagent-status subagent-status--${node.agent.status}`}
            >
              {node.agent.status}
            </span>
          </div>
          {node.agent.progress && <p>{node.agent.progress}</p>}
        </button>
      ))}
    </div>
  );
};
