import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HOST_SLASH_COMMANDS,
  extractSlashState,
  filterSlashCommands,
  mergeSlashCommands,
  normalizeCommandsPayload,
  type SlashCommand,
} from "../src/session/slash.ts";

describe("normalizeCommandsPayload", () => {
  it("reads data.commands object envelopes", () => {
    assert.deepEqual(
      normalizeCommandsPayload({
        type: "response",
        success: true,
        data: {
          commands: [
            { name: "help", description: "Show help" },
            { name: "/model", description: "Pick a model" },
          ],
        },
      }),
      [
        { name: "help", description: "Show help", source: "omp" },
        { name: "model", description: "Pick a model", source: "omp" },
      ],
    );
  });

  it("accepts bare string arrays and alternate envelopes", () => {
    assert.deepEqual(normalizeCommandsPayload(["/compact", "export"]), [
      { name: "compact", source: "omp" },
      { name: "export", source: "omp" },
    ]);
    assert.deepEqual(
      normalizeCommandsPayload({
        commands: [{ command: "diff", detail: "Show diff" }],
      }),
      [{ name: "diff", description: "Show diff", source: "omp" }],
    );
    assert.deepEqual(
      normalizeCommandsPayload({
        data: [{ id: "clear", summary: "Clear context" }],
      }),
      [{ name: "clear", description: "Clear context", source: "omp" }],
    );
  });

  it("dedupes by name and ignores malformed entries", () => {
    assert.deepEqual(
      normalizeCommandsPayload({
        data: {
          commands: [
            { name: "help" },
            { name: "Help", description: "later" },
            null,
            42,
            { description: "no name" },
            "",
          ],
        },
      }),
      [{ name: "help", source: "omp" }],
    );
    assert.deepEqual(normalizeCommandsPayload(null), []);
    assert.deepEqual(normalizeCommandsPayload({}), []);
  });
});

describe("filterSlashCommands", () => {
  const commands: SlashCommand[] = [
    { name: "compact", description: "Compact session context", source: "host" },
    { name: "export", description: "Export session HTML", source: "host" },
    { name: "help", description: "Show available commands", source: "omp" },
    { name: "model", description: "Select model", source: "omp" },
  ];

  it("returns all commands for an empty query", () => {
    assert.deepEqual(filterSlashCommands(commands, ""), commands);
    assert.deepEqual(filterSlashCommands(commands, "   "), commands);
  });

  it("matches name prefix, name includes, then description", () => {
    assert.deepEqual(
      filterSlashCommands(commands, "exp").map((c) => c.name),
      ["export"],
    );
    assert.deepEqual(
      filterSlashCommands(commands, "port").map((c) => c.name),
      ["export"],
    );
    // description substring — "session" hits both host command blurbs
    assert.deepEqual(
      filterSlashCommands(commands, "session").map((c) => c.name),
      ["compact", "export"],
    );
    // prefix beats description: "ex" is a prefix of export and appears in "context"
    assert.deepEqual(
      filterSlashCommands(commands, "ex").map((c) => c.name),
      ["export", "compact"],
    );
  });

  it("is case-insensitive", () => {
    assert.deepEqual(
      filterSlashCommands(commands, "HELP").map((c) => c.name),
      ["help"],
    );
  });
});

describe("extractSlashState", () => {
  it("activates at draft start and after whitespace", () => {
    assert.deepEqual(extractSlashState("/", 1), {
      active: true,
      query: "",
      start: 0,
    });
    assert.deepEqual(extractSlashState("/he", 3), {
      active: true,
      query: "he",
      start: 0,
    });
    assert.deepEqual(extractSlashState("please /mod", 11), {
      active: true,
      query: "mod",
      start: 7,
    });
    assert.deepEqual(extractSlashState("line\n/ex", 8), {
      active: true,
      query: "ex",
      start: 5,
    });
  });

  it("deactivates once the token contains whitespace or is mid-word", () => {
    assert.equal(extractSlashState("/help me", 8), null);
    assert.equal(extractSlashState("foo/bar", 7), null);
    assert.equal(extractSlashState("no slash", 4), null);
    assert.equal(extractSlashState("/help", 0), null);
  });

  it("uses the cursor position, not the full draft", () => {
    assert.deepEqual(extractSlashState("/help and more", 5), {
      active: true,
      query: "help",
      start: 0,
    });
    assert.equal(extractSlashState("/help and more", 6), null);
  });
});

describe("mergeSlashCommands", () => {
  it("prefers host commands and keeps HOST_SLASH_COMMANDS complete", () => {
    assert.equal(HOST_SLASH_COMMANDS.length, 2);
    assert.deepEqual(
      mergeSlashCommands(HOST_SLASH_COMMANDS, [
        { name: "compact", description: "from omp", source: "omp" },
        { name: "help", description: "Show help", source: "omp" },
      ]),
      [
        {
          name: "compact",
          description: "Compact session context",
          source: "host",
        },
        { name: "export", description: "Export session HTML", source: "host" },
        { name: "help", description: "Show help", source: "omp" },
      ],
    );
  });
});
