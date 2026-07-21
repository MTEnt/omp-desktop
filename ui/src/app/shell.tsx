import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { useLayoutStore, type PanelId } from "./layout-store.ts";
import { LeftRail, RightRail, type RailTarget } from "./rails.tsx";
import {
  readSessionRuntimeStatus,
  selectActiveRuntimeSnapshot,
  useSessionStore,
} from "../session/session-store.ts";
import { Composer } from "../session/composer.tsx";
import { Transcript } from "../session/transcript.tsx";
import { ActivityPanel } from "../panels/activity-panel.tsx";
import { AttentionPanel } from "../panels/attention-panel.tsx";
import { PlanPanel } from "../panels/plan-panel.tsx";
import { ProjectPanel } from "../panels/project-panel.tsx";
import { SessionsPanel } from "../panels/sessions-panel.tsx";
import { SettingsPanel } from "../panels/settings-panel.tsx";
import { SubagentsPanel } from "../panels/subagents-panel.tsx";
import { JobsPanel } from "../panels/jobs-panel.tsx";
import { MemoryPanel } from "../panels/memory-panel.tsx";
import { ScratchpadPanel } from "../panels/scratchpad-panel.tsx";
import { BrowserPanel } from "../panels/browser-panel.tsx";
import { CompanionPanel } from "../panels/companion-panel.tsx";
import { LaunchPanel } from "../panels/launch-panel.tsx";
import { CommandPalette } from "./palette.tsx";
import { PixelPieLogo } from "./pixel-pie-logo.tsx";
import { RoleModelStrip } from "./role-model-picker.tsx";
import { OnboardingWalkthrough } from "./onboarding-walkthrough.tsx";
import { SshConnectModal } from "./ssh-connect-modal.tsx";
import { TaskProgressStrip } from "./task-progress-strip.tsx";
import { ExtensionUiDialog } from "./extension-ui-dialog.tsx";

const TerminalPanel = lazy(async () => ({
  default: (await import("../panels/terminal-panel.tsx")).TerminalPanel,
}));

const panelMeta: Record<PanelId, { label: string; eyebrow: string }> = {
  sessions: { label: "Sessions", eyebrow: "Workspace" },
  project: { label: "Project", eyebrow: "Context" },
  settings: { label: "Settings", eyebrow: "Preferences" },
  terminal: { label: "Terminal", eyebrow: "Shell" },
  plan: { label: "Plan", eyebrow: "Execution" },
  activity: { label: "Activity", eyebrow: "Timeline" },
  attention: { label: "Attention", eyebrow: "Inbox" },
  subagents: { label: "Subagents", eyebrow: "Delegation" },
  jobs: { label: "Job board", eyebrow: "Persistent work" },
  memory: { label: "Role memory", eyebrow: "Long-term" },
  scratchpad: { label: "Scratchpad", eyebrow: "Working notes" },
  launch: { label: "Launch", eyebrow: "Recipes & skills" },
  browser: { label: "Browser", eyebrow: "Headless / headed" },
  companion: { label: "Companion", eyebrow: "Local servers" },
};

const rightPanels: PanelId[] = ["plan", "activity", "attention", "subagents", "jobs", "memory", "scratchpad", "launch", "browser", "companion"];


