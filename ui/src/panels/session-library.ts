import type { HistoricSessionSummary } from "../session/types.ts";

export function filterHistoricSessions(
  sessions: HistoricSessionSummary[],
  query: string,
): HistoricSessionSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sessions;

  return sessions.filter((session) => {
    const haystack = [
      session.title ?? "",
      session.cwd,
      session.project,
      session.id,
      session.path,
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function formatRelativeTime(iso: string, nowMs = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso || "—";

  const deltaMs = Math.max(0, nowMs - then);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (deltaMs < minuteMs) return "just now";
  if (deltaMs < hourMs) {
    const minutes = Math.floor(deltaMs / minuteMs);
    return `${minutes}m ago`;
  }
  if (deltaMs < dayMs) {
    const hours = Math.floor(deltaMs / hourMs);
    return `${hours}h ago`;
  }
  if (deltaMs < 30 * dayMs) {
    const days = Math.floor(deltaMs / dayMs);
    return `${days}d ago`;
  }

  try {
    return new Date(then).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function displayTitle(session: HistoricSessionSummary): string {
  const titled = session.title?.trim();
  if (titled) return titled;

  const id = session.id?.trim();
  if (id) {
    return id.length > 12 ? `${id.slice(0, 8)}…` : id;
  }

  const path = session.path.replace(/\\/g, "/");
  const base = path.split("/").filter(Boolean).at(-1);
  return base || path || "Untitled session";
}
