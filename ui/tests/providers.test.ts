import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeLoginProviders } from "../src/session/providers.ts";

describe("normalizeLoginProviders", () => {
  it("reads providers from data.providers envelopes", () => {
    assert.deepEqual(
      normalizeLoginProviders({
        data: {
          providers: [
            { id: "openai", name: "OpenAI", authenticated: true },
            { id: "anthropic", name: "Anthropic", authenticated: false },
          ],
        },
      }),
      [
        { id: "openai", name: "OpenAI", authenticated: true },
        { id: "anthropic", name: "Anthropic", authenticated: false },
      ],
    );
  });

  it("accepts top-level providers arrays and string items", () => {
    assert.deepEqual(normalizeLoginProviders({ providers: ["openai", "  anthropic  "] }), [
      { id: "openai", name: "openai" },
      { id: "anthropic", name: "anthropic" },
    ]);
  });

  it("accepts bare arrays and data arrays", () => {
    assert.deepEqual(
      normalizeLoginProviders([
        { providerId: "google", label: "Google", logged_in: "yes", email: "a@b.c" },
      ]),
      [
        {
          id: "google",
          name: "Google",
          authenticated: true,
          detail: "a@b.c",
        },
      ],
    );

    assert.deepEqual(
      normalizeLoginProviders({
        data: [{ id: "xai", name: "xAI", isAuthenticated: 0, status: "expired" }],
      }),
      [{ id: "xai", name: "xAI", authenticated: false, detail: "expired" }],
    );
  });

  it("dedupes by id and drops malformed entries", () => {
    assert.deepEqual(
      normalizeLoginProviders({
        data: {
          providers: [
            { id: "openai", name: "OpenAI" },
            { id: "openai", name: "OpenAI Dup" },
            { name: "missing-id" },
            "",
            null,
            12,
          ],
        },
      }),
      [{ id: "openai", name: "OpenAI" }],
    );

    assert.deepEqual(normalizeLoginProviders(null), []);
    assert.deepEqual(normalizeLoginProviders({ data: {} }), []);
    assert.deepEqual(normalizeLoginProviders(undefined), []);
  });
});
