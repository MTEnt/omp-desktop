import { useMemo, useState } from "react";

import {
  LAUNCH_RECIPES,
  selectActiveSession,
  useSessionStore,
} from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";

export const BrowserPanel = () => {
  const session = useSessionStore(selectActiveSession);
  const artifactsMap = useSessionStore((state) => state.browserArtifacts);
  const launchBrowser = useSessionStore((state) => state.launchBrowser);
  const launchRecipe = useSessionStore((state) => state.launchRecipe);
  const clearBrowserArtifacts = useSessionStore((state) => state.clearBrowserArtifacts);
  const [url, setUrl] = useState("http://localhost:5173");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const artifacts = useMemo(() => {
    if (!session) return [];
    return artifactsMap[session.id] ?? [];
  }, [artifactsMap, session]);

  if (!session) {
    return <EmptyState>Open a session to launch browser workflows.</EmptyState>;
  }

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    setError(null);
    try {
      const ok = await fn();
      if (!ok) setError("Launch failed — check the session error banner.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="browser-panel">
      <div className="browser-panel__launch">
        <label className="onboard-field">
          <span>URL</span>
          <input
            value={url}
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </label>
        <div className="onboard-actions">
          <button
            type="button"
            className="panel-button panel-button--primary"
            disabled={busy || !url.trim()}
            onClick={() => void run(() => launchBrowser(url.trim(), false))}
          >
            Headless open
          </button>
          <button
            type="button"
            className="panel-button"
            disabled={busy || !url.trim()}
            onClick={() => void run(() => launchBrowser(url.trim(), true))}
          >
            Visible open
          </button>
          <button
            type="button"
            className="panel-button"
            disabled={busy || !url.trim()}
            onClick={() =>
              void run(() =>
                launchRecipe(
                  LAUNCH_RECIPES.find((r) => r.id === "browser-qa")!,
                  { url: url.trim(), topic: "primary happy path" },
                ),
              )
            }
          >
            QA pass
          </button>
          <button
            type="button"
            className="panel-button"
            disabled={!artifacts.length}
            onClick={() => clearBrowserArtifacts(session.id)}
          >
            Clear
          </button>
        </div>
        {error ? <p className="panel-feedback panel-feedback--error">{error}</p> : null}
        <p className="onboard-muted">
          Uses the OMP <code>browser</code> tool inside this session. Screenshots and open events
          appear below as the agent works.
        </p>
      </div>

      <div className="browser-panel__gallery" aria-label="Browser artifacts">
        {artifacts.length === 0 ? (
          <EmptyState>No browser artifacts yet. Launch a browser recipe to populate this panel.</EmptyState>
        ) : (
          artifacts.map((item) => (
            <article key={item.id} className="browser-card">
              <header>
                <strong>{item.tabName ?? item.action ?? "browser"}</strong>
                <span>{new Date(item.at).toLocaleTimeString()}</span>
              </header>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.url}
                </a>
              ) : null}
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.note ?? "Browser screenshot"} />
              ) : (
                <p className="onboard-muted">{item.note ?? "Event captured (no image)"}</p>
              )}
            </article>
          ))
        )}
      </div>
    </div>
  );
};
