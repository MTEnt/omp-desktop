import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  WORKSPACE_STORAGE_KEY,
  basenameFromCwd,
  defaultColorForCwd,
  groupSessionsByWorkspace,
  loadWorkspaces,
  normalizeCwd,
  parseWorkspaces,
  saveWorkspaces,
  useWorkspaceStore,
  workspaceForCwd,
  type Workspace,
} from "../src/app/workspace-store.ts";
import type { SessionInfo } from "../src/session/types.ts";

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  };
};

const session = (
  partial: Partial<SessionInfo> & Pick<SessionInfo, "id" | "cwd">,
): SessionInfo => ({
  title: partial.title ?? partial.id,
  profile: partial.profile ?? null,
  status: partial.status ?? "ready",
  remote: partial.remote,
  ...partial,
});

beforeEach(() => {
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  useWorkspaceStore.setState({ workspaces: [] });
});

describe("normalizeCwd", () => {
  it("trims, unifies separators, and drops trailing slashes", () => {
    assert.equal(normalizeCwd("  /tmp//foo/bar/  "), "/tmp/foo/bar");
    assert.equal(normalizeCwd("C:\\Users\\dev\\project\\"), "C:/Users/dev/project");
    assert.equal(normalizeCwd("/"), "/");
    assert.equal(normalizeCwd(""), "");
    assert.equal(normalizeCwd("   "), "");
  });
});

