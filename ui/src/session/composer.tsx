import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { api, isTauriRuntime, openFilesDialog } from "../lib/tauri.ts";
import {
  MAX_COMPOSER_IMAGES,
  formatByteLen,
  isImageFile,
  nextAttachmentId,
  readFileAsBase64,
  takeImageFiles,
  type ComposerAttachment,
} from "./image-attach.ts";
import {
  addPathChip,
  mergeMessageWithPaths,
  resolveDroppedFilePath,
} from "./path-chips.ts";
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
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [pathChips, setPathChips] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);

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
    setAttachments((prev) => {
      for (const item of prev) {
        if (item.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
      return [];
    });
    setPathChips([]);
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
  const canSend = Boolean(
    activeSessionId &&
      (message || attachments.length > 0 || pathChips.length > 0) &&
      !sending,
  );

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

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    const remaining = MAX_COMPOSER_IMAGES - attachments.length;
    const chosen = takeImageFiles(files, remaining);
    if (!chosen.length) {
      if (files.length > 0 && remaining <= 0) {
        useSessionStore.setState({
          error: `At most ${MAX_COMPOSER_IMAGES} images can be attached`,
        });
      }
      return;
    }
    if (files.filter((f) => takeImageFiles([f], 1).length > 0).length > remaining) {
      useSessionStore.setState({
        error: `At most ${MAX_COMPOSER_IMAGES} images can be attached`,
      });
    }
    try {
      const next: ComposerAttachment[] = [];
      for (const file of chosen) {
        const read = await readFileAsBase64(file);
        next.push({
          id: nextAttachmentId(),
          mimeType: read.mimeType,
          previewUrl: read.previewUrl,
          byteLen: read.byteLen,
          dataBase64: read.dataBase64,
          name: file.name,
        });
      }
      setAttachments((prev) => [...prev, ...next].slice(0, MAX_COMPOSER_IMAGES));
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      useSessionStore.setState({
        error: `Unable to attach image: ${text}`,
      });
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const addPathChips = (paths: string[]) => {
    if (!paths.length) return;
    setPathChips((prev) =>
      paths.reduce((acc, path) => addPathChip(acc, path), prev),
    );
  };

  const removePathChip = (path: string) => {
    setPathChips((prev) => prev.filter((item) => item !== path));
  };

  const pickPathChips = async () => {
    if (!activeSessionId || sending) return;
    if (isTauriRuntime()) {
      try {
        const selected = await openFilesDialog();
        addPathChips(selected);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        useSessionStore.setState({
          error: `Unable to attach path: ${text}`,
        });
      }
      return;
    }
    pathInputRef.current?.click();
  };

  const submit = async (streamingBehavior?: "followUp" | "steer") => {
    if (!canSend) return;
    const sessionAtSend = activeSessionId;
    const fullMessage = mergeMessageWithPaths(message, pathChips);
    const imagePayload = attachments.map((item) => ({
      dataBase64: item.dataBase64,
      mimeType: item.mimeType,
    }));
    setSending(true);
    try {
      const sent = await send(
        fullMessage,
        streamingBehavior,
        imagePayload.length ? imagePayload : undefined,
      );
      if (
        sent &&
        useSessionStore.getState().activeSessionId === sessionAtSend
      ) {
        setDraft("");
        setCursor(0);
        setSlashOpen(false);
        setPathChips([]);
        setAttachments((prev) => {
          for (const item of prev) {
            if (item.previewUrl.startsWith("blob:")) {
              URL.revokeObjectURL(item.previewUrl);
            }
          }
          return [];
        });
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

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    const files: File[] = [];
    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    if (!files.length && event.clipboardData?.files?.length) {
      files.push(...Array.from(event.clipboardData.files));
    }
    const imageFiles = takeImageFiles(files, MAX_COMPOSER_IMAGES);
    if (!imageFiles.length) return;
    event.preventDefault();
    void addFiles(imageFiles);
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (!activeSessionId || sending) return;
    const files = event.dataTransfer?.files
      ? Array.from(event.dataTransfer.files)
      : [];
    if (!files.length) return;

    const imageFiles = takeImageFiles(files, MAX_COMPOSER_IMAGES);
    if (imageFiles.length) {
      void addFiles(imageFiles);
    }

    // Path chips only when a real filesystem path is known (Tauri drop).
    const pathCandidates: string[] = [];
    for (const file of files) {
      if (isImageFile(file)) continue;
      const path = resolveDroppedFilePath(
        file as File & { path?: string },
      );
      if (path) pathCandidates.push(path);
    }
    addPathChips(pathCandidates);
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
      className={dragOver ? "composer is-dragover" : "composer"}
      aria-label="Message composer"
      onSubmit={handleSubmit}
      onDragEnter={(event) => {
        event.preventDefault();
        if (activeSessionId) setDragOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (activeSessionId) setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <label htmlFor="message">Message OMP</label>
      {pathChips.length > 0 && (
        <ul className="composer__path-chips" aria-label="File path references">
          {pathChips.map((path) => {
            const label = path.split(/[/\\]/).filter(Boolean).pop() ?? path;
            return (
              <li key={path} className="composer__path-chip" title={path}>
                <span className="composer__path-chip-icon" aria-hidden="true">
                  /
                </span>
                <span className="composer__path-chip-label">@{label}</span>
                <button
                  type="button"
                  className="composer__path-chip-remove"
                  aria-label={`Remove path ${path}`}
                  onClick={() => removePathChip(path)}
                  disabled={sending}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {attachments.length > 0 && (
        <ul className="composer__attachments" aria-label="Image attachments">
          {attachments.map((item) => (
            <li key={item.id} className="composer__attachment">
              <img
                src={item.previewUrl}
                alt={item.name ?? "Attached image"}
                className="composer__attachment-thumb"
              />
              <div className="composer__attachment-meta">
                <span className="composer__attachment-name">
                  {item.name ?? item.mimeType}
                </span>
                <span className="composer__attachment-size">
                  {formatByteLen(item.byteLen)}
                </span>
              </div>
              <button
                type="button"
                className="composer__attachment-remove"
                aria-label={`Remove ${item.name ?? "image"}`}
                onClick={() => removeAttachment(item.id)}
                disabled={sending}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
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
                : "Ask OMP to work in this project…  (/ for commands, @paths, paste/drop images)"
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
          onPaste={handlePaste}
        />
      </div>
      <div className="composer__footer">
        <div className="composer__footer-left">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const files = event.target.files
                ? Array.from(event.target.files)
                : [];
              event.target.value = "";
              void addFiles(files);
            }}
          />
          <input
            ref={pathInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const files = event.target.files
                ? Array.from(event.target.files)
                : [];
              event.target.value = "";
              // Browser/dev: only the basename is available — still useful as a token.
              addPathChips(
                files
                  .map((file) =>
                    resolveDroppedFilePath(file as File & { path?: string }, {
                      allowNameFallback: true,
                    }),
                  )
                  .filter((path): path is string => Boolean(path)),
              );
            }}
          />
          <button
            type="button"
            className="composer__attach"
            disabled={
              !activeSessionId ||
              sending ||
              attachments.length >= MAX_COMPOSER_IMAGES
            }
            title="Attach images"
            aria-label="Attach images"
            onClick={() => fileInputRef.current?.click()}
          >
            📎
          </button>
          <button
            type="button"
            className="composer__attach composer__attach--path"
            disabled={!activeSessionId || sending}
            title="Attach file path"
            aria-label="Attach file path"
            onClick={() => void pickPathChips()}
          >
            Path
          </button>
          <span>
            {isStreaming
              ? "Enter follow-up · ⌘/Ctrl Enter steer · ⇧Enter newline"
              : slashActive
                ? "↑↓ navigate · Tab/Enter insert · Esc close"
                : "Enter send · ⇧Enter newline · paths/images"}
          </span>
        </div>
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
