import { open as openShell } from "@tauri-apps/plugin-shell";
import { useEffect, useMemo, useState } from "react";

import { isTauriRuntime } from "../lib/tauri.ts";
import {
  selectActiveSession,
  useSessionStore,
} from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";

export const CompanionPanel = () => {
  const session = useSessionStore(selectActiveSession);
  const companionsMap = useSessionStore((state) => state.companions);
  const activeCompanionId = useSessionStore((state) => state.activeCompanionId);
  const setActiveCompanion = useSessionStore((state) => state.setActiveCompanion);
  const [manualUrl, setManualUrl] = useState("http://localhost:50099");
  const [frameError, setFrameError] = useState<string | null>(null);

  const companions = useMemo(() => {
    if (!session) return [];
    return companionsMap[session.id] ?? [];
  }, [companionsMap, session]);

  const active =
    companions.find((item) => item.id === activeCompanionId) ?? companions[0] ?? null;

  useEffect(() => {
    if (!active && companions[0]) setActiveCompanion(companions[0].id);
  }, [active, companions, setActiveCompanion]);

  if (!session) {
    return <EmptyState>Open a session to attach local companions.</EmptyState>;
  }

  const openExternal = async (url: string) => {
    try {
      if (isTauriRuntime()) await openShell(url);
      else window.open(url, "_blank", "noopener");
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };

  const attachManual = () => {
    const url = manualUrl.trim();
    if (!url) return;
    const id = `${session.id}-${url}`;
    // store via set on companions through a lightweight local merge using launch path:
    useSessionStore.setState((state) => {
      const current = state.companions[session.id] ?? [];
      if (current.some((item) => item.url === url)) {
        return { activeCompanionId: current.find((item) => item.url === url)?.id ?? id };
      }
      const item = {
        id,
        sessionId: session.id,
        url,
        title: url,
        at: Date.now(),
        source: "manual",
      };
      return {
        companions: {
          ...state.companions,
          [session.id]: [item, ...current].slice(0, 20),
        },
        activeCompanionId: id,
      };
    });
  };

  return (
    <div className="companion-panel">
      <div className="companion-panel__toolbar">
        <label className="onboard-field">
          <span>Companion URL</span>
          <div className="ssh-modal__path-row">
            <input
              value={manualUrl}
              spellCheck={false}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder="http://localhost:PORT"
            />
            <button type="button" className="panel-button" onClick={attachManual}>
              Attach
            </button>
          </div>
        </label>
        <div className="companion-panel__tabs" role="tablist" aria-label="Detected companions">
          {companions.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === active?.id}
              className={`companion-tab${item.id === active?.id ? " is-active" : ""}`}
              onClick={() => setActiveCompanion(item.id)}
              title={item.url}
            >
              {item.title}
            </button>
          ))}
        </div>
      </div>

      {!active ? (
        <EmptyState>
          No companion URLs yet. Start a Superpowers brainstorm (or any skill that serves localhost)
          and detected links will appear here. You can also attach a URL manually.
        </EmptyState>
      ) : (
        <div className="companion-panel__frame-wrap">
          <div className="companion-panel__frame-bar">
            <code>{active.url}</code>
            <div className="onboard-actions">
              <button
                type="button"
                className="panel-button"
                onClick={() => void openExternal(active.url)}
              >
                Open external
              </button>
              <button
                type="button"
                className="panel-button"
                onClick={() => {
                  setFrameError(null);
                  // force iframe reload by remount key via state bump
                  setActiveCompanion(null);
                  requestAnimationFrame(() => setActiveCompanion(active.id));
                }}
              >
                Reload
              </button>
            </div>
          </div>
          {frameError ? (
            <p className="panel-feedback panel-feedback--error">{frameError}</p>
          ) : null}
          <iframe
            key={active.id}
            className="companion-panel__frame"
            title={active.title}
            src={active.url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            onError={() =>
              setFrameError(
                "Companion iframe failed to load. Some servers block embedding — use Open external.",
              )
            }
          />
          <p className="onboard-muted">
            Source: {active.source}. If the frame is blank, the companion may send
            X-Frame-Options/CSP frame guards — use Open external.
          </p>
        </div>
      )}
    </div>
  );
};
