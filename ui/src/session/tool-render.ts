export type DiffLineKind = "add" | "rem" | "ctx" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  line?: number;
}

export interface ParsedEditDiff {
  kind: "edit";
  target?: string;
  adds: number;
  rems: number;
  lines: DiffLine[];
  raw: string;
}

export interface ParsedBash {
  kind: "bash";
  output: string;
  exitCode?: number;
  raw: string;
}

export interface ParsedReadSearch {
  kind: "read" | "search";
  target?: string;
  summary?: string;
  raw: string;
}

export interface ParsedEval {
  kind: "eval";
  cells: Array<{ language?: string; code?: string; output?: string }>;
  raw: string;
}

export interface ParsedRaw {
  kind: "raw";
  raw: string;
}

export type ParsedToolPayload =
  | ParsedEditDiff
  | ParsedBash
  | ParsedReadSearch
  | ParsedEval
  | ParsedRaw;

const NO_NEWLINE_RE = /^\\ No newline at end of file\s*$/;
const HUNK_HEADER_RE = /^@@/;
const FILE_HEADER_RE = /^(---|\+\+\+)\s+/;
const EXIT_TRAILING_RE = /(?:^|\n)exit\s+(\d+)\s*$/i;
const PATH_LIKE_RE =
  /^(?:[A-Za-z]:[\\/]|\/|\.\/|\.\.\/|[A-Za-z0-9._-]+\/)[^\s]*$/;

function stripDiffPath(headerPath: string): string {
  const trimmed = headerPath.trim();
  // Drop optional a/ or b/ prefix from git-style paths.
  if (/^[ab]\//.test(trimmed)) {
    return trimmed.slice(2);
  }
  // Handle "b/path\ttimestamp" style
  const withoutTab = trimmed.split(/\t/)[0] ?? trimmed;
  if (/^[ab]\//.test(withoutTab)) {
    return withoutTab.slice(2);
  }
  return withoutTab;
}

export function isDiffLike(text: string): boolean {
  if (!text) return false;
  const hasMinus = /^---\s+\S+/m.test(text);
  const hasPlus = /^\+\+\+\s+\S+/m.test(text);
  const hasHunk = /^@@/m.test(text);
  return (hasMinus && hasPlus) || (hasHunk && (hasMinus || hasPlus || /^[+-]/m.test(text)));
}

export function parseUnifiedDiff(
  text: string,
  targetHint?: string,
): ParsedEditDiff {
  const lines: DiffLine[] = [];
  let adds = 0;
  let rems = 0;
  let target: string | undefined = targetHint;
  let oldLine: number | undefined;
  let newLine: number | undefined;

  const rawLines = text.split("\n");
  // Preserve trailing empty only if original ends with newline differently —
  // split keeps a final empty string when text ends with \n; drop that empty.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  for (const rawLine of rawLines) {
    if (NO_NEWLINE_RE.test(rawLine)) {
      continue;
    }

    if (FILE_HEADER_RE.test(rawLine) || HUNK_HEADER_RE.test(rawLine)) {
      lines.push({ kind: "meta", text: rawLine });

      if (rawLine.startsWith("+++ ")) {
        const rest = rawLine.slice(4);
        const path = stripDiffPath(rest);
        if (path && path !== "/dev/null") {
          target = path;
        }
      }

      const hunkMatch = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/.exec(
        rawLine,
      );
      if (hunkMatch) {
        oldLine = Number(hunkMatch[1]);
        newLine = Number(hunkMatch[2]);
      }
      continue;
    }

    if (rawLine.startsWith("+")) {
      const textBody = rawLine.slice(1);
      lines.push({ kind: "add", text: textBody, line: newLine });
      adds += 1;
      if (newLine !== undefined) newLine += 1;
      continue;
    }

    if (rawLine.startsWith("-")) {
      const textBody = rawLine.slice(1);
      lines.push({ kind: "rem", text: textBody, line: oldLine });
      rems += 1;
      if (oldLine !== undefined) oldLine += 1;
      continue;
    }

    if (rawLine.startsWith(" ") || rawLine === "") {
      const textBody = rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine;
      lines.push({
        kind: "ctx",
        text: textBody,
        line: newLine ?? oldLine,
      });
      if (oldLine !== undefined) oldLine += 1;
      if (newLine !== undefined) newLine += 1;
      continue;
    }

    // Fallback: treat unknown lines as meta (e.g. "diff --git", "index")
    lines.push({ kind: "meta", text: rawLine });
  }

  return {
    kind: "edit",
    target,
    adds,
    rems,
    lines,
    raw: text,
  };
}

