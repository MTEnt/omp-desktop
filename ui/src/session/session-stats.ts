export interface SessionTurnStats {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  tps: number | null;
  lastTurnMs: number | null;
}

export const EMPTY_TURN_STATS: SessionTurnStats = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  costUsd: null,
  tps: null,
  lastTurnMs: null,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readFiniteNumber = (
  value: Record<string, unknown>,
  ...keys: string[]
): number | null => {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const unwrapStatsRoot = (raw: unknown): Record<string, unknown> | null => {
  if (!isRecord(raw)) return null;
  if (isRecord(raw.data)) return raw.data;
  if (isRecord(raw.result)) return raw.result;
  if (isRecord(raw.stats)) return raw.stats;
  return raw;
};

/** Defensively parse get_session_stats (and similar) envelopes into turn stats. */
export const parseSessionStats = (raw: unknown): SessionTurnStats => {
  const root = unwrapStatsRoot(raw);
  if (!root) return { ...EMPTY_TURN_STATS };

  const tokens = isRecord(root.tokens) ? root.tokens : null;
  const usage = isRecord(root.usage) ? root.usage : null;
  const costRecord = isRecord(root.cost) ? root.cost : null;

  const inputTokens =
    (tokens ? readFiniteNumber(tokens, "input", "in", "inputTokens", "input_tokens") : null) ??
    (usage ? readFiniteNumber(usage, "input", "in", "inputTokens", "input_tokens") : null) ??
    readFiniteNumber(root, "inputTokens", "input_tokens", "input", "tokensIn", "tokens_in");

  const outputTokens =
    (tokens ? readFiniteNumber(tokens, "output", "out", "outputTokens", "output_tokens") : null) ??
    (usage ? readFiniteNumber(usage, "output", "out", "outputTokens", "output_tokens") : null) ??
    readFiniteNumber(root, "outputTokens", "output_tokens", "output", "tokensOut", "tokens_out");

  const totalTokens =
    (tokens ? readFiniteNumber(tokens, "total", "totalTokens", "total_tokens") : null) ??
    (usage ? readFiniteNumber(usage, "total", "totalTokens", "total_tokens") : null) ??
    readFiniteNumber(root, "totalTokens", "total_tokens", "total") ??
    (inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null);

  const costUsd =
    readFiniteNumber(root, "cost", "costUsd", "cost_usd", "totalCost", "total_cost") ??
    (costRecord
      ? readFiniteNumber(costRecord, "total", "usd", "cost", "costUsd", "amount")
      : null);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    tps: null,
    lastTurnMs: null,
  };
};

export const computeTps = (
  outputTokens: number | null,
  lastTurnMs: number | null,
): number | null => {
  if (
    outputTokens === null ||
    lastTurnMs === null ||
    !(outputTokens > 0) ||
    !(lastTurnMs > 0)
  ) {
    return null;
  }
  const seconds = lastTurnMs / 1000;
  if (!(seconds > 0)) return null;
  const tps = outputTokens / seconds;
  return Number.isFinite(tps) ? tps : null;
};

export const mergeTurnStats = (
  previous: SessionTurnStats | undefined,
  parsed: SessionTurnStats,
  timing?: { lastTurnMs?: number | null },
): SessionTurnStats => {
  const lastTurnMs =
    timing?.lastTurnMs !== undefined
      ? timing.lastTurnMs
      : (previous?.lastTurnMs ?? parsed.lastTurnMs);
  const outputTokens = parsed.outputTokens ?? previous?.outputTokens ?? null;
  return {
    inputTokens: parsed.inputTokens ?? previous?.inputTokens ?? null,
    outputTokens,
    totalTokens: parsed.totalTokens ?? previous?.totalTokens ?? null,
    costUsd: parsed.costUsd ?? previous?.costUsd ?? null,
    lastTurnMs,
    tps: computeTps(outputTokens, lastTurnMs),
  };
};

export const formatTokenCount = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled >= 10 || scaled <= -10 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1000) {
    const scaled = value / 1000;
    return `${scaled >= 100 || scaled <= -100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

export const formatTokenChip = (stats: SessionTurnStats): string | null => {
  const { inputTokens, outputTokens, totalTokens } = stats;
  if (inputTokens !== null && outputTokens !== null) {
    return `${formatTokenCount(inputTokens)}/${formatTokenCount(outputTokens)}`;
  }
  if (totalTokens !== null) return `${formatTokenCount(totalTokens)} tok`;
  if (outputTokens !== null) return `${formatTokenCount(outputTokens)} tok`;
  if (inputTokens !== null) return `${formatTokenCount(inputTokens)} tok`;
  return null;
};

export const formatTpsChip = (tps: number | null): string | null => {
  if (tps === null || !(tps > 0) || !Number.isFinite(tps)) return null;
  const rounded = tps >= 100 ? Math.round(tps) : Math.round(tps * 10) / 10;
  return `~${rounded} t/s`;
};

export const formatUsd = (costUsd: number): string => {
  if (!Number.isFinite(costUsd) || costUsd < 0) return "—";
  if (costUsd === 0) return "$0";
  if (costUsd < 0.01) return `$${costUsd.toFixed(3)}`;
  return `$${costUsd.toFixed(2)}`;
};

export const formatCostChip = (costUsd: number | null): string | null => {
  if (costUsd === null || !Number.isFinite(costUsd) || costUsd < 0) return null;
  return formatUsd(costUsd);
};

export const formatLastTurnMs = (lastTurnMs: number | null): string | null => {
  if (lastTurnMs === null || !Number.isFinite(lastTurnMs) || lastTurnMs < 0) {
    return null;
  }
  if (lastTurnMs < 1000) return `${Math.round(lastTurnMs)} ms`;
  const seconds = lastTurnMs / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
};

export const hasTurnStats = (stats: SessionTurnStats): boolean =>
  stats.inputTokens !== null ||
  stats.outputTokens !== null ||
  stats.totalTokens !== null ||
  (stats.costUsd !== null && Number.isFinite(stats.costUsd)) ||
  (stats.tps !== null && Number.isFinite(stats.tps) && stats.tps > 0) ||
  (stats.lastTurnMs !== null && Number.isFinite(stats.lastTurnMs));

export const formatTurnStatsTitle = (stats: SessionTurnStats): string => {
  const parts: string[] = [];
  if (stats.inputTokens !== null) {
    parts.push(`in ${stats.inputTokens.toLocaleString()} tok`);
  }
  if (stats.outputTokens !== null) {
    parts.push(`out ${stats.outputTokens.toLocaleString()} tok`);
  }
  if (
    stats.totalTokens !== null &&
    (stats.inputTokens === null || stats.outputTokens === null)
  ) {
    parts.push(`total ${stats.totalTokens.toLocaleString()} tok`);
  }
  if (stats.costUsd !== null && Number.isFinite(stats.costUsd)) {
    parts.push(`cost $${stats.costUsd.toFixed(4)}`);
  }
  if (stats.tps !== null && Number.isFinite(stats.tps)) {
    parts.push(`${stats.tps.toFixed(1)} tokens/sec`);
  }
  if (stats.lastTurnMs !== null && Number.isFinite(stats.lastTurnMs)) {
    parts.push(`last turn ${(stats.lastTurnMs / 1000).toFixed(1)}s`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Session stats unavailable";
};
