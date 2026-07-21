import type { ReviewFile } from "./types.ts";
import { isDiffLike, parseToolPayload } from "./tool-render.ts";

export function isEditLikeToolName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (n === "edit" || n === "write" || n === "ast_edit") return true;
  if (n.includes("ast_edit")) return true;
  // Match edit/write as whole path segments: foo.edit, tool_write, write_file
  return /(^|[._\-/])(edit|write)([._\-/]|$)/.test(n);
}

function pathFromUnknown(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pathFromUnknown(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;

  const rec = value as Record<string, unknown>;
  const edit = rec.edit;
  if (edit && typeof edit === "object" && !Array.isArray(edit)) {
    const target = (edit as Record<string, unknown>).target;
    if (typeof target === "string" && target.trim()) return target.trim();
  }

  for (const key of [
    "path",
    "file",
    "target",
    "filename",
    "filePath",
    "file_path",
  ]) {
    const candidate = rec[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (Array.isArray(rec.paths)) {
    for (const entry of rec.paths) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
    }
  }

  if (Array.isArray(rec.ops)) {
    for (const op of rec.ops) {
      const found = pathFromUnknown(op, depth + 1);
      if (found) return found;
    }
  }

  return undefined;
}

function stripGitPrefix(path: string): string {
  const trimmed = path.trim().split(/\t/)[0]?.trim() ?? path.trim();
  if (/^[ab]\//.test(trimmed)) return trimmed.slice(2);
  return trimmed;
}

export function extractReviewPath(detail: string): string | undefined {
  const text = detail.trim();
  if (!text) return undefined;

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const fromJson = pathFromUnknown(parsed);
      if (fromJson) return fromJson;
    } catch {
      // fall through to text heuristics
    }
  }

  const nestedEdit = /"edit"\s*:\s*\{[^}]*"target"\s*:\s*"([^"]+)"/i.exec(text);
  if (nestedEdit?.[1]) return nestedEdit[1];

  const keyed =
    /(?:^|[\s,{])(?:"(?:path|file|target|filename|filePath|file_path)"|(?:path|file|target|filename))\s*[:=]\s*"([^"]+)"/i.exec(
      text,
    );
  if (keyed?.[1]) return keyed[1];

  const plusHeader = /^\+\+\+\s+(\S+)/m.exec(text);
  if (plusHeader?.[1]) {
    const path = stripGitPrefix(plusHeader[1]);
    if (path && path !== "/dev/null") return path;
  }

  const minusHeader = /^---\s+(\S+)/m.exec(text);
  if (minusHeader?.[1]) {
    const path = stripGitPrefix(minusHeader[1]);
    if (path && path !== "/dev/null") return path;
  }

  return undefined;
}

export function reviewFileFromTool(
  name: string,
  detail: string,
  toolId: string,
  status: ReviewFile["status"],
): ReviewFile | null {
  const editLike = isEditLikeToolName(name);
  const detailText = detail ?? "";
  const diffLike = isDiffLike(detailText);

  // Track named edit tools always; other tools only when payload is diff-like.
  if (!editLike && !diffLike) return null;

  const parsed = parseToolPayload(name, detailText);
  let path: string | undefined;
  let adds: number | undefined;
  let rems: number | undefined;
  let diff: string | undefined = detailText || undefined;

  if (parsed.kind === "edit") {
    path = parsed.target;
    adds = parsed.adds;
    rems = parsed.rems;
    if (parsed.raw) diff = parsed.raw;
  }

  if (!path) {
    path = extractReviewPath(detailText);
  }

  if (!path) {
    // Still surface running edit tools even before path/diff is known.
    if (!editLike) return null;
    path = `tool:${toolId}`;
  }

  const file: ReviewFile = {
    path,
    toolId,
    status,
  };
  if (adds !== undefined) file.adds = adds;
  if (rems !== undefined) file.rems = rems;
  if (diff) file.diff = diff;
  return file;
}

export function upsertReviewFile(
  files: ReviewFile[],
  next: ReviewFile,
): ReviewFile[] {
  const index = files.findIndex((file) => file.path === next.path);
  if (index === -1) return [...files, next];

  const prev = files[index]!;
  const merged: ReviewFile = {
    path: next.path,
    toolId: next.toolId || prev.toolId,
    status: next.status,
    adds: next.adds ?? prev.adds,
    rems: next.rems ?? prev.rems,
    diff: next.diff || prev.diff,
  };

  const copy = files.slice();
  copy[index] = merged;
  return copy;
}
