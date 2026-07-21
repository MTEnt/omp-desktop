import {
  useEffect,
  useMemo,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  readSessionRuntimeStatus,
  selectActiveRuntimeSnapshot,
  selectIsActiveStreaming,
  useSessionStore,
} from "./session-store.ts";
import type { PromptImage } from "./types.ts";

type ComposerAttachment = PromptImage & { id: string };

const MAX_ATTACHMENTS = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const fileToAttachment = async (file: File): Promise<ComposerAttachment | null> => {
  if (!file.type.startsWith("image/")) return null;
  if (file.size > MAX_IMAGE_BYTES) return null;
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: "image",
    mimeType: file.type || "image/png",
    data: btoa(binary),
  };
};

const collectImageFiles = (
  source: DataTransferItemList | FileList | null | undefined,
): File[] => {
  if (!source) return [];
  const files: File[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const entry = source[i];
    if (entry instanceof File) {
      if (entry.type.startsWith("image/")) files.push(entry);
      continue;
    }
    const item = entry as DataTransferItem;
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
};

export const Composer = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const isStreaming = useSessionStore(selectIsActiveStreaming);
  const runtimeSnapshot = useSessionStore(selectActiveRuntimeSnapshot);
  const runtimeStatus = useMemo(
    () => readSessionRuntimeStatus(runtimeSnapshot),
    [runtimeSnapshot],
  );
  const pendingApproval = useSessionStore((state) => {
    const id = state.activeSessionId;
    return Boolean(id && (state.extensionUiRequests[id]?.length ?? 0) > 0);
  });
  const send = useSessionStore((state) => state.send);
  const abort = useSessionStore((state) => state.abort);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const message = draft.trim();
  const canSend = Boolean(
    activeSessionId && (message || attachments.length > 0) && !sending,
  );
  const showRunStatus = pendingApproval;
  const modelLabel =
    runtimeStatus.modelId?.trim() ||
    runtimeStatus.model?.split("/").pop() ||
    "—";
  const modelFull = runtimeStatus.model ?? "Model unavailable";
  const thinkLabel = runtimeStatus.thinkingLevel ?? "—";
  const ctxLabel =
    runtimeStatus.contextPercent === null
      ? "—"
      : `${Math.round(runtimeStatus.contextPercent)}%`;
  const shortcutHint = isStreaming
    ? "Enter follow-up · ⌘/Ctrl Enter steer · paste image · ⇧Enter newline"
    : "Enter send · paste image · ⇧Enter newline";

  useEffect(() => {
    setDraft("");
    setAttachments([]);
    setAttachError(null);
  }, [activeSessionId]);

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
      }
    };
    window.addEventListener("omp-desktop:set-composer-text", setComposerText);
    return () =>
      window.removeEventListener(
        "omp-desktop:set-composer-text",
        setComposerText,
      );
  }, []);

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setAttachError(null);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setAttachError(`Up to ${MAX_ATTACHMENTS} images per message`);
      return;
    }
    const next: ComposerAttachment[] = [];
    for (const file of files.slice(0, room)) {
      if (file.size > MAX_IMAGE_BYTES) {
        setAttachError("Image too large (max 8 MB)");
        continue;
      }
      const attachment = await fileToAttachment(file);
      if (attachment) next.push(attachment);
    }
    if (next.length > 0) {
      setAttachments((current) => [...current, ...next].slice(0, MAX_ATTACHMENTS));
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = collectImageFiles(event.clipboardData?.items ?? null);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    const files = collectImageFiles(event.dataTransfer?.files ?? null);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  };

  const submit = async (streamingBehavior?: "followUp" | "steer") => {
    if (!canSend) return;
    const sessionAtSend = activeSessionId;
    const images = attachments.map(({ id: _id, ...image }) => image);
    setSending(true);
    try {
      const sent = await send(message, streamingBehavior, images);
      if (
        sent &&
        useSessionStore.getState().activeSessionId === sessionAtSend
      ) {
        setDraft("");
        setAttachments([]);
        setAttachError(null);
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
    <div className="composer-stack">
      {showRunStatus ? (
        <div
          className={`run-status${pendingApproval ? " run-status--paused" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="run-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Paused — approval needed above</span>
        </div>
      ) : null}
      <form
        className="composer"
        aria-label="Message composer"
        onSubmit={handleSubmit}
        onDragOver={(event) => {
          if (event.dataTransfer?.types.includes("Files")) {
            event.preventDefault();
          }
        }}
        onDrop={handleDrop}
      >
        <label htmlFor="message">Message OMP</label>
        {attachments.length > 0 ? (
          <ul className="composer__attachments" aria-label="Attached images">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="composer__attachment">
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt="Attachment preview"
                />
                <button
                  type="button"
                  className="composer__attachment-remove"
                  aria-label="Remove attachment"
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          id="message"
          rows={2}
          value={draft}
          placeholder={
            activeSessionId
              ? pendingApproval
                ? "Approve or deny above to continue…"
                : isStreaming
                  ? "Add a follow-up, paste an image, or steer…"
                  : "Ask OMP… or paste / drop an image"
              : "Open a folder to begin…"
          }
          disabled={!activeSessionId || sending}
          aria-keyshortcuts="Enter Shift+Enter Meta+Enter Control+Enter"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        {attachError ? (
          <p className="composer__attach-error" role="status">
            {attachError}
          </p>
        ) : null}
        <div className="composer__footer">
          <div className="composer__meta" title={shortcutHint}>
            <div
              className="composer__stat composer__stat--model"
              title={modelFull}
            >
              <span className="composer__stat-label">Model</span>
              <span className="composer__stat-value">{modelLabel}</span>
            </div>
            <div
              className="composer__stat"
              title={
                runtimeStatus.thinkingLevel
                  ? `Thinking: ${runtimeStatus.thinkingLevel}`
                  : "Thinking level unavailable"
              }
            >
              <span className="composer__stat-label">Think</span>
              <span className="composer__stat-value">{thinkLabel}</span>
            </div>
            <div
              className="composer__stat"
              title={
                runtimeStatus.contextPercent === null
                  ? "Context usage unavailable"
                  : `${runtimeStatus.contextPercent}% context used`
              }
            >
              <span className="composer__stat-label">Ctx</span>
              <span className="composer__stat-value">{ctxLabel}</span>
            </div>
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
    </div>
  );
};
