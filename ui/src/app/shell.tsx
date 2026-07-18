import { useLayoutStore, type PanelId } from "./layout-store.ts";
import { LeftRail, RightRail, type RailTarget } from "./rails.tsx";
import { useSessionStore } from "../session/session-store.ts";
import { Composer } from "../session/composer.tsx";
import { Transcript } from "../session/transcript.tsx";
import { ActivityPanel } from "../panels/activity-panel.tsx";
import { PlanPanel } from "../panels/plan-panel.tsx";
import { ProjectPanel } from "../panels/project-panel.tsx";
import { SessionsPanel } from "../panels/sessions-panel.tsx";
import { SettingsPanel } from "../panels/settings-panel.tsx";
import { SubagentsPanel } from "../panels/subagents-panel.tsx";
import { TerminalPanel } from "../panels/terminal-panel.tsx";

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
  switch (panel) {
    case "sessions":
      return <SessionsPanel />;
    case "project":
      return <ProjectPanel />;
    case "settings":
      return <SettingsPanel />;
    case "plan":
      return <PlanPanel />;
    case "activity":
      return <ActivityPanel />;
    case "subagents":
      return <SubagentsPanel />;
    case "terminal":
      return <TerminalPanel />;
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
                  <div
                    className={`panel-body${panel === "terminal" ? " panel-body--terminal" : ""}`}
                  >
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
              <div
                className={`panel-body${drawer === "terminal" ? " panel-body--terminal" : ""}`}
              >
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
