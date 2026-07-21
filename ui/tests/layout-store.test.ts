import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  LAYOUT_STORAGE_KEY,
  loadLayoutState,
  parseLayoutState,
  saveLayoutState,
  useLayoutStore,
} from "../src/app/layout-store.ts";

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

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage(),
  });
  useLayoutStore.setState({
    drawer: null,
    pinned: [],
    sessionsSidebarOpen: false,
  });
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
});

describe("parseLayoutState", () => {
  it("returns empty for null, empty, and invalid JSON", () => {
    assert.deepEqual(parseLayoutState(null), {});
    assert.deepEqual(parseLayoutState(""), {});
    assert.deepEqual(parseLayoutState("not-json"), {});
    assert.deepEqual(parseLayoutState("[]"), {});
    assert.deepEqual(parseLayoutState("null"), {});
  });

  it("hydrates valid fields and drops invalid panel ids", () => {
    const parsed = parseLayoutState(
      JSON.stringify({
        drawer: "terminal",
        pinned: ["plan", "not-a-panel", "review", 42],
        sessionsSidebarOpen: true,
        extra: "ignored",
      }),
    );
    assert.deepEqual(parsed, {
      drawer: "terminal",
      pinned: ["plan", "review"],
      sessionsSidebarOpen: true,
    });
  });

  it("accepts null drawer and ignores bad drawer values", () => {
    assert.deepEqual(
      parseLayoutState(JSON.stringify({ drawer: null, pinned: ["plan"] })),
      { drawer: null, pinned: ["plan"] },
    );
    assert.deepEqual(
      parseLayoutState(
        JSON.stringify({ drawer: "bogus", sessionsSidebarOpen: false }),
      ),
      { sessionsSidebarOpen: false },
    );
  });
});

describe("layout store persistence", () => {
  it("writes pinned, drawer, and sessionsSidebarOpen on each change", () => {
    useLayoutStore.getState().togglePin("plan");
    useLayoutStore.getState().openDrawer("terminal");
    useLayoutStore.getState().setSessionsSidebarOpen(true);

    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    assert.ok(raw);
    assert.deepEqual(JSON.parse(raw), {
      drawer: "terminal",
      pinned: ["plan"],
      sessionsSidebarOpen: true,
    });
  });

  it("round-trips through parse + save + load", () => {
    const state = {
      drawer: "settings" as const,
      pinned: ["activity", "review"] as const,
      sessionsSidebarOpen: true,
    };
    saveLayoutState({
      drawer: state.drawer,
      pinned: [...state.pinned],
      sessionsSidebarOpen: state.sessionsSidebarOpen,
    });

    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    assert.ok(raw);
    const parsed = parseLayoutState(raw);
    assert.deepEqual(parsed, {
      drawer: "settings",
      pinned: ["activity", "review"],
      sessionsSidebarOpen: true,
    });
    assert.deepEqual(loadLayoutState(), parsed);
  });

  it("toggles drawer and pin without clobbering sibling fields", () => {
    useLayoutStore.getState().togglePin("plan");
    useLayoutStore.getState().setSessionsSidebarOpen(true);
    useLayoutStore.getState().toggleDrawer("sessions");
    assert.equal(useLayoutStore.getState().drawer, "sessions");
    useLayoutStore.getState().toggleDrawer("sessions");
    assert.equal(useLayoutStore.getState().drawer, null);
    assert.deepEqual(useLayoutStore.getState().pinned, ["plan"]);
    assert.equal(useLayoutStore.getState().sessionsSidebarOpen, true);

    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    assert.ok(raw);
    assert.deepEqual(JSON.parse(raw), {
      drawer: null,
      pinned: ["plan"],
      sessionsSidebarOpen: true,
    });
  });
});
