import { useEffect, useRef, useState } from "react";

import { useSessionStore } from "./session-store.ts";
import type { TranscriptItem } from "./types.ts";

const EMPTY_TRANSCRIPT: TranscriptItem[] = [];

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
  const items = useSessionStore((state) =>
    state.activeSessionId
      ? (state.transcripts[state.activeSessionId] ?? EMPTY_TRANSCRIPT)
      : EMPTY_TRANSCRIPT,
  );
  const error = useSessionStore((state) => state.error);
  const openFolder = useSessionStore((state) => state.openFolder);
  const viewportRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    followOutputRef.current = true;
  }, [activeSessionId]);

  useEffect(() => {
    if (!followOutputRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const frame = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSessionId, items]);

  const chooseFolder = async () => {
    setOpening(true);
    try {
      await openFolder();
    } finally {
      setOpening(false);
    }
  };

  const updateFollowOutput = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const remaining =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    followOutputRef.current = remaining < 96;
  };

  return (
    <div
      className="transcript"
      ref={viewportRef}
      onScroll={updateFollowOutput}
      aria-live="polite"
    >
      {error && (
        <div className="transcript-error" role="alert">
          {error}
        </div>
      )}

      {!activeSessionId ? (
        <div className="transcript-empty">
          <EmptyGlyph />
          <span className="eyebrow">Local context first</span>
          <h1>Open a folder.<br />Start the conversation.</h1>
          <p>
            OMP runs in the project you choose and streams its work back into
            this transcript.
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
      ) : items.length === 0 ? (
        <div className="transcript-empty transcript-empty--ready">
          <EmptyGlyph />
          <span className="eyebrow">Session ready</span>
          <h1>What are we building?</h1>
          <p>
            Message OMP below. Tool calls and streamed responses will stay
            together here.
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
