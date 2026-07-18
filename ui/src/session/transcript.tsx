import { useEffect, useRef, useState } from "react";

import { useLayoutStore } from "../app/layout-store.ts";
import {
  selectActiveSession,
  selectActiveTranscript,
  useSessionStore,
} from "./session-store.ts";
import type { TranscriptItem } from "./types.ts";

const EmptyGlyph = () => (
  <div className="transcript-empty__glyph" aria-hidden="true">
    <span />
    <span />
    <span />
  </div>
);

const TranscriptEntry = ({ item }: { item: TranscriptItem }) => {
  switch (item.kind) {
    case "user":
      return (
        <article className="transcript-item transcript-item--user">
          <header>
            <span>You</span>
          </header>
          <p>{item.text}</p>
        </article>
      );

    case "assistant":
      return (
        <article className="transcript-item transcript-item--assistant">
          <header>
            <span>OMP</span>
          </header>
          {item.thinking && (
            <details className="assistant-thinking">
              <summary>Thinking</summary>
              <p>{item.thinking}</p>
            </details>
          )}
          <p>{item.text}</p>
        </article>
      );

    case "tool":
      return (
        <section className={`tool-card tool-card--${item.status}`}>
          <header>
            <span className="tool-card__mark" aria-hidden="true">›_</span>
            <strong>{item.name}</strong>
            <span className="tool-card__status">{item.status}</span>
          </header>
          {item.detail && <pre>{item.detail}</pre>}
        </section>
      );

    case "system":
      return (
        <div className="system-message" role="status">
          <span aria-hidden="true">!</span>
          <p>{item.text}</p>
        </div>
      );
  }
};

export const Transcript = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const activeSession = useSessionStore(selectActiveSession) ?? null;
  const items = useSessionStore(selectActiveTranscript);
  const error = useSessionStore((state) => state.error);
  const openFolder = useSessionStore((state) => state.openFolder);
  const restartSession = useSessionStore((state) => state.restartSession);
  const clearError = useSessionStore((state) => state.clearError);
  const openSettings = () => {
    useLayoutStore.getState().openDrawer("settings");
  };
  const viewportRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);
  const [opening, setOpening] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    followOutputRef.current = true;
  }, [activeSessionId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !followOutputRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [activeSessionId, items]);

  const chooseFolder = async () => {
    setOpening(true);
    try {
      await openFolder();
    } finally {
      setOpening(false);
    }
  };

  const handleRestart = async () => {
    if (!activeSessionId) return;
    setRestarting(true);
    try {
      await restartSession(activeSessionId);
    } finally {
      setRestarting(false);
    }
  };

  const updateFollowOutput = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distance =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    followOutputRef.current = distance < 80;
  };

  const ompMissing =
    typeof error === "string" &&
    error.toLowerCase().includes("omp") &&
    (error.toLowerCase().includes("not found") ||
      error.toLowerCase().includes("path") ||
      error.toLowerCase().includes("binary"));

  const sessionExited = activeSession?.status === "exited";

  return (
    <div
      className="transcript"
      ref={viewportRef}
      onScroll={updateFollowOutput}
      aria-live="polite"
    >
      {error && (
        <div className="transcript-error" role="alert">
          <div className="transcript-error__copy">{error}</div>
          <div className="transcript-error__actions">
            {ompMissing && (
              <button type="button" onClick={openSettings}>
                Open Settings
              </button>
            )}
            {sessionExited && activeSessionId && (
              <button
                type="button"
                disabled={restarting}
                onClick={() => void handleRestart()}
              >
                {restarting ? "Restarting…" : "Restart session"}
              </button>
            )}
            <button type="button" onClick={() => clearError()}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {!activeSessionId ? (
        <div className="transcript-empty">
          <EmptyGlyph />
          <span className="eyebrow">Oh My Pi · desktop cockpit</span>
          <h1>
            Open a folder.
            <br />
            Talk to OMP.
          </h1>
          <p>
            OMP Desktop hosts real <code>omp --mode rpc</code> sessions with a
            Zen cockpit for plans, tools, subagents, and a local terminal.
            Requires <code>omp</code> on PATH (v17+).
          </p>
          <button
            className="open-folder-cta"
            type="button"
            disabled={opening}
            onClick={() => void chooseFolder()}
          >
            {opening ? "Opening…" : "Open folder"}
          </button>
        </div>
      ) : sessionExited && items.length === 0 ? (
        <div className="transcript-empty transcript-empty--ready">
          <EmptyGlyph />
          <span className="eyebrow">Session exited</span>
          <h1>The OMP process stopped.</h1>
          <p>Restart to spawn a fresh RPC session in the same folder.</p>
          <button
            className="open-folder-cta"
            type="button"
            disabled={restarting}
            onClick={() => void handleRestart()}
          >
            {restarting ? "Restarting…" : "Restart session"}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="transcript-empty transcript-empty--ready">
          <EmptyGlyph />
          <span className="eyebrow">OMP is ready</span>
          <h1>What should OMP build?</h1>
          <p>
            Message OMP below. Thinking, tool calls, and streamed replies stay
            together in this transcript.
          </p>
        </div>
      ) : (
        <div className="transcript__items">
          {items.map((item) => (
            <TranscriptEntry item={item} key={`${item.kind}-${item.id}`} />
          ))}
        </div>
      )}
    </div>
  );
};
