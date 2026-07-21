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

const detailText = (request: ExtensionUiRequest) => {
  if (request.method === "select" && request.title) return request.title;
  return (
    request.message ??
    request.instructions ??
    request.title ??
    "Respond to continue the session."
  );
};

const softTitle = (request: ExtensionUiRequest) => {
  if (request.method === "confirm") return request.title ?? "Confirm action";
  if (request.method === "select") {
    const detail = request.title ?? "";
    const tool = detail.match(/Allow tool:\s*(\S+)/i)?.[1];
    if (tool) return `Allow ${tool}`;
    return "Choose an option";
  }
  return request.title ?? "OMP needs input";
};

export const ExtensionUiDialog = () => {
  const requests = useSessionStore((state) => state.extensionUiRequests);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const sessions = useSessionStore((state) => state.sessions);
  const setActive = useSessionStore((state) => state.setActive);
  const respond = useSessionStore((state) => state.respondExtensionUi);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const dockRef = useRef<HTMLElement>(null);

  const pending = useMemo(() => {
    const active = activeSessionId ? requests[activeSessionId]?.[0] : undefined;
    if (active && activeSessionId) {
      return { sessionId: activeSessionId, request: active, foreign: false };
    }
    for (const [sessionId, queued] of Object.entries(requests)) {
      if (queued[0]) {
        return { sessionId, request: queued[0], foreign: true };
      }
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
    if (!pending || pending.foreign) return;
    const frame = requestAnimationFrame(() => {
      const preferred =
        requestMethod === "input" || requestMethod === "editor"
          ? dockRef.current?.querySelector<HTMLElement>("textarea, input")
          : dockRef.current?.querySelector<HTMLElement>("[data-safe-default]");
      const fallback = dockRef.current?.querySelector<HTMLElement>(
        "textarea, input, button:not([disabled])",
      );
      (preferred ?? fallback)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [requestId, pendingSessionId, requestMethod, requestPrefill, pending]);

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

  useEffect(() => {
    if (!pending || pending.foreign) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT") &&
        dockRef.current?.contains(target)
      ) {
        return;
      }
      event.preventDefault();
      void respond(pending.sessionId, pending.request.id, denialResponse(pending.request));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, respond]);

  if (!pending) return null;

  const { sessionId, request, foreign } = pending;
  const session = sessions.find((candidate) => candidate.id === sessionId);
  const queuedCount = Object.values(requests).reduce(
    (total, queued) => total + queued.length,
    0,
  );
  const isTextEntry = request.method === "input" || request.method === "editor";
  const detail = detailText(request);

  const submit = async (response: ExtensionUiResponse) => {
    if (busy) return;
    setBusy(true);
    const answered = await respond(sessionId, request.id, response);
    if (!answered) setBusy(false);
  };

  const handleDockKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void submit(denialResponse(request));
    }
  };

  if (foreign) {
    return (
      <div className="approval-dock approval-dock--foreign" role="status">
        <span className="approval-dock__pulse" aria-hidden="true" />
        <div className="approval-dock__copy">
          <span className="approval-dock__eyebrow">Paused elsewhere</span>
          <p>
            <strong>{session?.title ?? "Another session"}</strong> is waiting
            for approval.
          </p>
        </div>
        <button
          type="button"
          className="approval-dock__switch"
          onClick={() => setActive(sessionId)}
        >
          Switch
        </button>
      </div>
    );
  }

  return (
    <section
      ref={dockRef}
      className={`approval-dock${isTextEntry ? " approval-dock--entry" : ""}`}
      role="region"
      aria-labelledby="approval-dock-title"
      aria-describedby="approval-dock-detail"
      onKeyDown={handleDockKeyDown}
    >
      <header className="approval-dock__header">
        <span className="approval-dock__pulse" aria-hidden="true" />
        <div className="approval-dock__copy">
          <span className="approval-dock__eyebrow">
            Needs approval · {session?.title ?? "session"}
            {queuedCount > 1 ? ` · ${queuedCount} queued` : ""}
          </span>
          <h2 id="approval-dock-title">{softTitle(request)}</h2>
        </div>
      </header>

      <pre id="approval-dock-detail" className="approval-dock__detail">
        {detail}
      </pre>

      {isTextEntry ? (
        <form
          className="approval-dock__entry"
          onSubmit={(event) => {
            event.preventDefault();
            void submit({ value });
          }}
        >
          <label htmlFor="approval-dock-value">
            {request.placeholder ?? "Response"}
          </label>
          <textarea
            id="approval-dock-value"
            rows={request.method === "editor" ? 8 : 3}
            value={value}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="approval-dock__actions">
            <button
              type="button"
              className="approval-dock__btn"
              data-safe-default
              disabled={busy}
              onClick={() => void submit({ cancelled: true })}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="approval-dock__btn approval-dock__btn--allow"
              disabled={busy}
            >
              {busy ? "Sending…" : "Continue"}
            </button>
          </div>
        </form>
      ) : request.method === "confirm" ? (
        <div className="approval-dock__actions">
          <button
            type="button"
            className="approval-dock__btn"
            data-safe-default
            disabled={busy}
            onClick={() => void submit({ confirmed: false })}
          >
            Deny
          </button>
          <button
            type="button"
            className="approval-dock__btn approval-dock__btn--allow"
            disabled={busy}
            onClick={() => void submit({ confirmed: true })}
          >
            {busy ? "Sending…" : "Approve"}
          </button>
        </div>
      ) : (
        <div className="approval-dock__actions">
          {(request.options?.length ?? 0) === 0 ? (
            <button
              type="button"
              data-safe-default
              disabled={busy}
              className="approval-dock__btn"
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
                className={`approval-dock__btn${positive ? " approval-dock__btn--allow" : ""}${deny ? " approval-dock__btn--deny" : ""}`}
                onClick={() => void submit({ value: option })}
              >
                {busy ? "Sending…" : option}
              </button>
            );
          })}
        </div>
      )}

      <footer className="approval-dock__footer">
        <span>Esc denies · session paused until answered</span>
        {request.timeout ? (
          <span>Auto-cancels in {Math.ceil(request.timeout / 1000)}s</span>
        ) : null}
      </footer>
    </section>
  );
};