function parseBashPayload(detail: string): ParsedBash {
  let exitCode: number | undefined;

  const exitMatch = EXIT_TRAILING_RE.exec(detail);
  if (exitMatch) {
    exitCode = Number(exitMatch[1]);
  } else {
    // Try trailing JSON object with exitCode / exit_code / code
    const trimmed = detail.trimEnd();
    const lastNewline = trimmed.lastIndexOf("\n");
    const candidates = [
      trimmed,
      lastNewline >= 0 ? trimmed.slice(lastNewline + 1).trim() : "",
    ];
    for (const candidate of candidates) {
      if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
      try {
        const obj = JSON.parse(candidate) as Record<string, unknown>;
        const code = obj.exitCode ?? obj.exit_code ?? obj.code;
        if (typeof code === "number" && Number.isFinite(code)) {
          exitCode = code;
          break;
        }
        if (typeof code === "string" && /^\d+$/.test(code)) {
          exitCode = Number(code);
          break;
        }
      } catch {
        // not JSON
      }
    }
  }

  return {
    kind: "bash",
    output: detail,
    exitCode,
    raw: detail,
  };
}

function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t) return t;
  }
  return undefined;
}

function parseReadSearch(
  kind: "read" | "search",
  detail: string,
): ParsedReadSearch {
  const summary = firstNonEmptyLine(detail);
  let target: string | undefined;

  for (const line of detail.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    // Path-like: absolute, relative with slash, or Windows drive
    if (PATH_LIKE_RE.test(t) || t.includes("/") || t.includes("\\")) {
      // Prefer token that looks like a path (not a sentence)
      if (!/\s{2,}/.test(t) && t.length < 512) {
        target = t.split(/\s+/)[0];
        break;
      }
    }
  }

  if (!target && summary && (summary.includes("/") || summary.includes("\\"))) {
    target = summary.split(/\s+/)[0];
  }

  return { kind, target, summary, raw: detail };
}

function parseEvalPayload(detail: string): ParsedEval {
  const trimmed = detail.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const cells = parsed.map((cell) => normalizeEvalCell(cell));
        if (cells.length > 0) {
          return { kind: "eval", cells, raw: detail };
        }
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.cells)) {
          return {
            kind: "eval",
            cells: obj.cells.map((cell) => normalizeEvalCell(cell)),
            raw: detail,
          };
        }
        // Single cell object
        if ("code" in obj || "output" in obj || "language" in obj) {
          return {
            kind: "eval",
            cells: [normalizeEvalCell(obj)],
            raw: detail,
          };
        }
      }
    } catch {
      // fall through
    }
  }

  return {
    kind: "eval",
    cells: [{ output: detail }],
    raw: detail,
  };
}

function normalizeEvalCell(
  cell: unknown,
): { language?: string; code?: string; output?: string } {
  if (!cell || typeof cell !== "object") {
    return { output: String(cell ?? "") };
  }
  const obj = cell as Record<string, unknown>;
  const out: { language?: string; code?: string; output?: string } = {};
  if (typeof obj.language === "string") out.language = obj.language;
  if (typeof obj.code === "string") out.code = obj.code;
  if (typeof obj.output === "string") out.output = obj.output;
  return out;
}

export function parseToolPayload(
  toolName: string,
  detail: string,
): ParsedToolPayload {
  const name = toolName.trim().toLowerCase();

  if (name === "edit" || name === "write" || name === "ast_edit") {
    return parseUnifiedDiff(detail);
  }

  if (isDiffLike(detail)) {
    return parseUnifiedDiff(detail);
  }

  if (name === "bash" || name === "shell" || name === "terminal") {
    return parseBashPayload(detail);
  }

  if (name === "read") {
    return parseReadSearch("read", detail);
  }

  if (name === "search" || name === "find" || name === "grep") {
    return parseReadSearch("search", detail);
  }

  if (name === "eval") {
    return parseEvalPayload(detail);
  }

  return { kind: "raw", raw: detail };
}
