import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAttentionInbox,
  classifyExtensionRequest,
} from "../src/session/attention.ts";
import type { ExtensionUiRequest, SessionInfo } from "../src/session/types.ts";

const session = (
  overrides: Partial<SessionInfo> = {},
): SessionInfo => ({
  id: "session-1",
  title: "Alpha",
  cwd: "/tmp/alpha",
  profile: null,
  status: "ready",
  ...overrides,
});

const request = (
  overrides: Partial<ExtensionUiRequest> & Pick<ExtensionUiRequest, "id" | "method">,
): ExtensionUiRequest => ({
  ...overrides,
});

describe("classifyExtensionRequest", () => {
  it("classifies confirm as confirmation or approval", () => {
    assert.equal(
      classifyExtensionRequest(
        request({ id: "c1", method: "confirm", title: "Continue?" }),
      ),
      "confirmation",
    );
    assert.equal(
      classifyExtensionRequest(
        request({
          id: "c2",
          method: "confirm",
          title: "Approve shell command",
          message: "npm install",
        }),
      ),
      "approval",
    );
  });

  it("classifies select as question and input/editor as input", () => {
    assert.equal(
      classifyExtensionRequest(
        request({
          id: "s1",
          method: "select",
          title: "Pick one",
          options: ["a", "b"],
        }),
      ),
      "question",
    );
    assert.equal(
      classifyExtensionRequest(
        request({ id: "i1", method: "input", placeholder: "Name" }),
      ),
      "input",
    );
    assert.equal(
      classifyExtensionRequest(
        request({ id: "e1", method: "editor", title: "Edit draft" }),
      ),
      "input",
    );
  });

  it("classifies notify error as failed and skips cancel/open_url", () => {
    assert.equal(
      classifyExtensionRequest(
        request({
          id: "n1",
          method: "notify",
          notifyType: "error",
          message: "Boom",
        }),
      ),
      "failed",
    );
    assert.equal(
      classifyExtensionRequest(
        request({ id: "n2", method: "notify", notifyType: "info" }),
      ),
      null,
    );
    assert.equal(
      classifyExtensionRequest(request({ id: "x1", method: "cancel" })),
      null,
    );
    assert.equal(
      classifyExtensionRequest(
        request({ id: "x2", method: "open_url", url: "https://example.com" }),
      ),
      null,
    );
  });
});

describe("buildAttentionInbox", () => {
  it("aggregates two sessions in session then request order", () => {
    const sessions = [
      session({ id: "a", title: "Alpha" }),
      session({ id: "b", title: "Beta" }),
    ];
    const items = buildAttentionInbox({
      sessions,
      extensionUiRequests: {
        a: [
          request({ id: "r1", method: "confirm", title: "OK?" }),
          request({ id: "r2", method: "select", title: "Which?" }),
        ],
        b: [request({ id: "r3", method: "input", title: "Name" })],
      },
    });

    assert.deepEqual(
      items.map((item) => item.key),
      ["a:r1", "a:r2", "b:r3"],
    );
    assert.equal(items[0]?.sessionTitle, "Alpha");
    assert.equal(items[0]?.kind, "confirmation");
    assert.equal(items[1]?.kind, "question");
    assert.equal(items[2]?.sessionTitle, "Beta");
    assert.equal(items[2]?.kind, "input");
  });

  it("dedupes the same key", () => {
    const sessions = [session({ id: "a", title: "Alpha" })];
    const dup = request({ id: "r1", method: "confirm", title: "OK?" });
    const items = buildAttentionInbox({
      sessions,
      extensionUiRequests: {
        a: [dup, { ...dup }, dup],
      },
    });

    assert.equal(items.length, 1);
    assert.equal(items[0]?.key, "a:r1");
  });

  it("skips non-inbox methods while keeping actionable prompts", () => {
    const items = buildAttentionInbox({
      sessions: [session()],
      extensionUiRequests: {
        "session-1": [
          request({ id: "skip-1", method: "cancel" }),
          request({ id: "skip-2", method: "open_url", url: "https://x.test" }),
          request({ id: "keep", method: "confirm", message: "Proceed?" }),
        ],
      },
    });

    assert.deepEqual(
      items.map((item) => item.requestId),
      ["keep"],
    );
    assert.equal(items[0]?.detail, "Proceed?");
  });
});
