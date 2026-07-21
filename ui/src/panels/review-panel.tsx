import { useEffect, useMemo, useState } from "react";

import { DiffView } from "../session/diff-view.tsx";
import {
  selectActiveReviewFiles,
  useSessionStore,
} from "../session/session-store.ts";
import type { ReviewFile } from "../session/types.ts";
import { parseToolPayload } from "../session/tool-render.ts";
import { EmptyState } from "./empty-state.tsx";

const basename = (path: string): string => {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
};

const statusLabel = (status: ReviewFile["status"]): string => {
  switch (status) {
    case "running":
      return "running";
    case "error":
      return "error";
    default:
      return "done";
  }
};

export const ReviewPanel = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const files = useSessionStore(selectActiveReviewFiles);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (files.length === 0) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !files.some((file) => file.path === selectedPath)) {
      setSelectedPath(files[0]?.path ?? null);
    }
  }, [files, selectedPath]);

  const selected = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? null,
    [files, selectedPath],
  );

  const selectedParsed = useMemo(() => {
    if (!selected?.diff) return null;
    const parsed = parseToolPayload("edit", selected.diff);
    return parsed.kind === "edit" ? parsed : null;
  }, [selected]);

  if (!activeSessionId) {
    return <EmptyState>Select a session to review its edits.</EmptyState>;
  }

  if (files.length === 0) {
    return (
      <EmptyState>Edits from this session will appear here.</EmptyState>
    );
  }

  return (
    <div className="review-panel">
      <header className="review-panel__header">
        <span className="review-panel__eyebrow">Read-only</span>
        <span>
          {files.length} file{files.length === 1 ? "" : "s"}
        </span>
      </header>

      <ul className="review-file-list" aria-label="Session edit files">
        {files.map((file) => {
          const isSelected = file.path === selectedPath;
          return (
            <li key={file.path}>
              <button
                type="button"
                className={`review-file-row${isSelected ? " is-selected" : ""}${
                  file.status === "error" ? " is-error" : ""
                }${file.status === "running" ? " is-running" : ""}`}
                onClick={() => setSelectedPath(file.path)}
                title={file.path}
              >
                <span className="review-file-row__name">{basename(file.path)}</span>
                <span className="review-file-row__path">{file.path}</span>
                <span className="review-file-row__meta">
                  <span className={`review-file-row__status review-file-row__status--${file.status}`}>
                    {statusLabel(file.status)}
                  </span>
                  {file.adds !== undefined || file.rems !== undefined ? (
                    <span className="review-file-row__stats">
                      <span className="review-file-row__adds">
                        +{file.adds ?? 0}
                      </span>
                      <span className="review-file-row__rems">
                        −{file.rems ?? 0}
                      </span>
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="review-panel__detail" aria-label="Selected file diff">
        {selected ? (
          selectedParsed ? (
            <DiffView parsed={selectedParsed} />
          ) : (
            <pre className="review-panel__raw">
              {selected.diff?.trim()
                ? selected.diff
                : "No diff detail yet for this file."}
            </pre>
          )
        ) : null}
      </div>
    </div>
  );
};
