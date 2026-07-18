import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { useLayoutStore } from "../src/app/layout-store.ts";
import { useSessionStore } from "../src/session/session-store.ts";

beforeEach(() => {
  useLayoutStore.setState({ drawer: null, pinned: [] });
  useSessionStore.setState({
    settings: null,
    sessions: [
      {
        id: "session-1",
        title: "omp-desktop",
        cwd: "/tmp/omp-desktop",
        profile: null,
        status: "ready",
      },
    ],
    activeSessionId: "session-1",
    transcripts: {},
    activity: {},
    todos: {},
    subagents: {},
    states: {},
    streaming: {},
  });
});

describe("layout store", () => {
  it("toggles drawers independently from pinned panels", () => {
    const store = useLayoutStore.getState();

    store.toggleDrawer("sessions");
    assert.equal(useLayoutStore.getState().drawer, "sessions");

    store.toggleDrawer("sessions");
    assert.equal(useLayoutStore.getState().drawer, null);

    store.togglePin("plan");
    assert.deepEqual(useLayoutStore.getState().pinned, ["plan"]);
    store.togglePin("plan");
    assert.deepEqual(useLayoutStore.getState().pinned, []);
  });
});

describe("session event reducer", () => {
  it("coalesces assistant text deltas into the current transcript item", () => {
    const store = useSessionStore.getState();

    store.applyOmpEvent("session-1", {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hel" },
    });
    store.applyOmpEvent("session-1", {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "lo" },
    });

    assert.deepEqual(useSessionStore.getState().transcripts["session-1"], [
      { id: "assistant-1", kind: "assistant", text: "Hello" },
    ]);
  });

  it("tracks tool lifecycle in transcript and activity", () => {
    const store = useSessionStore.getState();

    store.applyOmpEvent("session-1", {
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "read",
      args: { path: "src/App.tsx" },
    });
    store.applyOmpEvent("session-1", {
      type: "tool_execution_end",
      toolCallId: "tool-1",
      result: "done",
    });

    assert.deepEqual(useSessionStore.getState().transcripts["session-1"], [
      {
        id: "tool-1",
        kind: "tool",
        name: "read",
        detail: "done",
        status: "done",
      },
    ]);
    assert.deepEqual(
      useSessionStore.getState().activity["session-1"].map((item) => item.text),
      ["read started", "read completed"],
    );
  });

  it("tracks agent streaming and marks exited sessions", () => {
    const store = useSessionStore.getState();

    store.applyOmpEvent("session-1", { type: "agent_start" });
    assert.equal(useSessionStore.getState().streaming["session-1"], true);

    store.applyOmpEvent("session-1", { type: "agent_end" });
    assert.equal(useSessionStore.getState().streaming["session-1"], false);

    store.markExited("session-1");
    assert.equal(useSessionStore.getState().sessions[0]?.status, "exited");
    assert.equal(useSessionStore.getState().streaming["session-1"], false);
  });
});
