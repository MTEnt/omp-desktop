import { useState, type FormEvent } from "react";

import { useSessionStore } from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";

export const SessionsPanel = () => {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const streaming = useSessionStore((state) => state.streaming);
  const setActive = useSessionStore((state) => state.setActive);
  const openFolder = useSessionStore((state) => state.openFolder);
  const closeSession = useSessionStore((state) => state.closeSession);
  const [resume, setResume] = useState("");
  const [isOpening, setIsOpening] = useState(false);

  const createSession = async () => {
    setIsOpening(true);
    try {
      await openFolder();
    } finally {
      setIsOpening(false);
    }
  };

  const resumeSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = resume.trim();
    if (!value) return;

    setIsOpening(true);
    try {
      await openFolder(undefined, value);
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <div className="sessions-panel">
      <div className="panel-toolbar">
        <button
          type="button"
          className="panel-button panel-button--primary"
          disabled={isOpening}
          onClick={() => void createSession()}
        >
          {isOpening ? "Opening…" : "New session"}
        </button>
      </div>

      <form className="resume-form" onSubmit={(event) => void resumeSession(event)}>
        <label htmlFor="session-resume">Resume session</label>
        <p>Enter an OMP session id or transcript path, then choose its project folder.</p>
        <div>
          <input
            id="session-resume"
            type="text"
            value={resume}
            placeholder="Session id or path"
            autoComplete="off"
            onChange={(event) => setResume(event.target.value)}
          />
          <button
            type="submit"
            className="panel-button"
            disabled={isOpening || !resume.trim()}
          >
            Resume
          </button>
        </div>
      </form>


      {sessions.length > 0 ? (
        <div className="session-list" aria-label="Open sessions">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isStreaming = streaming[session.id] === true;

            return (
              <div
                className={`session-row${isActive ? " is-current" : ""}`}
                key={session.id}
              >
                <button
                  type="button"
                  className="session-row__select"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setActive(session.id)}
                >
                  <span className={`status-dot status-dot--${session.status}`} />
                  <span className="session-row__copy">
                    <strong>{session.title}</strong>
                    <small>{session.cwd}</small>
                  </span>
                </button>
                <span className="session-row__status">
                  {isStreaming ? "streaming" : session.status}
                </span>
                <button
                  type="button"
                  className="session-row__close"
                  title={`Close ${session.title}`}
                  aria-label={`Close ${session.title}`}
                  onClick={() => void closeSession(session.id)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 4 8 8M12 4 4 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState>Open a project folder to begin a new OMP session.</EmptyState>
      )}
    </div>
  );
};
