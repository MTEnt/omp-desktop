import { useMemo, useState, type FormEvent } from "react";

import {
  groupSessionsByWorkspace,
  useWorkspaceStore,
} from "../app/workspace-store.ts";
import { useSessionStore } from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";
import { SessionLibraryPanel } from "./session-library-panel.tsx";

type SessionsTab = "open" | "library";

export const SessionsPanel = () => {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const streaming = useSessionStore((state) => state.streaming);
  const setActive = useSessionStore((state) => state.setActive);
  const openFolder = useSessionStore((state) => state.openFolder);
  const closeSession = useSessionStore((state) => state.closeSession);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const [tab, setTab] = useState<SessionsTab>("open");
  const [resume, setResume] = useState("");
  const [isOpening, setIsOpening] = useState(false);

  const groups = useMemo(
    () => groupSessionsByWorkspace(sessions, workspaces),
    [sessions, workspaces],
  );

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
      <div className="sessions-panel__tabs" role="tablist" aria-label="Sessions views">
        <button
          type="button"
          role="tab"
          id="sessions-tab-open"
          aria-selected={tab === "open"}
          aria-controls="sessions-tabpanel-open"
          className={`sessions-panel__tab${tab === "open" ? " is-active" : ""}`}
          onClick={() => setTab("open")}
        >
          Open
        </button>
        <button
          type="button"
          role="tab"
          id="sessions-tab-library"
          aria-selected={tab === "library"}
          aria-controls="sessions-tabpanel-library"
          className={`sessions-panel__tab${tab === "library" ? " is-active" : ""}`}
          onClick={() => setTab("library")}
        >
          Library
        </button>
      </div>

      {tab === "open" ? (
        <div
          className="sessions-panel__tabpanel"
          role="tabpanel"
          id="sessions-tabpanel-open"
          aria-labelledby="sessions-tab-open"
        >
          <div className="panel-toolbar">
            <button
              type="button"
              className="panel-button panel-button--primary"
              disabled={isOpening}
              onClick={() => void createSession()}
            >
              {isOpening ? "Opening…" : "New session"}
            </button>
            <button
              type="button"
              className="panel-button"
              onClick={() => window.dispatchEvent(new Event("omp-desktop:open-ssh"))}
            >
              SSH
            </button>
          </div>

          {sessions.length > 0 ? (
            <div className="session-list" aria-label="Open sessions">
              {groups.map((group) => (
                <section
                  key={group.workspace?.id ?? `cwd:${group.cwdKey}`}
                  className="session-group"
                  aria-label={group.label}
                >
                  <header className="session-group__header">
                    <span
                      className="session-group__swatch"
                      style={
                        group.color
                          ? { background: group.color }
                          : undefined
                      }
                      aria-hidden="true"
                    />
                    <span className="session-group__label">
                      {group.label}
                      {group.workspace?.pinned ? " · pinned" : ""}
                    </span>
                    <span className="session-group__count">
                      {group.sessions.length}
                    </span>
                  </header>
                  {group.sessions.map((session) => {
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
                            <strong>
                              {session.title}
                              {session.remote ? " ↗" : ""}
                            </strong>
                            <small>{session.remote?.label ?? session.cwd}</small>
                          </span>
                        </button>
                        <span className="session-row__status">
                          {isStreaming ? "streaming" : session.status}
                        </span>
                        <button
                          type="button"
                          className="session-row__close"
                          title={`Close ${session.title}${session.remote ? " ↗" : ""}`}
                          aria-label={`Close ${session.title}${session.remote ? " ↗" : ""}`}
                          onClick={() => void closeSession(session.id)}
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="m4 4 8 8M12 4 4 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          ) : (
            <EmptyState>Open a project folder to begin a new OMP session.</EmptyState>
          )}

          <form
            className="resume-form resume-form--advanced"
            onSubmit={(event) => void resumeSession(event)}
          >
            <label htmlFor="session-resume">Advanced resume</label>
            <p>
              Paste an OMP session id or transcript path, then choose its project folder.
            </p>
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
        </div>
      ) : (
        <div
          className="sessions-panel__tabpanel"
          role="tabpanel"
          id="sessions-tabpanel-library"
          aria-labelledby="sessions-tab-library"
        >
          <SessionLibraryPanel />
        </div>
      )}
    </div>
  );
};
