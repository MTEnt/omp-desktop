import { useState } from "react";

import { useSessionStore } from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";

export const ProjectPanel = () => {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  if (!activeSession) {
    return (
      <EmptyState>Project context is available once a session is active.</EmptyState>
    );
  }

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(activeSession.cwd);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <div className="project-panel">
      <dl className="detail-list">
        <div>
          <dt>Working directory</dt>
          <dd className="project-path">{activeSession.cwd}</dd>
        </div>
        <div>
          <dt>Profile</dt>
          <dd>{activeSession.profile ?? "Default"}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{activeSession.status}</dd>
        </div>
      </dl>
      <button type="button" className="panel-button" onClick={() => void copyPath()}>
        {copyState === "copied" ? "Path copied" : "Copy path"}
      </button>
      {copyState === "error" && (
        <p className="panel-feedback panel-feedback--error">
          Clipboard access is unavailable.
        </p>
      )}
    </div>
  );
};
