import { useCallback, useEffect, useMemo, useState } from "react";

import {
  WORKSPACE_COLOR_PRESETS,
  basenameFromCwd,
  useWorkspaceStore,
  workspaceForCwd,
} from "../app/workspace-store.ts";
import { api, isTauriRuntime } from "../lib/tauri.ts";
import { useSessionStore } from "../session/session-store.ts";
import type { DirEntryDto, RemoteSessionInfo } from "../session/types.ts";
import { EmptyState } from "./empty-state.tsx";

const parentOf = (path: string): string | null => {
  const normalized = path.replace(/\/+$/, "");
  if (!normalized || normalized === "/" || /^[A-Za-z]:$/.test(normalized)) {
    return null;
  }
  const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (idx <= 0) {
    if (normalized.startsWith("/")) return "/";
    return null;
  }
  if (/^[A-Za-z]:$/.test(normalized.slice(0, idx))) {
    return `${normalized.slice(0, idx)}\\`;
  }
  return normalized.slice(0, idx) || "/";
};

const isUnderRoot = (root: string, candidate: string): boolean => {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const r = norm(root);
  const c = norm(candidate);
  return c === r || c.startsWith(`${r}/`);
};

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

  const [browsePath, setBrowsePath] = useState<string>("");
  const [entries, setEntries] = useState<DirEntryDto[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const workspace = useMemo(() => {
    if (!activeSession || activeSession.remote) return undefined;
    return workspaceForCwd(activeSession.cwd, workspaces);
  }, [activeSession, workspaces]);

  useEffect(() => {
    setLabelDraft(workspace?.label ?? "");
  }, [workspace?.id, workspace?.label]);

  const sessionKey = activeSession
    ? `${activeSession.id}\0${activeSession.cwd}\0${activeSession.remote?.remoteCwd ?? ""}`
    : "";

  const relativeCrumb = useMemo(() => {
    if (!activeSession) return ".";
    const root = activeSession.remote
      ? activeSession.remote.remoteCwd
      : activeSession.cwd;
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
    const r = norm(root);
    const c = norm(browsePath || root);
    if (c === r) return ".";
    if (c.startsWith(`${r}/`)) return c.slice(r.length + 1);
    return browsePath || ".";
  }, [activeSession, browsePath]);

  // Reset browser when session identity / cwd changes.
  useEffect(() => {
    if (!activeSession) {
      setBrowsePath("");
      setEntries([]);
      setBrowseError(null);
      setPreviewPath(null);
      setPreviewText(null);
      setPreviewError(null);
      return;
    }
    const root = activeSession.remote
      ? activeSession.remote.remoteCwd
      : activeSession.cwd;
    setBrowsePath(root);
    setEntries([]);
    setPreviewPath(null);
    setPreviewText(null);
    setPreviewError(null);
    setBrowseError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionKey captures identity
  }, [sessionKey]);

  const loadDir = useCallback(async (path: string) => {
    const session = useSessionStore
      .getState()
      .sessions.find((s) => s.id === useSessionStore.getState().activeSessionId);
    if (!session) {
      setEntries([]);
      return;
    }
    if (!isTauriRuntime()) {
      setBrowseError("File browser requires the desktop app runtime.");
      setEntries([]);
      return;
    }

    setBrowseLoading(true);
    setBrowseError(null);
    try {
      if (session.remote) {
        const remote: RemoteSessionInfo = session.remote;
        const listing = await api.listRemoteDir(
          {
            hostName: remote.hostName,
            host: remote.host,
            user: remote.user ?? null,
            port: remote.port ?? null,
            keyPath: remote.keyPath ?? null,
            remoteCwd: remote.remoteCwd,
          },
          path,
        );
        setBrowsePath((current) =>
          current === listing.path ? current : listing.path,
        );
        setEntries(
          listing.entries.map((e) => ({
            name: e.name,
            path: e.path,
            isDir: e.isDir,
          })),
        );
      } else {
        const root = session.cwd;
        const list = await api.listProjectDir(root, path || root);
        setEntries(list);
      }
    } catch (error) {
      setEntries([]);
      setBrowseError(error instanceof Error ? error.message : String(error));
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionKey || !browsePath) return;
    void loadDir(browsePath);
  }, [sessionKey, browsePath, loadDir]);

  const openEntry = async (entry: DirEntryDto) => {
    if (entry.isDir) {
      setPreviewPath(null);
      setPreviewText(null);
      setPreviewError(null);
      setBrowsePath(entry.path);
      return;
    }

    if (activeSession?.remote) {
      setPreviewPath(entry.path);
      setPreviewText(null);
      setPreviewError(
        "Preview local only — remote file preview is not available.",
      );
      return;
    }

    if (!activeSession || !isTauriRuntime()) return;

    setPreviewPath(entry.path);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewText(null);
    try {
      const text = await api.readProjectFile(activeSession.cwd, entry.path);
      setPreviewText(text);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewLoading(false);
    }
  };

  const goUp = () => {
    if (!activeSession) return;
    const root = activeSession.remote
      ? activeSession.remote.remoteCwd
      : activeSession.cwd;
    const parent = parentOf(browsePath);
    if (!parent) return;
    if (!activeSession.remote && !isUnderRoot(root, parent)) {
      return;
    }
    setPreviewPath(null);
    setPreviewText(null);
    setPreviewError(null);
    setBrowsePath(parent);
  };

  const canGoUp = useMemo(() => {
    if (!activeSession || !browsePath) return false;
    const root = activeSession.remote
      ? activeSession.remote.remoteCwd
      : activeSession.cwd;
    const parent = parentOf(browsePath);
    if (!parent) return false;
    if (activeSession.remote) {
      return parent !== browsePath;
    }
    return isUnderRoot(root, parent);
  }, [activeSession, browsePath]);

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

      <section className="project-files" aria-label="Project files">
        <div className="project-files__header">
          <h3>Files</h3>
          {activeSession.remote && (
            <span className="project-files__badge">Remote</span>
          )}
        </div>

        <div className="project-files__browser" aria-label="Directory browser">
          <div className="project-files__bar">
            <button
              type="button"
              className="panel-button"
              disabled={!canGoUp || browseLoading}
              onClick={goUp}
              aria-label="Parent directory"
            >
              Up
            </button>
            <code title={browsePath}>{relativeCrumb}</code>
          </div>

          {browseLoading && (
            <p className="project-files__status">Loading…</p>
          )}
          {browseError && (
            <p className="panel-feedback panel-feedback--error">{browseError}</p>
          )}

          {!browseLoading && !browseError && (
            <div className="project-files__entries">
              {entries.length === 0 ? (
                <p className="project-files__status">Empty directory</p>
              ) : (
                entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className={`project-files__entry${entry.isDir ? " is-dir" : ""}${
                      previewPath === entry.path ? " is-selected" : ""
                    }`}
                    onClick={() => void openEntry(entry)}
                  >
                    <span className="project-files__kind" aria-hidden="true">
                      {entry.isDir ? "DIR" : "FILE"}
                    </span>
                    <span className="project-files__name">{entry.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {(previewPath || previewLoading || previewError || previewText) && (
          <div className="project-files__preview" aria-label="File preview">
            <div className="project-files__preview-bar">
              <code title={previewPath ?? undefined}>
                {previewPath
                  ? previewPath.split(/[/\\]/).pop() ?? previewPath
                  : "Preview"}
              </code>
              <button
                type="button"
                className="panel-button"
                onClick={() => {
                  setPreviewPath(null);
                  setPreviewText(null);
                  setPreviewError(null);
                }}
              >
                Close
              </button>
            </div>
            {previewLoading && (
              <p className="project-files__status">Loading preview…</p>
            )}
            {previewError && (
              <p className="panel-feedback panel-feedback--error">{previewError}</p>
            )}
            {previewText != null && (
              <pre className="project-files__preview-body">{previewText}</pre>
            )}
          </div>
        )}
      </section>

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
