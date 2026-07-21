import { useCallback, useEffect, useState } from "react";

import { api, openExternalUrl } from "../lib/tauri.ts";
import {
  selectActiveSession,
  useSessionStore,
} from "../session/session-store.ts";
import type {
  GhIssue,
  GhPr,
  GhRepo,
  GithubSnapshot,
} from "../session/types.ts";
import { EmptyState } from "./empty-state.tsx";

const emptySnapshot = (): GithubSnapshot => ({
  available: false,
  error: null,
  repo: null,
  issues: [],
  prs: [],
});

const normalizeSnapshot = (value: unknown): GithubSnapshot => {
  if (!value || typeof value !== "object") return emptySnapshot();
  const record = value as Record<string, unknown>;
  const repoRaw =
    record.repo && typeof record.repo === "object"
      ? (record.repo as Record<string, unknown>)
      : null;
  const repo: GhRepo | null =
    repoRaw &&
    typeof repoRaw.nameWithOwner === "string" &&
    typeof repoRaw.url === "string"
      ? {
          nameWithOwner: repoRaw.nameWithOwner,
          description:
            typeof repoRaw.description === "string" ? repoRaw.description : null,
          url: repoRaw.url,
        }
      : null;

  const issues = Array.isArray(record.issues)
    ? record.issues
        .map((item): GhIssue | null => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          if (
            typeof row.number !== "number" ||
            typeof row.title !== "string" ||
            typeof row.state !== "string" ||
            typeof row.url !== "string"
          ) {
            return null;
          }
          return {
            number: row.number,
            title: row.title,
            state: row.state,
            url: row.url,
            author: typeof row.author === "string" ? row.author : null,
          };
        })
        .filter((item): item is GhIssue => item !== null)
    : [];

  const prs = Array.isArray(record.prs)
    ? record.prs
        .map((item): GhPr | null => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          if (
            typeof row.number !== "number" ||
            typeof row.title !== "string" ||
            typeof row.state !== "string" ||
            typeof row.url !== "string"
          ) {
            return null;
          }
          return {
            number: row.number,
            title: row.title,
            state: row.state,
            url: row.url,
            isDraft: row.isDraft === true,
            author: typeof row.author === "string" ? row.author : null,
          };
        })
        .filter((item): item is GhPr => item !== null)
    : [];

  return {
    available: record.available === true,
    error: typeof record.error === "string" ? record.error : null,
    repo,
    issues,
    prs,
  };
};

const openLink = (url: string) => {
  void openExternalUrl(url).catch(() => {
    // Soft-fail: panel stays usable even if the OS open path errors.
  });
};

