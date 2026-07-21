export interface SlashCommand {
  /** Command name without a leading slash. */
  name: string;
  description?: string;
  source?: "omp" | "host";
}

export const HOST_SLASH_COMMANDS: SlashCommand[] = [
  { name: "compact", description: "Compact session context", source: "host" },
  { name: "export", description: "Export session HTML", source: "host" },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stripLeadingSlash = (name: string): string =>
  name.startsWith("/") ? name.slice(1) : name;

const normalizeCommand = (candidate: unknown): SlashCommand | null => {
  if (typeof candidate === "string") {
    const name = stripLeadingSlash(candidate.trim());
    return name ? { name, source: "omp" } : null;
  }
  if (!isRecord(candidate)) return null;

  const rawName =
    typeof candidate.name === "string"
      ? candidate.name
      : typeof candidate.command === "string"
        ? candidate.command
        : typeof candidate.id === "string"
          ? candidate.id
          : null;
  if (!rawName) return null;

  const name = stripLeadingSlash(rawName.trim());
  if (!name) return null;

  const description =
    typeof candidate.description === "string"
      ? candidate.description
      : typeof candidate.detail === "string"
        ? candidate.detail
        : typeof candidate.summary === "string"
          ? candidate.summary
          : undefined;

  const source =
    candidate.source === "host" || candidate.source === "omp"
      ? candidate.source
      : "omp";

  return description ? { name, description, source } : { name, source };
};

const collectCandidates = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return [];

  const envelope = isRecord(raw.data) ? raw.data : null;
  const fromDataCommands = envelope && Array.isArray(envelope.commands)
    ? envelope.commands
    : null;
  if (fromDataCommands) return fromDataCommands;

  if (Array.isArray(raw.commands)) return raw.commands;

  if (Array.isArray(raw.data)) return raw.data;

  if (envelope) {
    if (Array.isArray(envelope.items)) return envelope.items;
    if (Array.isArray(envelope.availableCommands)) {
      return envelope.availableCommands;
    }
  }

  if (Array.isArray(raw.items)) return raw.items;
  if (Array.isArray(raw.availableCommands)) return raw.availableCommands;

  return [];
};

/** Normalize get_available_commands payloads into SlashCommand[]. */
export function normalizeCommandsPayload(raw: unknown): SlashCommand[] {
  const seen = new Set<string>();
  const commands: SlashCommand[] = [];

  for (const candidate of collectCandidates(raw)) {
    const command = normalizeCommand(candidate);
    if (!command) continue;
    const key = command.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    commands.push(command);
  }

  return commands;
}

/** Merge host + remote commands, preferring earlier entries on name clash. */
export function mergeSlashCommands(
  ...groups: SlashCommand[][]
): SlashCommand[] {
  const seen = new Set<string>();
  const merged: SlashCommand[] = [];
  for (const group of groups) {
    for (const command of group) {
      const key = command.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...command,
        name: stripLeadingSlash(command.name.trim()),
      });
    }
  }
  return merged;
}

/**
 * Filter commands by the text after `/`.
 * Matches case-insensitive prefix or substring on name/description.
 */
export function filterSlashCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;

  const scored: Array<{ command: SlashCommand; score: number }> = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    const description = (command.description ?? "").toLowerCase();
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (description.includes(q)) score = 2;
    if (score >= 0) scored.push({ command, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.command.name.localeCompare(b.command.name);
  });
  return scored.map((entry) => entry.command);
}

export interface SlashState {
  active: boolean;
  query: string;
  /** Index of the `/` that starts the slash token. */
  start: number;
}

/**
 * Detect an in-progress slash token at the cursor.
 * Active only when `/` begins at draft start or after whitespace, and the
 * token has no space yet.
 */
export function extractSlashState(
  draft: string,
  cursor: number,
): SlashState | null {
  if (cursor < 0 || cursor > draft.length) return null;

  const before = draft.slice(0, cursor);
  const slashIndex = before.lastIndexOf("/");
  if (slashIndex === -1) return null;

  if (slashIndex > 0) {
    const prev = before[slashIndex - 1];
    if (prev !== " " && prev !== "\n" && prev !== "\t") return null;
  }

  const token = before.slice(slashIndex + 1);
  if (/\s/.test(token)) return null;

  return {
    active: true,
    query: token,
    start: slashIndex,
  };
}
