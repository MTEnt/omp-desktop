import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addPathChip,
  mergeMessageWithPaths,
  normalizePathChip,
  resolveDroppedFilePath,
} from "../src/session/path-chips.ts";

describe("path-chips helpers", () => {
  it("normalizes whitespace and repeated separators", () => {
    assert.equal(normalizePathChip("  /tmp//foo/bar  "), "/tmp/foo/bar");
    assert.equal(normalizePathChip(""), "");
    assert.equal(normalizePathChip("   "), "");
  });

  it("dedupes path chips case-insensitively after normalize", () => {
    const once = addPathChip([], "/Users/me/Project/src/main.ts");
    assert.deepEqual(once, ["/Users/me/Project/src/main.ts"]);

    const again = addPathChip(once, " /Users/me/Project/src/main.ts ");
    assert.deepEqual(again, once);

    const mixed = addPathChip(once, "/users/me/project/src/main.ts");
    assert.deepEqual(mixed, once);

    const second = addPathChip(once, "/Users/me/Project/README.md");
    assert.deepEqual(second, [
      "/Users/me/Project/src/main.ts",
      "/Users/me/Project/README.md",
    ]);

    assert.deepEqual(addPathChip(once, "   "), once);
  });

  it("merges @paths ahead of the message body", () => {
    assert.equal(mergeMessageWithPaths("hello", []), "hello");
    assert.equal(
      mergeMessageWithPaths("hello", ["/tmp/a.ts", "/tmp/b.ts"]),
      "@/tmp/a.ts @/tmp/b.ts\n\nhello",
    );
    assert.equal(
      mergeMessageWithPaths("", ["/tmp/only.ts"]),
      "@/tmp/only.ts",
    );
    assert.equal(
      mergeMessageWithPaths("keep me", ["  ", "/tmp/x"]),
      "@/tmp/x\n\nkeep me",
    );
  });

  it("resolves dropped file paths only when known", () => {
    assert.equal(
      resolveDroppedFilePath({ name: "a.ts", path: "/abs/a.ts" }),
      "/abs/a.ts",
    );
    assert.equal(resolveDroppedFilePath({ name: "a.ts" }), null);
    assert.equal(
      resolveDroppedFilePath({ name: "a.ts" }, { allowNameFallback: true }),
      "a.ts",
    );
  });
});
