#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Installing Impeccable skills (global agents + project link)..."
npx --yes impeccable@3.2.1 install \
  --yes \
  --scope=global \
  --providers=agents,claude \
  --no-hooks

mkdir -p "$ROOT/.agents/skills" "$HOME/.omp/agent/skills"
if [[ -d "$HOME/.agents/skills/impeccable" ]]; then
  ln -sfn "$HOME/.agents/skills/impeccable" "$ROOT/.agents/skills/impeccable"
  ln -sfn "$HOME/.agents/skills/impeccable" "$HOME/.omp/agent/skills/impeccable"
  echo "Linked skill://impeccable into project and ~/.omp/agent/skills"
else
  echo "WARN: ~/.agents/skills/impeccable missing. Run: npx impeccable install"
  exit 1
fi

mkdir -p "$HOME/.omp/agent"
if [[ ! -f "$HOME/.omp/agent/RULES.md" ]] || ! grep -q 'Impeccable' "$HOME/.omp/agent/RULES.md" 2>/dev/null; then
  cat > "$HOME/.omp/agent/RULES.md" <<'RULES'
# Harness rules (always apply)

## Impeccable design standard (default)

For any UI / frontend / visual / UX work, agents MUST follow Impeccable (https://impeccable.style/docs/).

1. Read skill://impeccable before designing or editing UI.
2. Run: node <skill-base-dir>/scripts/context.mjs once per session (cwd = project).
3. Load skill://impeccable/reference/<command>.md for craft/shape/polish/critique/audit/layout/typeset/animate/etc.
4. Obey absolute bans (no AI-slop defaults).
5. Prefer PRODUCT.md + DESIGN.md when present.

Non-UI tasks are exempt; mixed changes apply Impeccable to the UI portion.
RULES
  echo "Wrote ~/.omp/agent/RULES.md"
fi

echo "Done. Restart omp / OMP Desktop sessions to pick up skills + sticky rules."
