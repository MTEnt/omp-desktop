import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";

import { useSessionStore } from "./session-store.ts";

export const Composer = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const isStreaming = useSessionStore((state) =>
    state.activeSessionId ? state.streaming[state.activeSessionId] === true : false,
  );
  const send = useSessionStore((state) => state.send);
  const abort = useSessionStore((state) => state.abort);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [aborting, setAborting] = useState(false);
  const message = draft.trim();
  const canSend = Boolean(activeSessionId && message && !sending);

  useEffect(() => {
    setDraft("");
  }, [activeSessionId]);

  const submit = async (streamingBehavior?: "followUp" | "steer") => {
    if (!canSend) return;
    const sessionAtSend = activeSessionId;
    setSending(true);
    try {
      const sent = await send(message, streamingBehavior);
      if (
        sent &&
        useSessionStore.getState().activeSessionId === sessionAtSend
      ) {
        setDraft("");
      }
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit(isStreaming ? "followUp" : undefined);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    if (!canSend) return;

    if (isStreaming && (event.metaKey || event.ctrlKey)) {
      void submit("steer");
      return;
    }

    void submit(isStreaming ? "followUp" : undefined);
  };

  const handleAbort = async () => {
    setAborting(true);
    try {
      await abort();
    } finally {
      setAborting(false);
    }
  };

  return (
    <form className="composer" aria-label="Message composer" onSubmit={handleSubmit}>
      <label htmlFor="message">Message OMP</label>
      <textarea
        id="message"
        rows={2}
        value={draft}
        placeholder={
          activeSessionId
            ? isStreaming
              ? "Add a follow-up or steer the current run…"
              : "Ask OMP to work in this project…"
            : "Open a folder to begin…"
        }
        disabled={!activeSessionId || sending}
        aria-keyshortcuts="Enter Shift+Enter Meta+Enter Control+Enter"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="composer__footer">
        <span>
          {isStreaming
            ? "Enter follow-up · ⌘/Ctrl Enter steer · ⇧Enter newline"
            : "Enter send · ⇧Enter newline"}
        </span>
        <div className="composer__actions">
          {isStreaming && (
            <button
              className="composer__abort"
              type="button"
              disabled={aborting}
              onClick={() => void handleAbort()}
            >
              {aborting ? "Stopping…" : "Abort"}
            </button>
          )}
          <button className="composer__send" type="submit" disabled={!canSend}>
            {sending ? "Sending…" : isStreaming ? "Follow up" : "Send"}
          </button>
        </div>
      </div>
    </form>
  );
};
