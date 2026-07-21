import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeTps,
  formatCostChip,
  formatTokenChip,
  formatTpsChip,
  mergeTurnStats,
  parseSessionStats,
} from "../src/session/session-stats.ts";

describe("parseSessionStats", () => {
  it("reads OMP get_session_stats data envelopes", () => {
    assert.deepEqual(
      parseSessionStats({
        type: "response",
        success: true,
        command: "get_session_stats",
        data: {
          tokens: { input: 1200, output: 340, total: 1540 },
          cost: 0.0215,
        },
      }),
      {
        inputTokens: 1200,
        outputTokens: 340,
        totalTokens: 1540,
        costUsd: 0.0215,
        tps: null,
        lastTurnMs: null,
      },
    );
  });

  it("accepts alternate token and cost field shapes", () => {
    assert.deepEqual(
      parseSessionStats({
        usage: { inputTokens: 10, outputTokens: 20 },
        totalCost: "0.004",
      }),
      {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        costUsd: 0.004,
        tps: null,
        lastTurnMs: null,
      },
    );
  });

  it("returns nulls for missing or malformed payloads", () => {
    assert.deepEqual(parseSessionStats(null), {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
      tps: null,
      lastTurnMs: null,
    });
    assert.deepEqual(parseSessionStats({ data: { tokens: {} } }), {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
      tps: null,
      lastTurnMs: null,
    });
  });
});

describe("turn stats helpers", () => {
  it("computes crude tokens/sec from output tokens and wall time", () => {
    assert.equal(computeTps(320, 10_000), 32);
    assert.equal(computeTps(null, 10_000), null);
    assert.equal(computeTps(100, 0), null);
  });

  it("merges parsed stats with prior turn timing for tps", () => {
    const merged = mergeTurnStats(
      {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        costUsd: 0.01,
        tps: null,
        lastTurnMs: 2000,
      },
      {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        costUsd: 0.02,
        tps: null,
        lastTurnMs: null,
      },
    );
    assert.equal(merged.lastTurnMs, 2000);
    assert.equal(merged.outputTokens, 50);
    assert.equal(merged.tps, 25);
    assert.equal(merged.costUsd, 0.02);
  });

  it("formats compact chips", () => {
    assert.equal(
      formatTokenChip({
        inputTokens: 12400,
        outputTokens: 3200,
        totalTokens: 15600,
        costUsd: null,
        tps: null,
        lastTurnMs: null,
      }),
      "12.4k/3.2k",
    );
    assert.equal(
      formatTokenChip({
        inputTokens: null,
        outputTokens: null,
        totalTokens: 15600,
        costUsd: null,
        tps: null,
        lastTurnMs: null,
      }),
      "15.6k tok",
    );
    assert.equal(formatTpsChip(32.4), "~32.4 t/s");
    assert.equal(formatCostChip(0.02), "$0.02");
    assert.equal(formatCostChip(null), null);
  });
});
