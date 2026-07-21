import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { LAYOUT_STORAGE_KEY, useLayoutStore } from "../src/app/layout-store.ts";
import {
  normalizeLocalCompanionUrl,
  parseSessionStats,
  projectKeyForSession,
  projectLabelForSession,
  readSessionRuntimeStatus,
  selectActiveTranscript,
  selectActiveTurnStats,
  useSessionStore,
} from "../src/session/session-store.ts";
import { api } from "../src/lib/tauri.ts";

beforeEach(() => {
  useLayoutStore.setState({ drawer: null, pinned: [], sessionsSidebarOpen: false });
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
  }
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
    modelRoles: [],
    modelRolesConfigPath: null,
    modelRoleScope: "global",
    activeSessionId: "session-1",
    transcripts: {},
    activity: {},
    todos: {},
    subagents: {},
    states: {},
    commandsBySession: {},
    turnStats: {},
    turnTiming: {},
    error: null,
    streaming: {},
    extensionUiRequests: {},
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

describe("session runtime status", () => {
  it("reads model, thinking, and context percent from a get_state envelope", () => {
    assert.deepEqual(
      readSessionRuntimeStatus({
        type: "response",
        success: true,
        data: {
          model: "claude-sonnet-4",
          thinkingLevel: "high",
          contextUsage: { percent: 42.4 },
        },
      }),
      {
        model: "claude-sonnet-4",
        modelId: "claude-sonnet-4",
        provider: null,
        thinkingLevel: "high",
        contextPercent: 42.4,
      },
    );
  });

  it("falls back to placeholders for missing or malformed runtime details", () => {
    assert.deepEqual(readSessionRuntimeStatus({ data: { contextUsage: {} } }), {
      model: null,
      modelId: null,
      provider: null,
      thinkingLevel: null,
      contextPercent: null,
    });
    assert.deepEqual(readSessionRuntimeStatus(null), {
      model: null,
      modelId: null,
      provider: null,
      thinkingLevel: null,
      contextPercent: null,
    });
  });
});

describe("session turn stats", () => {
  it("records lastTurnMs from turn_start/turn_end wall time", () => {
    const store = useSessionStore.getState();
    const originalNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      store.applyOmpEvent("session-1", { type: "turn_start" });
      assert.equal(useSessionStore.getState().turnTiming["session-1"], 1_000_000);

      now = 1_002_500;
      store.applyOmpEvent("session-1", { type: "turn_end" });

      const stats = useSessionStore.getState().turnStats["session-1"];
      assert.equal(stats?.lastTurnMs, 2500);
      assert.equal(useSessionStore.getState().turnTiming["session-1"], undefined);
      assert.deepEqual(selectActiveTurnStats(useSessionStore.getState()).lastTurnMs, 2500);
    } finally {
      Date.now = originalNow;
    }
  });

  it("records lastTurnMs from agent_start/agent_end and refreshes stats", async () => {
    const originalGetState = api.getState;
    const originalGetSessionStats = api.getSessionStats;
    const originalHousekeeping = api.postTurnHousekeeping;
    let statsCalls = 0;
    api.getState = async () => ({});
    api.postTurnHousekeeping = async () => {};
    api.getSessionStats = async () => {
      statsCalls += 1;
      return {
        type: "response",
        success: true,
        data: {
          tokens: { input: 100, output: 50, total: 150 },
          cost: 0.01,
        },
      };
    };

    const originalNow = Date.now;
    let now = 5_000;
    Date.now = () => now;

    try {
      const store = useSessionStore.getState();
      store.applyOmpEvent("session-1", { type: "agent_start" });
      now = 6_000;
      store.applyOmpEvent("session-1", { type: "agent_end" });

      assert.equal(useSessionStore.getState().turnStats["session-1"]?.lastTurnMs, 1000);

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      assert.equal(statsCalls, 1);
      const stats = useSessionStore.getState().turnStats["session-1"];
      assert.equal(stats?.inputTokens, 100);
      assert.equal(stats?.outputTokens, 50);
      assert.equal(stats?.costUsd, 0.01);
      assert.equal(stats?.tps, 50);
      assert.deepEqual(parseSessionStats({ data: { tokens: { input: 1, output: 2 } } }).totalTokens, 3);
    } finally {
      Date.now = originalNow;
      api.getState = originalGetState;
      api.getSessionStats = originalGetSessionStats;
      api.postTurnHousekeeping = originalHousekeeping;
    }
  });
});

