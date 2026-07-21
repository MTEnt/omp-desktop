import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatGitChip,
  formatGitChipTitle,
  normalizeGitStatus,
  shouldPollGitStatus,
} from "../src/app/git-status.ts";

describe("normalizeGitStatus", () => {
  it("maps camelCase payloads", () => {
    assert.deepEqual(
      normalizeGitStatus({ branch: "main", dirty: true, error: null }),
      { branch: "main", dirty: true, error: null },
    );
  });

  it("coerces missing fields", () => {
    assert.deepEqual(normalizeGitStatus(null), {
      branch: null,
      dirty: false,
      error: null,
    });
    assert.deepEqual(normalizeGitStatus({ branch: "  ", dirty: "yes" }), {
      branch: null,
      dirty: false,
      error: null,
    });
  });
});

describe("formatGitChip", () => {
  it("renders branch and dirty marker", () => {
    assert.equal(formatGitChip({ branch: "main", dirty: false, error: null }), "git main");
    assert.equal(formatGitChip({ branch: "main", dirty: true, error: null }), "git main*");
    assert.equal(formatGitChip({ branch: null, dirty: false, error: "no repo" }), "git —");
    assert.equal(formatGitChip(null), "git —");
  });
});

describe("formatGitChipTitle", () => {
  it("includes dirty state and errors", () => {
    assert.equal(
      formatGitChipTitle({ branch: "feat", dirty: true, error: null }),
      "feat · dirty working tree",
    );
    assert.equal(
      formatGitChipTitle({ branch: null, dirty: false, error: "not a git repository" }),
      "not a git repository",
    );
  });
});

describe("shouldPollGitStatus", () => {
  it("requires a cwd", () => {
    assert.equal(shouldPollGitStatus({ cwd: "" }), false);
    assert.equal(shouldPollGitStatus({ cwd: "/Users/me/proj" }), true);
  });

  it("skips ephemeral remote workspaces", () => {
    assert.equal(
      shouldPollGitStatus({
        cwd: "/tmp/omp-remote-abc",
        remote: { host: "box" },
      }),
      false,
    );
    assert.equal(
      shouldPollGitStatus({
        cwd: "/Users/me/proj",
        remote: { host: "box" },
      }),
      true,
    );
  });
});
