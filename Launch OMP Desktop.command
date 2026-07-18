#!/bin/zsh
set -euo pipefail

# Double-clickable launcher for macOS.
cd "$(dirname "$0")"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display alert "OMP Desktop" message "npm was not found. Install Node.js, then try again." as critical'
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  osascript -e 'display alert "OMP Desktop" message "Rust/cargo was not found. Install Rust (rustup), then try again." as critical'
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing root dependencies…"
  npm install
fi

if [[ ! -d ui/node_modules ]]; then
  echo "Installing UI dependencies…"
  npm --prefix ui install
fi

echo "Starting OMP Desktop…"
exec npm run dev
