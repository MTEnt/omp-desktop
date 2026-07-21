import type { GitStatus } from "../session/types.ts";

export type { GitStatus };

export const normalizeGitStatus = (value: unknown): GitStatus => {
  if (!value || typeof value !== "object") {
    return { branch: null, dirty: false, error: null };
  }
  const record = value as Record<string, unknown>;
  const branch =
    typeof record.branch === "string" && record.branch.trim()
      ? record.branch.trim()
      : null;
  const dirty = record.dirty === true;
  const error =
    typeof record.error === "string" && record.error.trim()
      ? record.error.trim()
      : null;
  return { branch, dirty, error };
};

/** Chip label: `git main`, `git main*`, or `git —` when unavailable. */
export const formatGitChip = (status: GitStatus | null | undefined): string => {
  if (!status?.branch) return "git —";
  return status.dirty ? `git ${status.branch}*` : `git ${status.branch}`;
};

/** Full tooltip for the chip. */
export const formatGitChipTitle = (
  status: GitStatus | null | undefined,
): string => {
  if (!status) return "Git status unavailable";
  if (status.error && !status.branch) {
    return status.error;
  }
  if (!status.branch) {
    return status.error ?? "Not a git repository";
  }
  const dirty = status.dirty ? "dirty working tree" : "clean working tree";
  if (status.error) {
    return `${status.branch} · ${dirty} · ${status.error}`;
  }
  return `${status.branch} · ${dirty}`;
};

/**
 * Skip local git polling for remote-only sessions whose cwd is a temp
 * workspace without a meaningful local checkout.
 */
export const shouldPollGitStatus = (input: {
  cwd?: string | null;
  remote?: unknown;
}): boolean => {
  const cwd = typeof input.cwd === "string" ? input.cwd.trim() : "";
  if (!cwd) return false;
  if (input.remote && looksLikeEphemeralWorkspace(cwd)) {
    return false;
  }
  return true;
};

const looksLikeEphemeralWorkspace = (cwd: string): boolean => {
  const normalized = cwd.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("/tmp/omp-") || normalized.includes("/tmp/omp_")) {
    return true;
  }
  if (normalized.includes("/var/folders/") && normalized.includes("/omp")) {
    return true;
  }
  if (normalized.endsWith("/.omp-remote") || normalized.includes("/.omp/remote/")) {
    return true;
  }
  return normalized.includes("/omp-remote-");
};