describe("companion URL policy", () => {
  it("accepts only local HTTP companion URLs", () => {
    assert.equal(
      normalizeLocalCompanionUrl(" http://localhost:50099/compare?pick=a "),
      "http://localhost:50099/compare?pick=a",
    );
    assert.equal(
      normalizeLocalCompanionUrl("https://127.0.0.1:8443/"),
      "https://127.0.0.1:8443/",
    );
    assert.equal(
      normalizeLocalCompanionUrl("http://[::1]:5173/design"),
      "http://[::1]:5173/design",
    );

    for (const unsafe of [
      "javascript:alert(document.domain)",
      "data:text/html,<script>alert(1)</script>",
      "https://example.com",
      "http://localhost.evil.example",
      "http://user:secret@localhost:50099",
    ]) {
      assert.equal(normalizeLocalCompanionUrl(unsafe), null, unsafe);
    }
  });
});

describe("project identity", () => {
  it("uses a stable SSH host and remote root instead of the local stub", () => {
    const remoteSession = {
      id: "remote-1",
      title: "production",
      cwd: "/tmp/omp-desktop/remote-sessions/random-id",
      profile: null,
      status: "ready" as const,
      remote: {
        hostName: "production",
        host: "example.com",
        user: "deploy",
        port: 22,
        keyPath: null,
        remoteCwd: "/srv/apps/website",
        label: "deploy@example.com:/srv/apps/website",
      },
    };

    assert.equal(
      projectKeyForSession(remoteSession),
      "ssh://production/srv/apps/website",
    );
    assert.equal(projectLabelForSession(remoteSession), "production:website");
    assert.equal(
      projectKeyForSession({
        ...remoteSession,
        id: "remote-2",
        cwd: "/tmp/omp-desktop/remote-sessions/another-id",
      }),
      "ssh://production/srv/apps/website",
    );
  });

  it("normalizes local project paths across platforms", () => {
    const localSession = {
      id: "local-1",
      title: "project",
      cwd: String.raw`C:\Users\dev\project`,
      profile: null,
      status: "ready" as const,
    };
    assert.equal(projectKeyForSession(localSession), "C:/Users/dev/project");
    assert.equal(projectLabelForSession(localSession), "project");
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

  it("omits absent optional metadata from completed assistant messages", () => {
    useSessionStore.getState().applyOmpEvent("session-1", {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Complete" }],
      },
    });

    assert.deepEqual(useSessionStore.getState().transcripts["session-1"], [
      { id: "assistant-1", kind: "assistant", text: "Complete" },
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

    const toolItem = useSessionStore.getState().transcripts["session-1"]?.[0];
    assert.equal(toolItem?.kind, "tool");
    if (toolItem?.kind !== "tool") throw new Error("expected tool item");
    assert.equal(toolItem.id, "tool-1");
    assert.equal(toolItem.name, "read");
    assert.equal(toolItem.detail, "done");
    assert.equal(toolItem.status, "done");
    assert.ok(toolItem.parsed);
    assert.equal(toolItem.parsed?.kind, "read");
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

  it("keeps streaming through an agent_end that will continue", async () => {
    const originalGetState = api.getState;
    const originalHousekeeping = api.postTurnHousekeeping;
    let refreshes = 0;
    let housekeepingRuns = 0;
    api.getState = async () => {
      refreshes += 1;
      return {};
    };
    api.postTurnHousekeeping = async () => {
      housekeepingRuns += 1;
    };

    try {
      const store = useSessionStore.getState();
      store.applyOmpEvent("session-1", { type: "agent_start" });
      store.applyOmpEvent("session-1", {
        type: "agent_end",
        willContinue: true,
        messages: [],
        messageCount: 1,
      });
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      api.getState = originalGetState;
      api.postTurnHousekeeping = originalHousekeeping;
    }

    assert.equal(useSessionStore.getState().streaming["session-1"], true);
    assert.equal(refreshes, 0);
    assert.equal(housekeepingRuns, 0);
  });

  it("surfaces RPC transport error frames", () => {
    useSessionStore.getState().applyOmpEvent("session-1", {
      type: "rpc_frame_error",
      originalType: "agent_end",
      error: "RPC frame exceeded the transport limit",
    });

    const state = useSessionStore.getState();
    assert.equal(
      state.error,
      "OMP RPC transport error: RPC frame exceeded the transport limit",
    );
    assert.deepEqual(
      state.activity["session-1"].map((item) => item.text),
      ["RPC transport error · agent_end"],
    );
  });
  it("queues extension UI approvals and returns the selected response", async () => {
    const originalRespond = api.respondExtensionUi;
    const responses: unknown[] = [];
    api.respondExtensionUi = async (sessionId, requestId, response) => {
      responses.push({ sessionId, requestId, response });
    };

    try {
      useSessionStore.getState().applyOmpEvent("session-1", {
        type: "extension_ui_request",
        id: "approval-1",
        method: "select",
        title: "Run bash?",
        options: ["Approve", "Deny"],
      });
      assert.deepEqual(
        useSessionStore.getState().extensionUiRequests["session-1"],
        [
          {
            id: "approval-1",
            method: "select",
            title: "Run bash?",
            message: undefined,
            placeholder: undefined,
            prefill: undefined,
            options: ["Approve", "Deny"],
            timeout: undefined,
            targetId: undefined,
            url: undefined,
            launchUrl: undefined,
            instructions: undefined,
            notifyType: undefined,
            statusKey: undefined,
            statusText: undefined,
            text: undefined,
          },
        ],
      );

      const answered = await useSessionStore
        .getState()
        .respondExtensionUi("session-1", "approval-1", { value: "Approve" });
      assert.equal(answered, true);
    } finally {
      api.respondExtensionUi = originalRespond;
    }

    assert.deepEqual(responses, [
      {
        sessionId: "session-1",
        requestId: "approval-1",
        response: { value: "Approve" },
      },
    ]);
    assert.deepEqual(
      useSessionStore.getState().extensionUiRequests["session-1"],
      [],
    );
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

  it("loads and merges host slash commands per session", async () => {
    const originalGetAvailableCommands = api.getAvailableCommands;
    api.getAvailableCommands = async (sessionId) => {
      assert.equal(sessionId, "session-1");
      return {
        type: "response",
        success: true,
        data: {
          commands: [
            { name: "help", description: "Show help" },
            { name: "compact", description: "from omp" },
          ],
        },
      };
    };

    try {
      await useSessionStore.getState().loadAvailableCommands("session-1");
    } finally {
      api.getAvailableCommands = originalGetAvailableCommands;
    }

    assert.deepEqual(useSessionStore.getState().commandsBySession["session-1"], [
      {
        name: "compact",
        description: "Compact session context",
        source: "host",
      },
      { name: "export", description: "Export session HTML", source: "host" },
      { name: "help", description: "Show help", source: "omp" },
    ]);
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

  it("preserves the SSH identity when restarting a remote session", async () => {
    const originalCloseSession = api.closeSession;
    const originalCreateSshSession = api.createSshSession;
    const requestedTargets: Parameters<typeof api.createSshSession>[0][] = [];
    api.closeSession = async () => {};
    api.createSshSession = async (remote) => {
      requestedTargets.push(remote);
      return {
        id: "session-restarted",
        title: "remote-project",
        cwd: "/tmp/remote-session",
        profile: null,
        status: "ready",
        remote: {
          ...remote,
          label: "deploy@example.com:/srv/project",
        },
      };
    };
    useSessionStore.setState((state) => ({
      sessions: [
        {
          ...state.sessions[0],
          remote: {
            hostName: "production",
            host: "example.com",
            user: "deploy",
            port: 2222,
            keyPath: "/Users/test/.ssh/deploy_ed25519",
            remoteCwd: "/srv/project",
            label: "deploy@example.com:/srv/project",
          },
        },
      ],
    }));

    try {
      await useSessionStore.getState().restartSession("session-1");
    } finally {
      api.closeSession = originalCloseSession;
      api.createSshSession = originalCreateSshSession;
    }

    assert.deepEqual(requestedTargets, [
      {
        hostName: "production",
        host: "example.com",
        user: "deploy",
        port: 2222,
        keyPath: "/Users/test/.ssh/deploy_ed25519",
        remoteCwd: "/srv/project",
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

  it("subscribes to events before loading subagents", async () => {
    const originalSetSubagentSubscription = api.setSubagentSubscription;
    const originalRpcCommand = api.rpcCommand;
    const commands: string[] = [];
    api.setSubagentSubscription = async (_sessionId, level) => {
      commands.push(`set_subagent_subscription:${level}`);
      return {};
    };
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
      api.setSubagentSubscription = originalSetSubagentSubscription;
      api.rpcCommand = originalRpcCommand;
    }

    assert.deepEqual(commands, [
      "set_subagent_subscription:events",
      "get_subagents",
    ]);
    assert.deepEqual(useSessionStore.getState().subagents["session-1"], [
      {
        id: "agent-1",
        name: "Explorer",
        status: "running",
        progress: "Tracing state",
        parentId: null,
        sessionFile: null,
        currentTool: null,
      },
    ]);
  });

  it("falls back to progress subscription when events fail", async () => {
    const originalSetSubagentSubscription = api.setSubagentSubscription;
    const originalRpcCommand = api.rpcCommand;
    const commands: string[] = [];
    api.setSubagentSubscription = async (_sessionId, level) => {
      commands.push(`set_subagent_subscription:${level}`);
      if (level === "events") {
        throw new Error("events unsupported");
      }
      return {};
    };
    api.rpcCommand = async (_sessionId, command) => {
      commands.push(command);
      return command === "get_subagents"
        ? {
            type: "response",
            success: true,
            data: { subagents: [] },
          }
        : {};
    };

    try {
      await useSessionStore.getState().loadSubagents("session-1");
    } finally {
      api.setSubagentSubscription = originalSetSubagentSubscription;
      api.rpcCommand = originalRpcCommand;
    }

    assert.deepEqual(commands, [
      "set_subagent_subscription:events",
      "set_subagent_subscription:progress",
      "get_subagents",
    ]);
  });

  it("projects current subagent lifecycle and progress frames", () => {
    const apply = useSessionStore.getState().applyOmpEvent;
    apply("session-1", {
      type: "subagent_lifecycle",
      payload: {
        id: "agent-7",
        agent: "code-reviewer",
        status: "started",
        index: 0,
        parentId: "root-1",
        sessionFile: "/tmp/agent-7.jsonl",
      },
    });
    apply("session-1", {
      type: "subagent_progress",
      payload: {
        agent: "code-reviewer",
        task: "Review compatibility patch",
        progress: {
          id: "agent-7",
          status: "running",
          lastIntent: "Tracing RPC events",
          toolCount: 3,
          tokens: 1200,
          currentTool: "read",
        },
      },
    });
    apply("session-1", {
      type: "subagent_lifecycle",
      payload: {
        id: "agent-7",
        agent: "code-reviewer",
        status: "completed",
        index: 0,
      },
    });

    assert.deepEqual(useSessionStore.getState().subagents["session-1"], [
      {
        id: "agent-7",
        name: "code-reviewer",
        agent: "code-reviewer",
        status: "completed",
        progress: "Tracing RPC events",
        parentId: "root-1",
        sessionFile: "/tmp/agent-7.jsonl",
        toolCount: 3,
        tokens: 1200,
        currentTool: "read",
        lastIntent: "Tracing RPC events",
      },
    ]);
  });

  it("upserts subagent identity from subagent_event frames", () => {
    const apply = useSessionStore.getState().applyOmpEvent;
    apply("session-1", {
      type: "subagent_event",
      payload: {
        id: "agent-9",
        agent: "scout",
        status: "running",
        event: "tool_execution_start",
        currentTool: "grep",
        parentId: "root-2",
        sessionFile: "/tmp/agent-9.jsonl",
      },
    });

    const state = useSessionStore.getState();
    assert.deepEqual(state.subagents["session-1"], [
      {
        id: "agent-9",
        name: "scout",
        agent: "scout",
        status: "running",
        progress: "grep",
        parentId: "root-2",
        sessionFile: "/tmp/agent-9.jsonl",
        currentTool: "grep",
      },
    ]);
    assert.match(
      state.activity["session-1"].at(-1)?.text ?? "",
      /scout · tool_execution_start · grep/,
    );
  });

  it("loads subagent messages through the session store", async () => {
    const originalGetSubagentMessages = api.getSubagentMessages;
    const calls: unknown[] = [];
    api.getSubagentMessages = async (sessionId, params) => {
      calls.push({ sessionId, params });
      return { messages: [{ role: "assistant", text: "hello" }] };
    };

    try {
      const response = await useSessionStore
        .getState()
        .loadSubagentMessages("session-1", {
          subagentId: "agent-9",
          sessionFile: "/tmp/agent-9.jsonl",
          fromByte: 0,
        });
      assert.deepEqual(response, {
        messages: [{ role: "assistant", text: "hello" }],
      });
    } finally {
      api.getSubagentMessages = originalGetSubagentMessages;
    }

    assert.deepEqual(calls, [
      {
        sessionId: "session-1",
        params: {
          subagentId: "agent-9",
          sessionFile: "/tmp/agent-9.jsonl",
          fromByte: 0,
        },
      },
    ]);
  });

  it("projects current session status events", () => {
    useSessionStore.setState({
      states: {
        "session-1": {
          thinkingLevel: "low",
          isCompacting: false,
        },
      },
    });
    const apply = useSessionStore.getState().applyOmpEvent;
    apply("session-1", {
      type: "thinking_level_changed",
      thinkingLevel: "xhigh",
    });
    apply("session-1", {
      type: "auto_compaction_start",
      action: "shake",
      reason: "threshold",
    });
    apply("session-1", {
      type: "notice",
      level: "warning",
      message: "Provider is approaching its quota.",
    });

    let state = useSessionStore.getState();
    assert.deepEqual(state.states["session-1"], {
      thinkingLevel: "xhigh",
      isCompacting: true,
    });
    assert.equal(
      state.activity["session-1"].at(-1)?.text,
      "Provider is approaching its quota.",
    );

    apply("session-1", {
      type: "auto_compaction_end",
      action: "shake",
      aborted: false,
      willRetry: false,
    });
    state = useSessionStore.getState();
    assert.equal(
      (state.states["session-1"] as { isCompacting?: boolean }).isCompacting,
      false,
    );
  });

  it("loads and updates model roles in the active project scope", async () => {
    const originalGetModelRoles = api.getModelRoles;
    const originalSetModelRole = api.setModelRole;
    const requests: unknown[] = [];
    api.getModelRoles = async (cwd) => {
      requests.push({ command: "get", cwd });
      return {
        configPath: "/tmp/omp-desktop/.omp/config.yml",
        scope: "project",
        roles: [
          {
            role: "default",
            selector: "anthropic/claude-opus:high",
            shortLabel: "anthropic/claude-opus:high",
            source: "project",
          },
        ],
      };
    };
    api.setModelRole = async (role, selector, cwd) => {
      requests.push({ command: "set", role, selector, cwd });
      return {
        configPath: "/tmp/omp-desktop/.omp/config.yml",
        scope: "project",
        roles: [
          {
            role,
            selector,
            shortLabel: selector,
            source: "project",
          },
        ],
      };
    };

    try {
      await useSessionStore.getState().loadModelRoles();
      await useSessionStore
        .getState()
        .setModelRole("default", "openai-codex/gpt-5.6:high");
    } finally {
      api.getModelRoles = originalGetModelRoles;
      api.setModelRole = originalSetModelRole;
    }

    assert.deepEqual(requests, [
      { command: "get", cwd: "/tmp/omp-desktop" },
      {
        command: "set",
        role: "default",
        selector: "openai-codex/gpt-5.6:high",
        cwd: "/tmp/omp-desktop",
      },
    ]);
    const state = useSessionStore.getState();
    assert.equal(state.modelRoleScope, "project");
    assert.equal(state.modelRoles[0]?.source, "project");
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
      commandsBySession: {
        "session-1": [{ name: "help", source: "omp" }],
        "session-2": [{ name: "export", source: "host" }],
      },
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
      state.commandsBySession,
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

describe("typed rpc helpers", () => {
  it("exposes stock rpc_command helpers on api", () => {
    assert.equal(typeof api.getAvailableCommands, "function");
    assert.equal(typeof api.getSessionStats, "function");
    assert.equal(typeof api.compactSession, "function");
    assert.equal(typeof api.exportSessionHtml, "function");
    assert.equal(typeof api.setSubagentSubscription, "function");
    assert.equal(typeof api.getSubagentMessages, "function");
    assert.equal(typeof api.getLoginProviders, "function");
    assert.equal(typeof api.loginProvider, "function");
  });
});
