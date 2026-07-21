import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSubagentTree,
  flattenSubagentTree,
} from "../src/panels/subagent-tree.ts";
import type { SubagentInfo } from "../src/session/types.ts";

const agent = (
  overrides: Partial<SubagentInfo> & Pick<SubagentInfo, "id" | "name">,
): SubagentInfo => ({
  status: "running",
  ...overrides,
});

describe("buildSubagentTree", () => {
  it("nests children under parents and sorts siblings by name", () => {
    const agents = [
      agent({ id: "root", name: "Main" }),
      agent({ id: "b", name: "Bravo", parentId: "root" }),
      agent({ id: "a", name: "Alpha", parentId: "root" }),
      agent({ id: "a1", name: "Alpha-child", parentId: "a" }),
    ];

    const tree = buildSubagentTree(agents);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.agent.id, "root");
    assert.deepEqual(
      tree[0]?.children.map((node) => node.agent.id),
      ["a", "b"],
    );
    assert.equal(tree[0]?.children[0]?.children[0]?.agent.id, "a1");
    assert.equal(tree[0]?.children[0]?.children[0]?.depth, 2);
  });

  it("promotes agents with missing parents to roots", () => {
    const agents = [
      agent({ id: "orphan", name: "Orphan", parentId: "missing" }),
      agent({ id: "root", name: "Root" }),
    ];

    const tree = buildSubagentTree(agents);
    assert.deepEqual(
      tree.map((node) => node.agent.id),
      ["orphan", "root"],
    );
    assert.equal(tree.every((node) => node.depth === 0), true);
  });

  it("breaks parent cycles by treating the looping node as a root", () => {
    const agents = [
      agent({ id: "a", name: "A", parentId: "b" }),
      agent({ id: "b", name: "B", parentId: "a" }),
      agent({ id: "c", name: "C", parentId: "a" }),
    ];

    const tree = buildSubagentTree(agents);
    const flat = flattenSubagentTree(tree);
    assert.equal(flat.length, 3);
    assert.ok(tree.some((node) => node.agent.id === "a"));
    assert.ok(tree.some((node) => node.agent.id === "b"));
    const aNode = tree.find((node) => node.agent.id === "a");
    assert.ok(aNode);
    assert.deepEqual(
      aNode?.children.map((node) => node.agent.id),
      ["c"],
    );
  });
});

describe("flattenSubagentTree", () => {
  it("walks depth-first for rendering", () => {
    const tree = buildSubagentTree([
      agent({ id: "root", name: "Root" }),
      agent({ id: "child", name: "Child", parentId: "root" }),
      agent({ id: "grand", name: "Grand", parentId: "child" }),
      agent({ id: "other", name: "Other" }),
    ]);

    assert.deepEqual(
      flattenSubagentTree(tree).map((node) => ({
        id: node.agent.id,
        depth: node.depth,
      })),
      [
        { id: "other", depth: 0 },
        { id: "root", depth: 0 },
        { id: "child", depth: 1 },
        { id: "grand", depth: 2 },
      ],
    );
  });
});
