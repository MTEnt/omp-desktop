import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Mirror the panel normalizer contract without mounting React.
// Keep in lockstep with ui/src/panels/github-panel.tsx normalizeSnapshot.

type GhRepo = {
  nameWithOwner: string;
  description?: string | null;
  url: string;
};

type GhIssue = {
  number: number;
  title: string;
  state: string;
  url: string;
  author?: string | null;
};

type GhPr = {
  number: number;
  title: string;
  state: string;
  url: string;
  isDraft: boolean;
  author?: string | null;
};

type GithubSnapshot = {
  available: boolean;
  error?: string | null;
  repo?: GhRepo | null;
  issues: GhIssue[];
  prs: GhPr[];
};

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

describe("normalize GithubSnapshot", () => {
  it("maps a full camelCase payload", () => {
    const snap = normalizeSnapshot({
      available: true,
      error: null,
      repo: {
        nameWithOwner: "acme/widgets",
        description: "demo",
        url: "https://github.com/acme/widgets",
      },
      issues: [
        {
          number: 1,
          title: "Bug",
          state: "OPEN",
          url: "https://github.com/acme/widgets/issues/1",
          author: "ada",
        },
      ],
      prs: [
        {
          number: 2,
          title: "Fix",
          state: "OPEN",
          url: "https://github.com/acme/widgets/pull/2",
          isDraft: true,
          author: "linus",
        },
      ],
    });

    assert.equal(snap.available, true);
    assert.equal(snap.repo?.nameWithOwner, "acme/widgets");
    assert.equal(snap.issues[0]?.author, "ada");
    assert.equal(snap.prs[0]?.isDraft, true);
    assert.equal(snap.prs[0]?.author, "linus");
  });

  it("degrades missing gh payloads without tokens", () => {
    const snap = normalizeSnapshot({
      available: false,
      error: "GitHub CLI (gh) not found on PATH",
      repo: null,
      issues: [],
      prs: [],
    });
    assert.equal(snap.available, false);
    assert.match(snap.error ?? "", /gh/);
    assert.equal(snap.repo, null);
    assert.deepEqual(snap.issues, []);
    assert.deepEqual(snap.prs, []);
    assert.ok(!JSON.stringify(snap).toLowerCase().includes("token"));
  });

  it("coerces malformed rows", () => {
    const snap = normalizeSnapshot({
      available: true,
      issues: [{ number: "x" }, { number: 3, title: "ok", state: "OPEN", url: "https://x" }],
      prs: "nope",
      repo: { nameWithOwner: 1 },
    });
    assert.equal(snap.available, true);
    assert.equal(snap.repo, null);
    assert.equal(snap.issues.length, 1);
    assert.equal(snap.issues[0]?.number, 3);
    assert.deepEqual(snap.prs, []);
  });
});
