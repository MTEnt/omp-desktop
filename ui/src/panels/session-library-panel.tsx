import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/tauri.ts";
import { useSessionStore } from "../session/session-store.ts";
import type {
  HistoricSessionSummary,
  SessionSearchHit,
} from "../session/types.ts";
import { EmptyState } from "./empty-state.tsx";
import {
  displayTitle,
  filterHistoricSessions,
  formatRelativeTime,
} from "./session-library.ts";

type LibraryMode = "browse" | "search";

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const SessionLibraryPanel = () => {
  const openFolder = useSessionStore((state) => state.openFolder);

  const [sessions, setSessions] = useState<HistoricSessionSummary[]>([]);
  const [hits, setHits] = useState<SessionSearchHit[]>([]);
  const [filter, setFilter] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [mode, setMode] = useState<LibraryMode>("browse");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const next = await api.listHistoricSessions(includeArchived);
      if (request !== requestGeneration.current) return;
      setSessions(next);
      setMode("browse");
      setHits([]);
    } catch (err) {
      if (request !== requestGeneration.current) return;
      setError(errorMessage(err));
    } finally {
      if (request === requestGeneration.current) {
        setLoading(false);
      }
    }
  }, [includeArchived]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(
    () => filterHistoricSessions(sessions, filter),
    [filter, sessions],
  );

  const runContentSearch = async () => {
    const query = filter.trim();
    if (!query) {
      setMode("browse");
      setHits([]);
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const next = await api.searchHistoricSessions(query);
      setHits(next);
      setMode("search");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSearching(false);
    }
  };

  const withRowAction = async (
    path: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    setBusyPath(path);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyPath(null);
    }
  };

  const openSession = async (session: HistoricSessionSummary) => {
    setBusyPath(session.path);
    setError(null);
    try {
      await openFolder(session.cwd || undefined, session.path);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyPath(null);
    }
  };

  const renameSession = async (session: HistoricSessionSummary) => {
    const current = displayTitle(session);
    const next = window.prompt("Rename session", current);
    if (next == null) return;
    const title = next.trim();
    if (!title || title === current) return;
    await withRowAction(session.path, () =>
      api.renameHistoricSession(session.path, title),
    );
  };

  const archiveOrRestore = async (session: HistoricSessionSummary) => {
    await withRowAction(session.path, () =>
      session.archived
        ? api.unarchiveHistoricSession(session.path)
        : api.archiveHistoricSession(session.path),
    );
  };

  const deleteSession = async (session: HistoricSessionSummary) => {
    const label = displayTitle(session);
    if (!window.confirm(`Delete historic session “${label}”? This cannot be undone.`)) {
      return;
    }
    await withRowAction(session.path, () =>
      api.deleteHistoricSession(session.path),
    );
  };

  const copyPath = async (path: string) => {
    setError(null);
    try {
      await navigator.clipboard.writeText(path);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const showSearch = mode === "search";
  const rows = showSearch
    ? hits.map((hit) => ({ session: hit.session, hit }))
    : filtered.map((session) => ({ session, hit: null as SessionSearchHit | null }));

  return (
    <div className="session-library-panel">
      <div className="session-library-panel__toolbar">
        <div className="session-library-panel__search">
          <input
            type="search"
            value={filter}
            placeholder="Filter title, project, path…"
            autoComplete="off"
            aria-label="Filter historic sessions"
            onChange={(event) => {
              setFilter(event.target.value);
              if (mode === "search") {
                setMode("browse");
                setHits([]);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void runContentSearch();
              }
            }}
          />
          <button
            type="button"
            className="panel-button"
            disabled={searching || !filter.trim()}
            onClick={() => void runContentSearch()}
          >
            {searching ? "Searching…" : "Search contents"}
          </button>
        </div>

        <label className="session-library-panel__toggle">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          <span>Include archived</span>
        </label>

        <button
          type="button"
          className="panel-button"
          disabled={loading || searching}
          onClick={() => void reload()}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p className="panel-feedback panel-feedback--error" role="alert">
          {error}
        </p>
      ) : null}

      {showSearch ? (
        <p className="session-library-panel__mode">
          Content search · {hits.length} hit{hits.length === 1 ? "" : "s"}
          <button
            type="button"
            className="panel-button session-library-panel__mode-clear"
            onClick={() => {
              setMode("browse");
              setHits([]);
            }}
          >
            Clear search
          </button>
        </p>
      ) : null}

      {loading ? (
        <EmptyState>Loading historic sessions…</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>
          {showSearch
            ? "No transcript matches for that query."
            : filter.trim()
              ? "No sessions match this filter."
              : includeArchived
                ? "No historic sessions found under ~/.omp/agent/sessions."
                : "No active historic sessions. Toggle “Include archived” to browse the archive."}
        </EmptyState>
      ) : (
        <div className="session-library-list" aria-label="Historic sessions">
          {rows.map(({ session, hit }) => {
            const busy = busyPath === session.path;
            const title = displayTitle(session);
            return (
              <article
                key={`${session.path}:${hit?.line ?? "row"}`}
                className={`session-library-row${session.archived ? " is-archived" : ""}`}
              >
                <div className="session-library-row__main">
                  <div className="session-library-row__title">
                    <strong title={session.path}>{title}</strong>
                    {session.archived ? (
                      <span className="session-library-badge">archived</span>
                    ) : null}
                  </div>
                  <div className="session-library-row__meta">
                    <span>{session.project || "—"}</span>
                    <span>{formatRelativeTime(session.updatedAt)}</span>
                    <span>
                      {session.messageCount} msg
                      {session.messageCount === 1 ? "" : "s"}
                    </span>
                    {session.model ? <span>{session.model}</span> : null}
                  </div>
                  <small className="session-library-row__cwd" title={session.cwd}>
                    {session.cwd || "No cwd recorded"}
                  </small>
                  {hit ? (
                    <p className="session-library-row__snippet">
                      <span className="session-library-row__line">L{hit.line}</span>
                      {hit.snippet}
                    </p>
                  ) : null}
                </div>

                <div className="session-library-row__actions">
                  <button
                    type="button"
                    className="panel-button panel-button--primary"
                    disabled={busy}
                    onClick={() => void openSession(session)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="panel-button"
                    disabled={busy}
                    onClick={() => void renameSession(session)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="panel-button"
                    disabled={busy}
                    onClick={() => void archiveOrRestore(session)}
                  >
                    {session.archived ? "Restore" : "Archive"}
                  </button>
                  <button
                    type="button"
                    className="panel-button"
                    disabled={busy}
                    onClick={() => void copyPath(session.path)}
                  >
                    Copy path
                  </button>
                  <button
                    type="button"
                    className="panel-button"
                    disabled={busy}
                    onClick={() => void deleteSession(session)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
