import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { api } from "../lib/tauri.ts";
import {
  extractSlashState,
  filterSlashCommands,
  HOST_SLASH_COMMANDS,
  type SlashCommand,
} from "./slash.ts";
import { selectIsActiveStreaming, useSessionStore } from "./session-store.ts";

const EMPTY_COMMANDS: SlashCommand[] = HOST_SLASH_COMMANDS;

export const Composer = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const isStreaming = useSessionStore(selectIsActiveStreaming);
  const send = useSessionStore((state) => state.send);
  const abort = useSessionStore((state) => state.abort);
  const commandsBySession = useSessionStore((state) => state.commandsBySession);
  const loadAvailableCommands = useSessionStore(
    (state) => state.loadAvailableCommands,
  );
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [sending, setSending] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const commands =
    (activeSessionId && commandsBySession[activeSessionId]) || EMPTY_COMMANDS;

  const slashState = useMemo(
    () => extractSlashState(draft, cursor),
    [draft, cursor],
  );
  const slashActive = Boolean(slashOpen && slashState?.active);
  const filtered = useMemo(
    () =>
      slashState?.active
        ? filterSlashCommands(commands, slashState.query)
        : [],
    [commands, slashState],
  );

  useEffect(() => {
    setDraft("");
    setCursor(0);
    setSlashOpen(false);
    setSelectedIndex(0);
  }, [activeSessionId]);

  useEffect(() => {
    if (activeSessionId && !commandsBySession[activeSessionId]) {
      void loadAvailableCommands(activeSessionId);
    }
  }, [activeSessionId, commandsBySession, loadAvailableCommands]);

  useEffect(() => {
    if (!slashState?.active) {
      setSlashOpen(false);
      setSelectedIndex(0);
      return;
    }
    setSlashOpen(true);
    setSelectedIndex(0);
  }, [slashState?.active, slashState?.query, slashState?.start]);

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(filtered.length > 0 ? filtered.length - 1 : 0);
    }
  }, [filtered.length, selectedIndex]);

  useEffect(() => {
    const setComposerText = (event: Event) => {
      const detail = (
        event as CustomEvent<{ sessionId?: string; text?: string }>
      ).detail;
      if (
        detail?.sessionId === useSessionStore.getState().activeSessionId &&
        typeof detail.text === "string"
      ) {
        setDraft(detail.text);
        setCursor(detail.text.length);
      }
    };
    window.addEventListener("omp-desktop:set-composer-text", setComposerText);
    return () =>
      window.removeEventListener(
        "omp-desktop:set-composer-text",
        setComposerText,
      );
  }, []);

  const message = draft.trim();
  const canSend = Boolean(activeSessionId && message && !sending);

  const syncCursor = (el: HTMLTextAreaElement | null = textareaRef.current) => {
    if (!el) return;
    setCursor(el.selectionStart ?? el.value.length);
  };

  const replaceSlashToken = (name: string) => {
    if (!slashState) return;
    const insertion = `/${name} `;
    const next =
      draft.slice(0, slashState.start) +
      insertion +
      draft.slice(cursor);
    const nextCursor = slashState.start + insertion.length;
    setDraft(next);
    setCursor(nextCursor);
    setSlashOpen(false);
    setSelectedIndex(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const runHostCommand = async (command: SlashCommand) => {
    if (!activeSessionId || !slashState) return;
    const sessionId = activeSessionId;
    // Clear the slash token from the draft without sending it as a prompt.
    const next = draft.slice(0, slashState.start) + draft.slice(cursor);
    setDraft(next);
    setCursor(slashState.start);
    setSlashOpen(false);
    setSelectedIndex(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(slashState.start, slashState.start);
    });

    try {
      if (command.name === "compact") {
        await api.compactSession(sessionId);
      } else if (command.name === "export") {
        await api.exportSessionHtml(sessionId);
      }
    } catch (error) {
      const text =
        error instanceof Error ? error.message : String(error);
      useSessionStore.setState({
        error:
          command.name === "compact"
            ? `Unable to compact session: ${text}`
            : `Unable to export session: ${text}`,
      });
    }
  };

  const applySlashCommand = (command: SlashCommand) => {
    if (command.source === "host") {
      void runHostCommand(command);
      return;
    }
    replaceSlashToken(command.name);
  };

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
        setCursor(0);
        setSlashOpen(false);
      }
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (slashActive && filtered.length > 0) {
      applySlashCommand(filtered[selectedIndex] ?? filtered[0]!);
      return;
    }
    void submit(isStreaming ? "followUp" : undefined);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashActive && filtered.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % filtered.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(
          (index) => (index - 1 + filtered.length) % filtered.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applySlashCommand(filtered[selectedIndex] ?? filtered[0]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashOpen(false);
        return;
      }
    } else if (slashActive && event.key === "Escape") {
      event.preventDefault();
      setSlashOpen(false);
      return;
    }

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
    <form
      className="composer"
      aria-label="Message composer"
      onSubmit={handleSubmit}
    >
      <label htmlFor="message">Message OMP</label>
      <div className="composer__input">
        {slashActive && filtered.length > 0 && (
          <ul
            className="slash-popup"
            role="listbox"
            aria-label="Slash commands"
          >
            {filtered.map((command, index) => {
              const selected = index === selectedIndex;
              return (
                <li key={`${command.source ?? "omp"}:${command.name}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={
                      selected
                        ? "slash-popup__item is-selected"
                        : "slash-popup__item"
                    }
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applySlashCommand(command);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <span className="slash-popup__name">/{command.name}</span>
                    {command.description ? (
                      <span className="slash-popup__description">
                        {command.description}
                      </span>
                    ) : null}
                    {command.source === "host" ? (
                      <span className="slash-popup__badge">host</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <textarea
          id="message"
          ref={textareaRef}
          rows={2}
          value={draft}
          placeholder={
            activeSessionId
              ? isStreaming
                ? "Add a follow-up or steer the current run…"
                : "Ask OMP to work in this project…  (/ for commands)"
              : "Open a folder to begin…"
          }
          disabled={!activeSessionId || sending}
          aria-keyshortcuts="Enter Shift+Enter Meta+Enter Control+Enter"
          aria-expanded={slashActive && filtered.length > 0}
          aria-autocomplete="list"
          onChange={(event) => {
            setDraft(event.target.value);
            setCursor(event.target.selectionStart ?? event.target.value.length);
          }}
          onClick={() => syncCursor()}
          onKeyUp={() => syncCursor()}
          onSelect={() => syncCursor()}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="composer__footer">
        <span>
          {isStreaming
            ? "Enter follow-up · ⌘/Ctrl Enter steer · ⇧Enter newline"
            : slashActive
              ? "↑↓ navigate · Tab/Enter insert · Esc close"
              : "Enter send · ⇧Enter newline · / commands"}
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
