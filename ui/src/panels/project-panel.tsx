import { useEffect, useMemo, useState } from "react";

import {
  WORKSPACE_COLOR_PRESETS,
  basenameFromCwd,
  useWorkspaceStore,
  workspaceForCwd,
} from "../app/workspace-store.ts";
import { useSessionStore } from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";

export const ProjectPanel = () => {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const upsertWorkspace = useWorkspaceStore((state) => state.upsertWorkspace);
  const togglePin = useWorkspaceStore((state) => state.togglePin);
  const updateWorkspace = useWorkspaceStore((state) => state.updateWorkspace);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [labelDraft, setLabelDraft] = useState("");

  const workspace = useMemo(() => {
    if (!activeSession || activeSession.remote) return undefined;
    return workspaceForCwd(activeSession.cwd, workspaces);
  }, [activeSession, workspaces]);

  useEffect(() => {
    setLabelDraft(workspace?.label ?? "");
  }, [workspace?.id, workspace?.label]);

  if (!activeSession) {
    return (
      <EmptyState>Project context is available once a session is active.</EmptyState>
    );
  }

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(activeSession.cwd);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const ensureWorkspace = () => {
    if (activeSession.remote) return undefined;
    return upsertWorkspace({
      cwd: activeSession.cwd,
      label: labelDraft.trim() || basenameFromCwd(activeSession.cwd),
    });
  };

  const commitLabel = () => {
    const next = labelDraft.trim();
    if (!next) {
      setLabelDraft(workspace?.label ?? basenameFromCwd(activeSession.cwd));
      return;
    }
    const current = workspace ?? ensureWorkspace();
    if (!current) return;
    if (next !== current.label) {
      updateWorkspace(current.id, { label: next });
    }
  };

  return (
    <div className="project-panel">
      <dl className="detail-list">
        <div>
          <dt>Working directory</dt>
          <dd className="project-path">{activeSession.cwd}</dd>
        </div>
        <div>
          <dt>Profile</dt>
          <dd>{activeSession.profile ?? "Default"}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{activeSession.status}</dd>
        </div>
      </dl>

      {!activeSession.remote && (
        <section className="workspace-controls" aria-label="Workspace">
          <div className="workspace-controls__row">
            <label htmlFor="workspace-label">Workspace name</label>
            <input
              id="workspace-label"
              type="text"
              value={labelDraft}
              placeholder={basenameFromCwd(activeSession.cwd)}
              onChange={(event) => setLabelDraft(event.target.value)}
              onBlur={commitLabel}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
          </div>

          <div className="workspace-controls__row">
            <span>Color</span>
            <div className="workspace-color-swatches" role="group" aria-label="Workspace color">
              {WORKSPACE_COLOR_PRESETS.map((color) => {
                const selected = (workspace?.color ?? "") === color;
                return (
                  <button
                    key={color}
                    type="button"
                    className={`workspace-color-swatch${selected ? " is-selected" : ""}`}
                    style={{ background: color }}
                    title={color}
                    aria-label={`Set workspace color ${color}`}
                    aria-pressed={selected}
                    onClick={() => {
                      const current = workspace ?? ensureWorkspace();
                      if (!current) return;
                      updateWorkspace(current.id, { color });
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="workspace-controls__actions">
            <button
              type="button"
              className="panel-button"
              aria-pressed={workspace?.pinned === true}
              onClick={() => {
                const current = workspace ?? ensureWorkspace();
                if (!current) return;
                togglePin(current.id);
              }}
            >
              {workspace?.pinned ? "Unpin workspace" : "Pin workspace"}
            </button>
          </div>
        </section>
      )}

      <button type="button" className="panel-button" onClick={() => void copyPath()}>
        {copyState === "copied" ? "Path copied" : "Copy path"}
      </button>
      {copyState === "error" && (
        <p className="panel-feedback panel-feedback--error">
          Clipboard access is unavailable.
        </p>
      )}
    </div>
  );
};
