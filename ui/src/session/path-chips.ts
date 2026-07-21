/** Normalize a local path for chip storage / dedupe. */
export const normalizePathChip = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) return "";
  // Collapse duplicate separators while preserving a leading UNC/drive form.
  return trimmed.replace(/(?<!^)[/\\]+/g, (match) =>
    match.includes("\\") && !match.includes("/") ? "\\" : "/",
  );
};

/** Dedupe-normalized append; empty/whitespace-only paths are ignored. */
export function addPathChip(paths: string[], next: string): string[] {
  const normalized = normalizePathChip(next);
  if (!normalized) return paths;
  const key = normalized.replace(/\\/g, "/").toLowerCase();
  if (
    paths.some(
      (existing) =>
        normalizePathChip(existing).replace(/\\/g, "/").toLowerCase() === key,
    )
  ) {
    return paths;
  }
  return [...paths, normalized];
}

/** Prepend `@path` tokens ahead of the user message. */
export function mergeMessageWithPaths(
  message: string,
  paths: string[],
): string {
  const chips = paths
    .map((p) => normalizePathChip(p))
    .filter(Boolean);
  if (!chips.length) return message;
  const pathBlock = chips.map((p) => `@${p}`).join(" ");
  return message ? `${pathBlock}\n\n${message}` : pathBlock;
}

/** Prefer Tauri's absolute `file.path`; fall back to bare name when asked. */
export function resolveDroppedFilePath(
  file: Pick<File, "name"> & { path?: string },
  options?: { allowNameFallback?: boolean },
): string | null {
  const path = typeof file.path === "string" ? file.path.trim() : "";
  if (path) return path;
  if (options?.allowNameFallback && file.name?.trim()) {
    return file.name.trim();
  }
  return null;
}
