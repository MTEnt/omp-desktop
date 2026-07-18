import { useEffect, useMemo, useRef, useState } from "react";

import { useLayoutStore } from "../app/layout-store.ts";
import { MarkdownBody } from "./markdown.tsx";
import {
  selectActiveSession,
  selectActiveTranscript,
  selectIsActiveStreaming,
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

const ThinkingBlock = ({
  thinking,
  streaming,
}: {
  thinking: string;
  streaming?: boolean;
}) => {
  const preview = useMemo(() => {
    const compact = thinking.replace(/\s+/g, " ").trim();
    if (compact.length <= 96) return compact;
    return `${compact.slice(0, 96)}…`;
  }, [thinking]);

  return (
    <details className="assistant-thinking">
      <summary>
        <span className="assistant-thinking__title">
          {streaming ? "Thinking…" : "Thinking"}
        </span>
        <span className="assistant-thinking__preview">{preview}</span>
        <span className="assistant-thinking__hint">expand</span>
      </summary>
      <div className="assistant-thinking__body">
        <MarkdownBody content={thinking} className="md-body--thinking" />
      </div>
    </details>
  );
};

const TranscriptEntry = ({
  item,
  streaming,
}: {
  item: TranscriptItem;
  streaming?: boolean;
}) => {
  switch (item.kind) {
    case "user":
      return (
        <article className="transcript-item transcript-item--user">
          <header>
            <span>You</span>
          </header>
          <p className="user-message-text">{item.text}</p>
        </article>
      );

    case "assistant":
      return (
        <article className="transcript-item transcript-item--assistant">
          <header>
            <span>OMP</span>
          </header>
          {item.thinking ? (
            <ThinkingBlock thinking={item.thinking} streaming={streaming && !item.text} />
          ) : null}
          {item.text ? (
            <MarkdownBody content={item.text} className="md-body--assistant" />
          ) : streaming && !item.thinking ? (
            <p className="assistant-pending">OMP is responding…</p>
          ) : null}
        </article>
      );

    case "tool":
      return (
        <section className={`tool-card tool-card--${item.status}`}>
          <header>
            <span className="tool-card__mark" aria-hidden="true">
              ›_
            </span>
            <strong>{item.name}</strong>
            <span className="tool-card__status">{item.status}</span>
          </header>
          {item.detail ? <pre>{item.detail}</pre> : null}
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
  const isStreaming = useSessionStore(selectIsActiveStreaming);
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
  }, [activeSessionId, items, isStreaming]);

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
  const lastAssistantId =
    [...items].reverse().find((item) => item.kind === "assistant")?.id ?? null;

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
            Message OMP below. Thinking stays collapsed; replies render as
            markdown so code and lists stay readable.
          </p>
        </div>
      ) : (
        <div className="transcript__items">
          {items.map((item) => (
            <TranscriptEntry
              item={item}
              key={`${item.kind}-${item.id}`}
              streaming={
                isStreaming &&
                item.kind === "assistant" &&
                item.id === lastAssistantId
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};
