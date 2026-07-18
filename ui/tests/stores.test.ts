import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { useLayoutStore } from "../src/app/layout-store.ts";
import {
  selectActiveTranscript,
  useSessionStore,
} from "../src/session/session-store.ts";
import { api } from "../src/lib/tauri.ts";

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
    error: null,
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

describe("session commands", () => {
  it("creates a folder session and initializes its live state", async () => {
    const originalCreateSession = api.createSession;
    api.createSession = async (cwd) => ({
      id: "session-2",
      title: "second-project",
      cwd,
      profile: null,
      status: "ready",
    });

    try {
      await useSessionStore.getState().openFolder("/tmp/second-project");
    } finally {
      api.createSession = originalCreateSession;
    }

    const state = useSessionStore.getState();
    assert.equal(state.activeSessionId, "session-2");
    assert.deepEqual(state.transcripts["session-2"], []);
    assert.deepEqual(state.activity["session-2"], []);
    assert.deepEqual(state.todos["session-2"], []);
    assert.deepEqual(state.subagents["session-2"], []);
    assert.equal(state.streaming["session-2"], false);
  });

  it("passes a resume id or path when creating a session", async () => {
    const originalCreateSession = api.createSession;
    const requests: Array<{ cwd: string; resume?: string }> = [];
    api.createSession = async (cwd, resume) => {
      requests.push({ cwd, resume });
      return {
        id: "session-resumed",
        title: "resumed-project",
        cwd,
        profile: null,
        status: "ready",
      };
    };

    try {
      await useSessionStore
        .getState()
        .openFolder("/tmp/resumed-project", "session-history.jsonl");
    } finally {
      api.createSession = originalCreateSession;
    }

    assert.deepEqual(requests, [
      {
        cwd: "/tmp/resumed-project",
        resume: "session-history.jsonl",
      },
    ]);
  });

  it("maps get_state todo phases into the active session plan", async () => {
    const originalGetState = api.getState;
    api.getState = async () => ({
      type: "response",
      success: true,
      data: {
        todoPhases: [
          {
            id: "phase-1",
            name: "Build",
            tasks: [
              { id: "task-1", content: "Wire panels", status: "in_progress" },
            ],
          },
        ],
      },
    });
    try {
      await useSessionStore.getState().refreshState("session-1");
    } finally {
      api.getState = originalGetState;
    }

    assert.deepEqual(useSessionStore.getState().todos["session-1"], [
      {
        id: "phase-1",
        name: "Build",
        tasks: [
          { id: "task-1", content: "Wire panels", status: "in_progress" },
        ],
      },
    ]);
  });

  it("refreshes state after an agent run ends", async () => {
    const originalGetState = api.getState;
    let refreshes = 0;
    api.getState = async () => {
      refreshes += 1;
      return { todoPhases: [] };
    };

    try {
      useSessionStore
        .getState()
        .applyOmpEvent("session-1", { type: "agent_end" });
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      api.getState = originalGetState;
    }

    assert.equal(refreshes, 1);
  });

  it("subscribes to progress before loading subagents", async () => {
    const originalRpcCommand = api.rpcCommand;
    const commands: string[] = [];
    api.rpcCommand = async (_sessionId, command) => {
      commands.push(command);
      return command === "get_subagents"
        ? {
            type: "response",
            success: true,
            data: {
              subagents: [
                {
                  id: "agent-1",
                  name: "Explorer",
                  status: "running",
                  progress: "Tracing state",
                },
              ],
            },
          }
        : {};
    };

    try {
      await useSessionStore.getState().loadSubagents("session-1");
    } finally {
      api.rpcCommand = originalRpcCommand;
    }

    assert.deepEqual(commands, [
      "set_subagent_subscription",
      "get_subagents",
    ]);
    assert.deepEqual(useSessionStore.getState().subagents["session-1"], [
      {
        id: "agent-1",
        name: "Explorer",
        status: "running",
        progress: "Tracing state",
      },
    ]);
  });

  it("saves settings and keeps the live store in sync", async () => {
    const originalSaveSettings = api.saveSettings;
    const saved: unknown[] = [];
    api.saveSettings = async (settings) => {
      saved.push(settings);
    };
    const settings = {
      approvalMode: "write" as const,
      ompBinary: "/usr/local/bin/omp",
      defaultModel: "opus",
      defaultThinking: "high",
      defaultProfile: "work",
      theme: "dark",
    };

    try {
      const didSave = await useSessionStore.getState().saveSettings(settings);
      assert.equal(didSave, true);
    } finally {
      api.saveSettings = originalSaveSettings;
    }

    assert.deepEqual(saved, [settings]);
    assert.deepEqual(useSessionStore.getState().settings, settings);
  });

  it("selects only the active session transcript", () => {
    useSessionStore.setState((state) => ({
      sessions: [
        ...state.sessions,
        {
          id: "session-2",
          title: "second-project",
          cwd: "/tmp/second-project",
          profile: null,
          status: "ready",
        },
      ],
      transcripts: {
        "session-1": [{ id: "user-1", kind: "user", text: "First tab" }],
        "session-2": [{ id: "user-1", kind: "user", text: "Second tab" }],
      },
    }));

    useSessionStore.getState().setActive("session-2");
    assert.deepEqual(
      selectActiveTranscript(useSessionStore.getState()),
      [{ id: "user-1", kind: "user", text: "Second tab" }],
    );

    useSessionStore.getState().setActive("session-1");
    assert.deepEqual(
      selectActiveTranscript(useSessionStore.getState()),
      [{ id: "user-1", kind: "user", text: "First tab" }],
    );
  });

  it("closes an active session and removes all of its local state", async () => {
    const originalCloseSession = api.closeSession;
    const closed: string[] = [];
    api.closeSession = async (sessionId) => {
      closed.push(sessionId);
    };
    useSessionStore.setState((state) => ({
      sessions: [
        ...state.sessions,
        {
          id: "session-2",
          title: "second-project",
          cwd: "/tmp/second-project",
          profile: null,
          status: "ready",
        },
      ],
      transcripts: { "session-1": [], "session-2": [] },
      activity: { "session-1": [], "session-2": [] },
      todos: { "session-1": [], "session-2": [] },
      subagents: { "session-1": [], "session-2": [] },
      states: { "session-1": {}, "session-2": {} },
      streaming: { "session-1": true, "session-2": false },
    }));

    try {
      await useSessionStore.getState().closeSession("session-1");
    } finally {
      api.closeSession = originalCloseSession;
    }

    const state = useSessionStore.getState();
    assert.deepEqual(closed, ["session-1"]);
    assert.deepEqual(state.sessions.map((session) => session.id), ["session-2"]);
    assert.equal(state.activeSessionId, "session-2");
    for (const sessionState of [
      state.transcripts,
      state.activity,
      state.todos,
      state.subagents,
      state.states,
      state.streaming,
    ]) {
      assert.equal("session-1" in sessionState, false);
    }
  });

  it("ignores late events after a session tab closes", async () => {
    const originalCloseSession = api.closeSession;
    api.closeSession = async () => {};

    try {
      await useSessionStore.getState().closeSession("session-1");
    } finally {
      api.closeSession = originalCloseSession;
    }

    const store = useSessionStore.getState();
    store.applyOmpEvent("session-1", {
      type: "tool_execution_start",
      toolCallId: "late-tool",
      toolName: "read",
    });
    store.markExited("session-1");

    const state = useSessionStore.getState();
    assert.equal("session-1" in state.transcripts, false);
    assert.equal("session-1" in state.activity, false);
    assert.equal("session-1" in state.streaming, false);
  });

  it("removes an already-dead session locally without reporting an error", async () => {
    const originalCloseSession = api.closeSession;
    api.closeSession = async () => {
      throw new Error("session not found: session-1");
    };

    try {
      await useSessionStore.getState().closeSession("session-1");
    } finally {
      api.closeSession = originalCloseSession;
    }

    const state = useSessionStore.getState();
    assert.deepEqual(state.sessions, []);
    assert.equal(state.activeSessionId, null);
    assert.equal(state.error, null);
  });

  it("removes local state but reports other close failures", async () => {
    const originalCloseSession = api.closeSession;
    api.closeSession = async () => {
      throw new Error("transport unavailable");
    };

    try {
      await useSessionStore.getState().closeSession("session-1");
    } finally {
      api.closeSession = originalCloseSession;
    }

    const state = useSessionStore.getState();
    assert.deepEqual(state.sessions, []);
    assert.equal(state.activeSessionId, null);
    assert.equal(state.error, "Unable to close session: transport unavailable");
  });

  it("records prompt failures in the active transcript", async () => {
    const originalPrompt = api.prompt;
    api.prompt = async () => {
      throw new Error("rpc unavailable");
    };

    try {
      await useSessionStore.getState().send("Hello");
    } finally {
      api.prompt = originalPrompt;
    }

    assert.deepEqual(useSessionStore.getState().transcripts["session-1"], [
      { id: "user-1", kind: "user", text: "Hello" },
      {
        id: "system-1",
        kind: "system",
        text: "Unable to send message: rpc unavailable",
      },
    ]);
  });
});
