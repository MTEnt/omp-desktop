import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  displayTitle,
  filterHistoricSessions,
  formatRelativeTime,
} from "../src/panels/session-library.ts";
import type { HistoricSessionSummary } from "../src/session/types.ts";

const sample = (
  overrides: Partial<HistoricSessionSummary> = {},
): HistoricSessionSummary => ({
  id: "sess-abcdef12",
  path: "/home/user/.omp/agent/sessions/proj/sess-abcdef12.jsonl",
  project: "proj",
  cwd: "/Users/dev/proj",
  title: "Wire session library",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-20T12:00:00.000Z",
  messageCount: 12,
  model: "gpt-5",
  sizeBytes: 4096,
  archived: false,
  ...overrides,
});

describe("filterHistoricSessions", () => {
  const sessions = [
    sample(),
    sample({
      id: "other-1",
      title: "SSH tunnel notes",
      project: "infra",
      cwd: "/tmp/infra",
      path: "/home/user/.omp/agent/sessions/infra/other-1.jsonl",
    }),
    sample({
      id: "archived-9",
      title: null,
      project: "archive-me",
      cwd: "/var/empty",
      path: "/home/user/.omp/agent/sessions-archived/archive-me/archived-9.jsonl",
      archived: true,
    }),
  ];

  it("returns all sessions for empty query", () => {
    assert.deepEqual(filterHistoricSessions(sessions, "  "), sessions);
  });

  it("matches title case-insensitively", () => {
    const hits = filterHistoricSessions(sessions, "SESSION LIBRARY");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.id, "sess-abcdef12");
  });

  it("matches cwd, project, id, and path", () => {
    assert.equal(filterHistoricSessions(sessions, "/tmp/infra")[0]?.id, "other-1");
    assert.equal(filterHistoricSessions(sessions, "archive-me")[0]?.id, "archived-9");
    assert.equal(filterHistoricSessions(sessions, "sess-abcdef")[0]?.id, "sess-abcdef12");
    assert.equal(
      filterHistoricSessions(sessions, "sessions-archived")[0]?.id,
      "archived-9",
    );
  });
});

describe("displayTitle", () => {
  it("prefers title", () => {
    assert.equal(displayTitle(sample()), "Wire session library");
  });

  it("falls back to shortened id", () => {
    assert.equal(
      displayTitle(sample({ title: "  ", id: "abcdefghijklmnop" })),
      "abcdefgh…",
    );
  });

  it("falls back to path basename", () => {
    assert.equal(
      displayTitle(
        sample({
          title: null,
          id: "",
          path: "/tmp/sessions/my-run.jsonl",
        }),
      ),
      "my-run.jsonl",
    );
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-07-21T12:00:00.000Z");

  it("formats just now, minutes, hours, and days", () => {
    assert.equal(formatRelativeTime("2026-07-21T11:59:30.000Z", now), "just now");
    assert.equal(formatRelativeTime("2026-07-21T11:45:00.000Z", now), "15m ago");
    assert.equal(formatRelativeTime("2026-07-21T09:00:00.000Z", now), "3h ago");
    assert.equal(formatRelativeTime("2026-07-18T12:00:00.000Z", now), "3d ago");
  });

  it("falls back to a locale date for older timestamps", () => {
    const label = formatRelativeTime("2026-01-02T00:00:00.000Z", now);
    assert.match(label, /2026/);
    assert.match(label, /Jan|1/);
  });
});
