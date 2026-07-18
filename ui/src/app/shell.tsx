import type { ReactNode } from "react";

import { useLayoutStore, type PanelId } from "./layout-store.ts";
import { LeftRail, RightRail, type RailTarget } from "./rails.tsx";
import { useSessionStore } from "../session/session-store.ts";
import { Composer } from "../session/composer.tsx";
import { Transcript } from "../session/transcript.tsx";

const panelMeta: Record<PanelId, { label: string; eyebrow: string }> = {
  sessions: { label: "Sessions", eyebrow: "Workspace" },
  project: { label: "Project", eyebrow: "Context" },
  settings: { label: "Settings", eyebrow: "Preferences" },
  terminal: { label: "Terminal", eyebrow: "Local shell" },
  plan: { label: "Plan", eyebrow: "Execution" },
  activity: { label: "Activity", eyebrow: "Timeline" },
  subagents: { label: "Subagents", eyebrow: "Delegation" },
};

const rightPanels: PanelId[] = ["plan", "activity", "subagents"];

const EmptyPanel = ({ children }: { children: ReactNode }) => (
  <div className="panel-empty">
    <span className="panel-empty__rule" />
    <p>{children}</p>
  </div>
);

const SessionTabs = () => {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const streaming = useSessionStore((state) => state.streaming);
  const setActive = useSessionStore((state) => state.setActive);
  const closeSession = useSessionStore((state) => state.closeSession);

  return (
    <nav className="session-tabs" aria-label="Session tabs">
      {sessions.length > 0 ? (
        <div className="session-tabs__scroll" role="tablist">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isStreaming = streaming[session.id] === true;

            return (
              <div
                className={`session-tab${isActive ? " is-active" : ""}`}
                key={session.id}
              >
                <button
                  type="button"
                  className="session-tab__select"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="session-transcript"
                  title={`${session.title} — ${session.cwd}`}
                  onClick={() => setActive(session.id)}
                >
                  {isStreaming && (
                    <span
                      className="session-tab__streaming"
                      title="Streaming"
                      aria-label="Streaming"
                    />
                  )}
                  <span className="session-tab__title">{session.title}</span>
                </button>
                <button
                  type="button"
                  className="session-tab__close"
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
        <span className="session-tabs__empty">No active session</span>
      )}
    </nav>
  );
};

const PanelBody = ({ panel }: { panel: PanelId }) => {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const settings = useSessionStore((state) => state.settings);
  const todosBySession = useSessionStore((state) => state.todos);
  const activityBySession = useSessionStore((state) => state.activity);
  const subagentsBySession = useSessionStore((state) => state.subagents);
  const todos = activeSessionId
    ? (todosBySession[activeSessionId] ?? [])
    : [];
  const activity = activeSessionId
    ? (activityBySession[activeSessionId] ?? [])
    : [];
  const subagents = activeSessionId
    ? (subagentsBySession[activeSessionId] ?? [])
    : [];
  const setActive = useSessionStore((state) => state.setActive);
  const streaming = useSessionStore((state) => state.streaming);
  const closeSession = useSessionStore((state) => state.closeSession);
  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );

  switch (panel) {
    case "sessions":
      return sessions.length > 0 ? (
        <div className="session-list">
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
        <EmptyPanel>Sessions will appear here after a project is opened.</EmptyPanel>
      );

    case "project":
      return activeSession ? (
        <dl className="detail-list">
          <div>
            <dt>Working directory</dt>
            <dd>{activeSession.cwd}</dd>
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
      ) : (
        <EmptyPanel>Project context is available once a session is active.</EmptyPanel>
      );

    case "settings":
      return (
        <dl className="detail-list">
          <div>
            <dt>Approval mode</dt>
            <dd>{settings?.approvalMode ?? "yolo"}</dd>
          </div>
          <div>
            <dt>Default model</dt>
            <dd>{settings?.defaultModel ?? "OMP default"}</dd>
          </div>
          <div>
            <dt>Theme</dt>
            <dd>{settings?.theme ?? "Dark"}</dd>
          </div>
        </dl>
      );

    case "terminal":
      return (
        <div className="terminal-placeholder" aria-label="Terminal placeholder">
          <span>$</span>
          <p>Terminal connection is not enabled in this foundation build.</p>
        </div>
      );

    case "plan":
      return todos.length > 0 ? (
        <div className="plan-list">
          {todos.map((phase) => (
            <section key={phase.id}>
              <h3>{phase.name}</h3>
              <ul>
                {phase.tasks.map((task) => (
                  <li key={task.id}>
                    <span className={`task-state task-state--${task.status}`} />
                    <span>{task.content}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <EmptyPanel>OMP task phases will collect here during a run.</EmptyPanel>
      );

    case "activity":
      return activity.length > 0 ? (
        <ol className="activity-list">
          {activity.map((item) => (
            <li key={item.id}>
              <time>{new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              <span>{item.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyPanel>Tool execution will form a quiet timeline here.</EmptyPanel>
      );

    case "subagents":
      return subagents.length > 0 ? (
        <div className="subagent-count">
          <strong>{subagents.length}</strong>
          <span>subagent{subagents.length === 1 ? "" : "s"} reporting</span>
        </div>
      ) : (
        <EmptyPanel>Delegated agents will report progress here.</EmptyPanel>
      );
  }
};

interface PanelHeaderProps {
  panel: PanelId;
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
}

const PanelHeader = ({ panel, pinned, onPin, onClose }: PanelHeaderProps) => {
  const meta = panelMeta[panel];

  return (
    <header className="panel-header">
      <div>
        <span>{meta.eyebrow}</span>
        <h2>{meta.label}</h2>
      </div>
      <div className="panel-header__actions">
        <button
          type="button"
          className={pinned ? "is-active" : ""}
          title={pinned ? `Unpin ${meta.label}` : `Pin ${meta.label}`}
          aria-label={pinned ? `Unpin ${meta.label}` : `Pin ${meta.label}`}
          aria-pressed={pinned}
          onClick={onPin}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m8 4 8 0-1 5 3 3v2H6v-2l3-3-1-5ZM12 14v6" />
          </svg>
        </button>
        <button
          type="button"
          title={`Close ${meta.label}`}
          aria-label={`Close ${meta.label}`}
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </header>
  );
};

export const Shell = () => {
  const drawer = useLayoutStore((state) => state.drawer);
  const pinned = useLayoutStore((state) => state.pinned);
  const closeDrawer = useLayoutStore((state) => state.closeDrawer);
  const toggleDrawer = useLayoutStore((state) => state.toggleDrawer);
  const togglePin = useLayoutStore((state) => state.togglePin);
  const settings = useSessionStore((state) => state.settings);
  const openFolder = useSessionStore((state) => state.openFolder);
  const activeTargets: RailTarget[] = [
    ...(drawer ? [drawer] : ["chat" as const]),
    ...pinned,
  ];

  const selectRail = (target: RailTarget) => {
    if (target === "chat") {
      closeDrawer();
      return;
    }
    toggleDrawer(target);
  };

  const pinDrawer = () => {
    if (!drawer) return;
    const alreadyPinned = pinned.includes(drawer);
    togglePin(drawer);
    if (!alreadyPinned) closeDrawer();
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand__sigil" aria-hidden="true">
            O
          </span>
          <span>OMP Desktop</span>
        </div>
        <SessionTabs />
        <div className="runtime-strip" aria-label="Runtime details">
          <span>{settings?.defaultModel ?? "model —"}</span>
          <span>{settings?.defaultThinking ?? "thinking —"}</span>
          <span>ctx —</span>
          <button
            className="topbar-open-folder"
            type="button"
            onClick={() => void openFolder()}
          >
            Open folder
          </button>
          <button type="button" title="Command palette · ⌘K" disabled>
            <kbd>⌘K</kbd>
          </button>
        </div>
      </header>

      <div className="shell-workspace">
        <LeftRail active={activeTargets} onSelect={selectRail} />

        <div className="stage">
          <main
            className="chat"
            id="session-transcript"
            aria-label="Chat transcript"
          >
            <Transcript />
            <Composer />
          </main>

          {pinned.length > 0 && (
            <aside className="pinned-panels" aria-label="Pinned panels">
              {pinned.map((panel) => (
                <section className="pinned-panel" key={panel}>
                  <PanelHeader
                    panel={panel}
                    pinned
                    onPin={() => togglePin(panel)}
                    onClose={() => togglePin(panel)}
                  />
                  <div className="panel-body">
                    <PanelBody panel={panel} />
                  </div>
                </section>
              ))}
            </aside>
          )}

          {drawer && (
            <aside
              className={`drawer drawer--${rightPanels.includes(drawer) ? "right" : "left"}`}
              aria-label={`${panelMeta[drawer].label} drawer`}
            >
              <PanelHeader
                panel={drawer}
                pinned={pinned.includes(drawer)}
                onPin={pinDrawer}
                onClose={closeDrawer}
              />
              <div className="panel-body">
                <PanelBody panel={drawer} />
              </div>
            </aside>
          )}
        </div>

        <RightRail active={activeTargets} onSelect={selectRail} />
      </div>
    </div>
  );
};
