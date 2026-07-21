import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractReviewPath,
  isEditLikeToolName,
  reviewFileFromTool,
  upsertReviewFile,
} from "../src/session/review.ts";

const SAMPLE_DIFF = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 context
-removed
+added
+also added
 context
`;

describe("isEditLikeToolName", () => {
  it("matches edit/write/ast_edit variants", () => {
    assert.equal(isEditLikeToolName("edit"), true);
    assert.equal(isEditLikeToolName("Write"), true);
    assert.equal(isEditLikeToolName("ast_edit"), true);
    assert.equal(isEditLikeToolName("tool.write"), true);
    assert.equal(isEditLikeToolName("bash"), false);
    assert.equal(isEditLikeToolName("read"), false);
  });
});

describe("extractReviewPath", () => {
  it("reads path from JSON args and +++ headers", () => {
    assert.equal(
      extractReviewPath(JSON.stringify({ path: "ui/src/app.tsx" })),
      "ui/src/app.tsx",
    );
    assert.equal(
      extractReviewPath(JSON.stringify({ edit: { target: "a/b.ts" } })),
      "a/b.ts",
    );
    assert.equal(extractReviewPath(SAMPLE_DIFF), "src/foo.ts");
  });
});

describe("reviewFileFromTool", () => {
  it("builds a ReviewFile from an edit tool unified diff", () => {
    const file = reviewFileFromTool("edit", SAMPLE_DIFF, "tool-1", "done");
    assert.ok(file);
    assert.equal(file.path, "src/foo.ts");
    assert.equal(file.toolId, "tool-1");
    assert.equal(file.status, "done");
    assert.equal(file.adds, 2);
    assert.equal(file.rems, 1);
    assert.ok(file.diff?.includes("+added"));
  });

  it("tracks running write tools from JSON args without diff body", () => {
    const file = reviewFileFromTool(
      "write",
      JSON.stringify({ path: "notes.md", content: "hi" }),
      "t-2",
      "running",
    );
    assert.ok(file);
    assert.equal(file.path, "notes.md");
    assert.equal(file.status, "running");
    assert.equal(file.toolId, "t-2");
  });

  it("accepts non-edit tools when detail is diff-like", () => {
    const file = reviewFileFromTool("apply_patch", SAMPLE_DIFF, "t-3", "done");
    assert.ok(file);
    assert.equal(file.path, "src/foo.ts");
    assert.equal(file.adds, 2);
  });

  it("returns null for unrelated tools", () => {
    assert.equal(
      reviewFileFromTool("bash", "echo hello\nexit 0\n", "t-4", "done"),
      null,
    );
  });
});

describe("upsertReviewFile", () => {
  it("merges by path and preserves richer diff stats", () => {
    const running = reviewFileFromTool(
      "edit",
      JSON.stringify({ path: "src/foo.ts" }),
      "tool-a",
      "running",
    )!;
    const done = reviewFileFromTool("edit", SAMPLE_DIFF, "tool-a", "done")!;
    const merged = upsertReviewFile([running], done);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.path, "src/foo.ts");
    assert.equal(merged[0]?.status, "done");
    assert.equal(merged[0]?.adds, 2);
    assert.equal(merged[0]?.rems, 1);
  });
});