export const GithubPanel = () => {
  const session = useSessionStore(selectActiveSession);
  const cwd = session?.cwd ?? null;

  const [snapshot, setSnapshot] = useState<GithubSnapshot>(emptySnapshot);
  const [loadState, setLoadState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!cwd) {
      setSnapshot(emptySnapshot());
      setLoadState("idle");
      setLoadError(null);
      return;
    }
    setLoadState("loading");
    setLoadError(null);
    try {
      const next = normalizeSnapshot(await api.getGithubSnapshot(cwd));
      setSnapshot(next);
      setLoadState("ready");
    } catch (error) {
      setSnapshot(emptySnapshot());
      setLoadState("error");
      setLoadError(
        error instanceof Error ? error.message : "Unable to load GitHub data",
      );
    }
  }, [cwd]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!cwd) {
    return <EmptyState>Open a session to browse GitHub issues and PRs.</EmptyState>;
  }

  if (loadState === "loading" && !snapshot.available && !snapshot.error) {
    return (
      <div className="github-panel" role="status">
        <p className="panel-feedback">Loading GitHub…</p>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="github-panel">
        <p className="panel-feedback panel-feedback--error">
          {loadError ?? "Unable to load GitHub data"}
        </p>
        <button type="button" className="panel-button" onClick={() => void reload()}>
          Retry
        </button>
      </div>
    );
  }

  if (!snapshot.available) {
    return (
      <div className="github-panel">
        <EmptyState>
          {snapshot.error?.trim() ||
            "GitHub CLI (gh) is unavailable. Install and authenticate gh to use this panel."}
        </EmptyState>
        <button type="button" className="panel-button" onClick={() => void reload()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="github-panel">
      <div className="github-panel__toolbar">
        <span className="github-panel__cwd" title={cwd}>
          {cwd}
        </span>
        <button type="button" className="panel-button" onClick={() => void reload()}>
          Refresh
        </button>
      </div>

      {snapshot.error ? (
        <p className="panel-feedback panel-feedback--error" role="status">
          {snapshot.error}
        </p>
      ) : null}

      <section className="github-section" aria-label="Repository">
        <header className="github-section__header">
          <h3>Repo</h3>
        </header>
        {snapshot.repo ? (
          <div className="github-repo">
            <button
              type="button"
              className="github-link github-repo__name"
              onClick={() => openLink(snapshot.repo!.url)}
              title={snapshot.repo.url}
            >
              {snapshot.repo.nameWithOwner}
            </button>
            {snapshot.repo.description ? (
              <p className="github-repo__description">{snapshot.repo.description}</p>
            ) : null}
            <button
              type="button"
              className="panel-button github-repo__open"
              onClick={() => openLink(snapshot.repo!.url)}
            >
              Open on GitHub
            </button>
          </div>
        ) : (
          <p className="panel-feedback">No repository metadata from gh.</p>
        )}
      </section>

      <section className="github-section" aria-label="Issues">
        <header className="github-section__header">
          <h3>Issues</h3>
          <span className="github-section__count">{snapshot.issues.length}</span>
        </header>
        {snapshot.issues.length === 0 ? (
          <p className="panel-feedback">No open issues (or none returned).</p>
        ) : (
          <ul className="github-list" aria-label="GitHub issues">
            {snapshot.issues.map((issue) => (
              <li key={issue.number} className="github-row">
                <button
                  type="button"
                  className="github-row__body"
                  onClick={() => openLink(issue.url)}
                  title={issue.url}
                >
                  <span className="github-row__meta">
                    <span className="github-row__number">#{issue.number}</span>
                    <span
                      className={`github-row__state github-row__state--${issue.state.toLowerCase()}`}
                    >
                      {issue.state}
                    </span>
                    {issue.author ? (
                      <span className="github-row__author">@{issue.author}</span>
                    ) : null}
                  </span>
                  <strong className="github-row__title">{issue.title}</strong>
                </button>
                <button
                  type="button"
                  className="github-row__open"
                  onClick={() => openLink(issue.url)}
                  aria-label={`Open issue #${issue.number}`}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="github-section" aria-label="Pull requests">
        <header className="github-section__header">
          <h3>PRs</h3>
          <span className="github-section__count">{snapshot.prs.length}</span>
        </header>
        {snapshot.prs.length === 0 ? (
          <p className="panel-feedback">No pull requests (or none returned).</p>
        ) : (
          <ul className="github-list" aria-label="GitHub pull requests">
            {snapshot.prs.map((pr) => (
              <li key={pr.number} className="github-row">
                <button
                  type="button"
                  className="github-row__body"
                  onClick={() => openLink(pr.url)}
                  title={pr.url}
                >
                  <span className="github-row__meta">
                    <span className="github-row__number">#{pr.number}</span>
                    <span
                      className={`github-row__state github-row__state--${pr.state.toLowerCase()}`}
                    >
                      {pr.state}
                    </span>
                    {pr.isDraft ? (
                      <span className="github-row__draft">draft</span>
                    ) : null}
                    {pr.author ? (
                      <span className="github-row__author">@{pr.author}</span>
                    ) : null}
                  </span>
                  <strong className="github-row__title">{pr.title}</strong>
                </button>
                <button
                  type="button"
                  className="github-row__open"
                  onClick={() => openLink(pr.url)}
                  aria-label={`Open pull request #${pr.number}`}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
