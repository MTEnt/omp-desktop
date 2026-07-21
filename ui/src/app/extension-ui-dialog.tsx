import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { useSessionStore } from "../session/session-store.ts";
import type {
  ExtensionUiRequest,
  ExtensionUiResponse,
} from "../session/types.ts";

const denialResponse = (
  request: ExtensionUiRequest,
): ExtensionUiResponse => {
  if (request.method === "confirm") return { confirmed: false };
  const denyOption = request.options?.find((option) =>
    /^(deny|no|reject|block)$/i.test(option.trim()),
  );
  return denyOption ? { value: denyOption } : { cancelled: true };
};

export const ExtensionUiDialog = () => {
  const requests = useSessionStore((state) => state.extensionUiRequests);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const sessions = useSessionStore((state) => state.sessions);
  const respond = useSessionStore((state) => state.respondExtensionUi);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  const pending = useMemo(() => {
    const active = activeSessionId ? requests[activeSessionId]?.[0] : undefined;
    if (active && activeSessionId) {
      return { sessionId: activeSessionId, request: active };
    }
    for (const [sessionId, queued] of Object.entries(requests)) {
      if (queued[0]) return { sessionId, request: queued[0] };
    }
    return null;
  }, [activeSessionId, requests]);

  const requestId = pending?.request.id;
  const pendingSessionId = pending?.sessionId;
  const requestMethod = pending?.request.method;
  const requestPrefill = pending?.request.prefill;
  const requestTimeout = pending?.request.timeout;
  useEffect(() => {
    setValue(requestPrefill ?? "");
    setBusy(false);
    const frame = requestAnimationFrame(() => {
      const preferred =
        requestMethod === "input" || requestMethod === "editor"
          ? dialogRef.current?.querySelector<HTMLElement>("textarea, input")
          : dialogRef.current?.querySelector<HTMLElement>(
              "[data-safe-default]",
            );
      const fallback = dialogRef.current?.querySelector<HTMLElement>(
        "textarea, input, button:not([disabled])",
      );
      (preferred ?? fallback)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [requestId, pendingSessionId, requestMethod, requestPrefill]);

  useEffect(() => {
    if (!pendingSessionId || !requestId || !requestTimeout || requestTimeout <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      void respond(pendingSessionId, requestId, {
        cancelled: true,
        timedOut: true,
      });
    }, requestTimeout);
    return () => window.clearTimeout(timer);
  }, [pendingSessionId, requestId, requestTimeout, respond]);

  if (!pending) return null;

  const { sessionId, request } = pending;
  const session = sessions.find((candidate) => candidate.id === sessionId);
  const queuedCount = Object.values(requests).reduce(
    (total, queued) => total + queued.length,
    0,
  );
  const isTextEntry = request.method === "input" || request.method === "editor";

  const submit = async (response: ExtensionUiResponse) => {
    if (busy) return;
    setBusy(true);
    const answered = await respond(sessionId, request.id, response);
    if (!answered) setBusy(false);
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void submit(denialResponse(request));
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "textarea, input, button:not([disabled])",
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="onboard approval-dialog">
      <div className="onboard__backdrop" aria-hidden="true" />
      <section
        ref={dialogRef}
        className="onboard__card approval-dialog__card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="extension-dialog-title"
        aria-describedby="extension-dialog-detail"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="approval-dialog__header">
          <div className="approval-dialog__gate" aria-hidden="true">
            <span />
          </div>
          <div>
            <span className="onboard__eyebrow">
              OMP request · {session?.title ?? "session"}
            </span>
            <h1 id="extension-dialog-title">
              {request.method === "select" ? "Action required" : request.title ?? "OMP needs input"}
            </h1>
          </div>
          {queuedCount > 1 ? (
            <span className="approval-dialog__queue">{queuedCount} queued</span>
          ) : null}
        </header>

        {request.method === "select" && request.title ? (
          <pre id="extension-dialog-detail" className="approval-dialog__prompt">
            {request.title}
          </pre>
        ) : (
          <p id="extension-dialog-detail" className="approval-dialog__message">
            {request.message ?? request.instructions ?? "Respond to continue the OMP session."}
          </p>
        )}

        {isTextEntry ? (
          <form
            className="approval-dialog__entry"
            onSubmit={(event) => {
              event.preventDefault();
              void submit({ value });
            }}
          >
            <label htmlFor="extension-dialog-value">
              {request.placeholder ?? "Response"}
            </label>
            <textarea
              id="extension-dialog-value"
              rows={request.method === "editor" ? 10 : 3}
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
            <div className="approval-dialog__actions">
              <button
                type="button"
                className="approval-dialog__option approval-dialog__option--deny"
                data-safe-default
                disabled={busy}
                onClick={() => void submit({ cancelled: true })}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="approval-dialog__option approval-dialog__option--positive"
                disabled={busy}
              >
                {busy ? "Sending…" : "Continue"}
              </button>
            </div>
          </form>
        ) : request.method === "confirm" ? (
          <div className="approval-dialog__actions">
            <button
              type="button"
              className="approval-dialog__option approval-dialog__option--deny"
              data-safe-default
              disabled={busy}
              onClick={() => void submit({ confirmed: false })}
            >
              Deny
            </button>
            <button
              type="button"
              className="approval-dialog__option approval-dialog__option--positive"
              disabled={busy}
              onClick={() => void submit({ confirmed: true })}
            >
              {busy ? "Sending…" : "Approve"}
            </button>
          </div>
        ) : (
          <div className="approval-dialog__options">
            {(request.options?.length ?? 0) === 0 ? (
              <button
                type="button"
                data-safe-default
                disabled={busy}
                className="approval-dialog__option approval-dialog__option--deny"
                onClick={() => void submit({ cancelled: true })}
              >
                Cancel
              </button>
            ) : null}
            {(request.options ?? []).map((option) => {
              const positive = /^(approve|yes|allow|continue)$/i.test(option.trim());
              const deny = /^(deny|no|reject|block)$/i.test(option.trim());
              return (
                <button
                  type="button"
                  key={option}
                  disabled={busy}
                  data-safe-default={deny || undefined}
                  className={`approval-dialog__option${positive ? " approval-dialog__option--positive" : ""}${deny ? " approval-dialog__option--deny" : ""}`}
                  onClick={() => void submit({ value: option })}
                >
                  {busy ? "Sending…" : option}
                </button>
              );
            })}
          </div>
        )}

        <footer className="approval-dialog__footer">
          <span>Esc cancels or denies · session remains paused until answered</span>
          {request.timeout ? (
            <span>Auto-cancels in {Math.ceil(request.timeout / 1000)}s</span>
          ) : null}
        </footer>
      </section>
    </div>
  );
};
