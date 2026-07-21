import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isDiffLike,
  parseToolPayload,
  parseUnifiedDiff,
} from "../src/session/tool-render.ts";

const SAMPLE_DIFF = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 context
-removed
+added
+also added
 context
\\ No newline at end of file
`;

describe("parseUnifiedDiff", () => {
  it("parses a simple unified diff with adds/rems and target from +++ b/path", () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF);

    assert.equal(parsed.kind, "edit");
    assert.equal(parsed.target, "src/foo.ts");
    assert.equal(parsed.adds, 2);
    assert.equal(parsed.rems, 1);
    assert.equal(parsed.raw, SAMPLE_DIFF);

    const kinds = parsed.lines.map((line) => line.kind);
    assert.ok(kinds.includes("meta"));
    assert.ok(kinds.includes("ctx"));
    assert.ok(kinds.includes("add"));
    assert.ok(kinds.includes("rem"));

    const addTexts = parsed.lines
      .filter((line) => line.kind === "add")
      .map((line) => line.text);
    assert.deepEqual(addTexts, ["added", "also added"]);

    const remTexts = parsed.lines
      .filter((line) => line.kind === "rem")
      .map((line) => line.text);
    assert.deepEqual(remTexts, ["removed"]);

    // \\ No newline should be ignored (not counted as content)
    assert.equal(
      parsed.lines.some((line) => line.text.includes("No newline")),
      false,
    );
  });

  it("uses targetHint when +++ header is missing", () => {
    const body = `@@ -1 +1 @@
-old
+new
`;
    const parsed = parseUnifiedDiff(body, "hint/path.ts");
    assert.equal(parsed.target, "hint/path.ts");
    assert.equal(parsed.adds, 1);
    assert.equal(parsed.rems, 1);
  });
});

describe("parseToolPayload", () => {
  it("preserves bash output and optional exit code", () => {
    const detail = "hello world\nexit 0\n";
    const parsed = parseToolPayload("bash", detail);

    assert.equal(parsed.kind, "bash");
    if (parsed.kind !== "bash") throw new Error("expected bash");
    assert.equal(parsed.output, detail);
    assert.equal(parsed.exitCode, 0);
    assert.equal(parsed.raw, detail);
  });

  it("reads bash exit code from trailing JSON", () => {
    const detail = 'stdout here\n{"exitCode": 2}';
    const parsed = parseToolPayload("Bash", detail);
    assert.equal(parsed.kind, "bash");
    if (parsed.kind !== "bash") throw new Error("expected bash");
    assert.equal(parsed.exitCode, 2);
  });

  it("maps unknown tools to raw", () => {
    const detail = "whatever payload";
    const parsed = parseToolPayload("unknown_tool", detail);
    assert.deepEqual(parsed, { kind: "raw", raw: detail });
  });

  it("parses edit tool name with a diff body", () => {
    const parsed = parseToolPayload("edit", SAMPLE_DIFF);
    assert.equal(parsed.kind, "edit");
    if (parsed.kind !== "edit") throw new Error("expected edit");
    assert.equal(parsed.target, "src/foo.ts");
    assert.equal(parsed.adds, 2);
    assert.equal(parsed.rems, 1);
  });

  it("parses write/ast_edit as edit diffs", () => {
    assert.equal(parseToolPayload("write", SAMPLE_DIFF).kind, "edit");
    assert.equal(parseToolPayload("ast_edit", SAMPLE_DIFF).kind, "edit");
  });

  it("parses read with target and summary", () => {
    const detail = "/Users/me/project/src/a.ts\nfile contents here\n";
    const parsed = parseToolPayload("read", detail);
    assert.equal(parsed.kind, "read");
    if (parsed.kind !== "read") throw new Error("expected read");
    assert.equal(parsed.target, "/Users/me/project/src/a.ts");
    assert.equal(parsed.summary, "/Users/me/project/src/a.ts");
    assert.equal(parsed.raw, detail);
  });

  it("maps search/find/grep to search kind", () => {
    for (const name of ["search", "find", "grep"]) {
      const parsed = parseToolPayload(name, "matches in foo.ts");
      assert.equal(parsed.kind, "search", name);
      if (parsed.kind !== "search") throw new Error("expected search");
      assert.equal(parsed.raw, "matches in foo.ts");
    }
  });

  it("parses eval JSON cells or falls back to a single cell", () => {
    const cells = [
      { language: "ts", code: "1+1", output: "2" },
      { language: "py", code: "print(1)", output: "1" },
    ];
    const jsonDetail = JSON.stringify({ cells });
    const fromJson = parseToolPayload("eval", jsonDetail);
    assert.equal(fromJson.kind, "eval");
    if (fromJson.kind !== "eval") throw new Error("expected eval");
    assert.deepEqual(fromJson.cells, cells);

    const plain = parseToolPayload("eval", "plain output");
    assert.equal(plain.kind, "eval");
    if (plain.kind !== "eval") throw new Error("expected eval");
    assert.deepEqual(plain.cells, [{ output: "plain output" }]);
  });

  it("treats diff-like detail as edit even for non-edit tool names", () => {
    const parsed = parseToolPayload("something", SAMPLE_DIFF);
    assert.equal(parsed.kind, "edit");
  });
});

describe("isDiffLike", () => {
  it("returns true for unified diffs and false otherwise", () => {
    assert.equal(isDiffLike(SAMPLE_DIFF), true);
    assert.equal(isDiffLike("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n"), true);
    assert.equal(isDiffLike("just plain text"), false);
    assert.equal(isDiffLike(""), false);
    assert.equal(isDiffLike("+++ not really a diff"), false);
  });
});