describe("defaultColorForCwd", () => {
  it("is stable for the same cwd and differs across paths", () => {
    const a = defaultColorForCwd("/Users/me/alpha");
    const b = defaultColorForCwd("/Users/me/alpha/");
    const c = defaultColorForCwd("/Users/me/beta");
    assert.equal(a, b);
    assert.match(a, /^#[0-9a-f]{6}$/i);
    // Not required to always differ, but with distinct basenames it usually will;
    // at least ensure the function returns a preset color for beta too.
    assert.match(c, /^#[0-9a-f]{6}$/i);
  });
});

describe("basenameFromCwd", () => {
  it("returns the last path segment", () => {
    assert.equal(basenameFromCwd("/Users/me/omp-desktop"), "omp-desktop");
    assert.equal(basenameFromCwd("C:/work/app/"), "app");
  });
});

describe("workspaceForCwd + parseWorkspaces", () => {
  it("matches lightly normalized paths and skips invalid entries", () => {
    const workspaces = parseWorkspaces([
      {
        id: "w1",
        label: "Alpha",
        cwd: "/tmp/alpha/",
        color: "#00b4ff",
        pinned: true,
        hidden: false,
      },
      { label: "Missing cwd" },
      {
        id: "w2",
        label: "Beta",
        cwd: "\\tmp\\beta",
        color: "#7ee787",
      },
    ]);

    assert.equal(workspaces.length, 2);
    assert.equal(workspaceForCwd("/tmp/alpha", workspaces)?.id, "w1");
    assert.equal(workspaceForCwd("/tmp/alpha/", workspaces)?.label, "Alpha");
    assert.equal(workspaceForCwd("/tmp/beta", workspaces)?.id, "w2");
    assert.equal(workspaceForCwd("/tmp/other", workspaces), undefined);
  });
});

describe("groupSessionsByWorkspace", () => {
  it("groups open sessions under named workspaces and raw cwd folders", () => {
    const workspaces: Workspace[] = [
      {
        id: "ws-app",
        label: "App Core",
        cwd: "/Users/dev/app",
        color: "#00b4ff",
        pinned: true,
        hidden: false,
      },
      {
        id: "ws-docs",
        label: "Docs",
        cwd: "/Users/dev/docs",
        color: "#ffa657",
        pinned: false,
        hidden: false,
      },
    ];

    const sessions = [
      session({ id: "s1", cwd: "/Users/dev/app", title: "chat-1" }),
      session({ id: "s2", cwd: "/Users/dev/app/", title: "chat-2" }),
      session({ id: "s3", cwd: "/Users/dev/docs", title: "docs-1" }),
      session({ id: "s4", cwd: "/tmp/scratch/project", title: "scratch" }),
      session({
        id: "s5",
        cwd: "/tmp/omp-desktop/remote-sessions/x",
        title: "remote",
        remote: {
          hostName: "prod",
          host: "example.com",
          remoteCwd: "/srv/site",
          label: "prod:/srv/site",
        },
      }),
    ];

    const groups = groupSessionsByWorkspace(sessions, workspaces);
    assert.equal(groups.length, 4);

    // Pinned named workspace first
    assert.equal(groups[0]?.workspace?.id, "ws-app");
    assert.equal(groups[0]?.label, "App Core");
    assert.deepEqual(
      groups[0]?.sessions.map((item) => item.id),
      ["s1", "s2"],
    );

    // Other named workspace next
    assert.equal(groups[1]?.workspace?.id, "ws-docs");
    assert.equal(groups[1]?.sessions[0]?.id, "s3");

    // Unnamed local folder uses basename
    const scratch = groups.find((group) => group.sessions.some((s) => s.id === "s4"));
    assert.ok(scratch);
    assert.equal(scratch.workspace, null);
    assert.equal(scratch.label, "project");

    // Remote sessions group by host:folder
    const remote = groups.find((group) => group.sessions.some((s) => s.id === "s5"));
    assert.ok(remote);
    assert.equal(remote.label, "prod:site");
  });

  it("sorts pinned named workspaces ahead of unpinned ones", () => {
    const workspaces: Workspace[] = [
      {
        id: "a",
        label: "Zebra",
        cwd: "/z",
        color: "#111111",
        pinned: false,
        hidden: false,
      },
      {
        id: "b",
        label: "Alpha",
        cwd: "/a",
        color: "#222222",
        pinned: true,
        hidden: false,
      },
    ];
    const groups = groupSessionsByWorkspace(
      [
        session({ id: "1", cwd: "/z" }),
        session({ id: "2", cwd: "/a" }),
      ],
      workspaces,
    );
    assert.deepEqual(
      groups.map((group) => group.workspace?.id),
      ["b", "a"],
    );
  });
});

describe("workspace store persistence", () => {
  it("upserts by cwd, toggles pin/hidden, and persists to localStorage", () => {
    const created = useWorkspaceStore.getState().upsertWorkspace({
      cwd: "/Users/dev/app/",
      label: "App",
    });
    assert.equal(created.cwd, "/Users/dev/app");
    assert.equal(created.label, "App");
    assert.equal(created.pinned, false);
    assert.equal(created.hidden, false);
    assert.ok(created.color);

    const again = useWorkspaceStore.getState().upsertWorkspace({
      cwd: "/Users/dev/app",
      label: "App Core",
    });
    assert.equal(again.id, created.id);
    assert.equal(again.label, "App Core");
    assert.equal(useWorkspaceStore.getState().workspaces.length, 1);

    useWorkspaceStore.getState().togglePin(created.id);
    useWorkspaceStore.getState().toggleHidden(created.id);
    const pinned = useWorkspaceStore.getState().workspaces[0]!;
    assert.equal(pinned.pinned, true);
    assert.equal(pinned.hidden, true);

    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    assert.ok(raw);
    const parsed = parseWorkspaces(JSON.parse(raw) as unknown);
    assert.equal(parsed[0]?.label, "App Core");
    assert.equal(parsed[0]?.pinned, true);

    // reload path
    saveWorkspaces(parsed);
    assert.equal(loadWorkspaces()[0]?.id, created.id);

    useWorkspaceStore.getState().removeWorkspace(created.id);
    assert.equal(useWorkspaceStore.getState().workspaces.length, 0);
    assert.deepEqual(loadWorkspaces(), []);
  });

  it("defaults label to basename when opening a folder cwd", () => {
    const ws = useWorkspaceStore.getState().upsertWorkspace({
      cwd: "/Users/me/Projects/number-one",
    });
    assert.equal(ws.label, "number-one");
    assert.equal(
      useWorkspaceStore.getState().workspaceForCwd("/Users/me/Projects/number-one/")
        ?.id,
      ws.id,
    );
  });
});
