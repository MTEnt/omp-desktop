import type { SubagentInfo } from "../session/types.ts";

export interface SubagentTreeNode {
  agent: SubagentInfo;
  children: SubagentTreeNode[];
  depth: number;
}

const byName = (a: SubagentTreeNode, b: SubagentTreeNode): number =>
  a.agent.name.localeCompare(b.agent.name, undefined, { sensitivity: "base" });

const wouldCreateCycle = (
  parentId: string,
  childId: string,
  parentById: Map<string, string | null | undefined>,
): boolean => {
  let cursor: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === childId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = parentById.get(cursor);
  }
  return false;
};

export function buildSubagentTree(agents: SubagentInfo[]): SubagentTreeNode[] {
  const byId = new Map<string, SubagentInfo>();
  for (const agent of agents) {
    byId.set(agent.id, agent);
  }

  const parentById = new Map<string, string | null | undefined>();
  for (const agent of agents) {
    parentById.set(agent.id, agent.parentId);
  }

  const childrenByParent = new Map<string, SubagentInfo[]>();
  const roots: SubagentInfo[] = [];

  for (const agent of agents) {
    const parentId = agent.parentId;
    if (
      !parentId ||
      parentId === agent.id ||
      !byId.has(parentId) ||
      wouldCreateCycle(parentId, agent.id, parentById)
    ) {
      roots.push(agent);
      continue;
    }
    const siblings = childrenByParent.get(parentId);
    if (siblings) {
      siblings.push(agent);
    } else {
      childrenByParent.set(parentId, [agent]);
    }
  }

  const visit = (agent: SubagentInfo, depth: number): SubagentTreeNode => {
    const childAgents = childrenByParent.get(agent.id) ?? [];
    const children = childAgents
      .map((child) => visit(child, depth + 1))
      .sort(byName);
    return { agent, children, depth };
  };

  return roots.map((agent) => visit(agent, 0)).sort(byName);
}

export function flattenSubagentTree(
  nodes: SubagentTreeNode[],
): SubagentTreeNode[] {
  const out: SubagentTreeNode[] = [];
  const walk = (list: SubagentTreeNode[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