const SessionSidebar = () => {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const streaming = useSessionStore((state) => state.streaming);
  const setActive = useSessionStore((state) => state.setActive);
  const closeSession = useSessionStore((state) => state.closeSession);

  const openFolder = useSessionStore((state) => state.openFolder);

  return (
    <aside className="session-sidebar" aria-label="Sessions">
      <div className="session-sidebar__header">
        <span>Sessions</span>
        <div className="session-sidebar__actions">
          <button
            type="button"
            className="session-sidebar__new"
            onClick={() => void openFolder()}
            title="Open folder"
          >
            +
          </button>
          <button
            type="button"
            className="session-sidebar__collapse"
            onClick={() => useLayoutStore.getState().setSessionsSidebarOpen(false)}
            title="Hide sessions"
            aria-label="Hide sessions sidebar"
          >
            «
          </button>
        </div>
      </div>
      {sessions.length > 0 ? (
        <div className="session-sidebar__list" role="tablist">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isStreaming = streaming[session.id] === true;
            return (
              <div
                className={`session-side-item${isActive ? " is-active" : ""}`}
                key={session.id}
              >
                <button
                  type="button"
                  className="session-side-item__select"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="session-transcript"
                  title={`${session.title} — ${session.cwd}`}
                  onClick={() => setActive(session.id)}
                >
                  {isStreaming && (
                    <span
                      className="session-side-item__streaming"
                      title="Streaming"
                      aria-label="Streaming"
                    />
                  )}
                  <span className="session-side-item__title">{session.title}</span>
                  <span className="session-side-item__cwd">{session.cwd}</span>
                </button>
                <button
                  type="button"
                  className="session-side-item__close"
                  title={`Close ${session.title}`}
                  aria-label={`Close ${session.title}`}
                  onClick={() => void closeSession(session.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="session-sidebar__empty">
          <p>No sessions yet.</p>
          <button type="button" onClick={() => void openFolder()}>
            Open folder
          </button>
        </div>
      )}
    </aside>
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
    case "attention":
      return <AttentionPanel />;
    case "subagents":
      return <SubagentsPanel />;
    case "jobs":
      return <JobsPanel />;
    case "memory":
      return <MemoryPanel />;
    case "scratchpad":
      return <ScratchpadPanel />;
    case "terminal":
      return (
        <Suspense fallback={<div className="empty-state" role="status">Loading terminal…</div>}>
          <TerminalPanel />
        </Suspense>
      );
    case "launch":
      return <LaunchPanel />;
    case "browser":
      return <BrowserPanel />;
    case "companion":
      return <CompanionPanel />;
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
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const runtimeSnapshot = useSessionStore(selectActiveRuntimeSnapshot);
  const refreshState = useSessionStore((state) => state.refreshState);
  const openFolder = useSessionStore((state) => state.openFolder);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sshOpen, setSshOpen] = useState(false);
  const activeRemote = useSessionStore((state) => {
    const id = state.activeSessionId;
    if (!id) return null;
    return state.sessions.find((session) => session.id === id)?.remote ?? null;
  });
  const runtimeStatus = useMemo(
    () => readSessionRuntimeStatus(runtimeSnapshot),
    [runtimeSnapshot],
  );
  const activeTargets: RailTarget[] = [
    ...(drawer ? [drawer] : ["chat" as const]),
    ...pinned,
  ];

  useEffect(() => {
    const openSsh = () => setSshOpen(true);
    window.addEventListener("omp-desktop:open-ssh", openSsh);
    return () => window.removeEventListener("omp-desktop:open-ssh", openSsh);
  }, []);

  useEffect(() => {
    const openDrawer = useLayoutStore.getState().openDrawer;
    const onOpenPanel = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (!detail) return;
      if (detail === "sessions") {
        useLayoutStore.getState().setSessionsSidebarOpen(true);
        return;
      }
      openDrawer(detail as import("./layout-store.ts").PanelId);
    };
    window.addEventListener("omp-desktop:open-panel", onOpenPanel);
    return () => window.removeEventListener("omp-desktop:open-panel", onOpenPanel);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (event.repeat) return;
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    void refreshState(activeSessionId);
    const refreshTimer = window.setInterval(
      () => void refreshState(activeSessionId),
      20_000,
    );
    return () => window.clearInterval(refreshTimer);
  }, [activeSessionId, refreshState]);

  const sessionsSidebarOpen = useLayoutStore((state) => state.sessionsSidebarOpen);
  const toggleSessionsSidebar = useLayoutStore((state) => state.toggleSessionsSidebar);

  const selectRail = (target: RailTarget) => {
    if (target === "chat") {
      closeDrawer();
      return;
    }
    if (target === "sessions") {
      // Sessions live in a collapsible sidebar, not a chat-covering drawer.
      closeDrawer();
      toggleSessionsSidebar();
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
          <PixelPieLogo size={26} className="brand__pie" />
          <div className="brand__copy">
            <span className="brand__name">OMP Desktop</span>
            <span className="brand__tag">Oh My Pi</span>
          </div>
        </div>
        <div className="runtime-strip" aria-label="Active session status">
          <RoleModelStrip />
          <span
            className="runtime-meta"
            title={runtimeStatus.thinkingLevel ?? "Thinking level unavailable"}
          >
            think {runtimeStatus.thinkingLevel ?? "—"}
          </span>
          <span
            className="runtime-meta"
            title={
              runtimeStatus.contextPercent === null
                ? "Context usage unavailable"
                : `${runtimeStatus.contextPercent}% context used`
            }
          >
            ctx{" "}
            {runtimeStatus.contextPercent === null
              ? "—"
              : `${Math.round(runtimeStatus.contextPercent)}%`}
          </span>
          <button
            className="topbar-open-folder"
            type="button"
            onClick={() => void openFolder()}
          >
            Open folder
          </button>
          <button
            className="topbar-open-folder"
            type="button"
            title="Connect via SSH"
            onClick={() => setSshOpen(true)}
          >
            SSH
          </button>
          {activeRemote ? (
            <span
              className="remote-status-chip"
              title={`Remote session · ${activeRemote.label}`}
            >
              <span className="remote-status-chip__dot" aria-hidden />
              SSH · {activeRemote.label}
            </span>
          ) : null}
          <button
            type="button"
            title="Command palette · ⌘K"
            aria-label="Open command palette"
            aria-keyshortcuts="Meta+K Control+K"
            onClick={() => setPaletteOpen(true)}
          >
            <kbd>⌘K</kbd>
          </button>
        </div>
      </header>

      <div
        className={`shell-workspace${sessionsSidebarOpen ? " has-sessions" : ""}`}
      >
        <LeftRail
          active={[
            ...activeTargets,
            ...(sessionsSidebarOpen ? (["sessions"] as const) : []),
          ]}
          onSelect={selectRail}
        />
        {sessionsSidebarOpen ? <SessionSidebar /> : null}

        <div className="stage">
          <main
            className="chat"
            id="session-transcript"
            aria-label="Chat transcript"
          >
            <TaskProgressStrip />
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
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <OnboardingWalkthrough />
      <SshConnectModal open={sshOpen} onClose={() => setSshOpen(false)} />
      <ExtensionUiDialog />
    </div>
  );
};
