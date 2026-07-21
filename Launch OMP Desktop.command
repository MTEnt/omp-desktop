#!/bin/zsh
set -euo pipefail

# Double-clickable launcher for macOS.
cd "$(dirname "$0")"

export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"

if ! command -v npm >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh" --no-use
  nvm use --silent default >/dev/null
fi

if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display alert "OMP Desktop" message "npm was not found. Install Node.js, then try again." as critical'
  exit 1
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' >/dev/null 2>&1; then
  osascript -e 'display alert "OMP Desktop" message "Node.js 22.12 or newer is required. Update Node.js, then try again." as critical'
  exit 1
fi


if ! command -v cargo >/dev/null 2>&1; then
  osascript -e 'display alert "OMP Desktop" message "Rust/cargo was not found. Install Rust (rustup), then try again." as critical'
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing root dependencies…"
  npm ci
fi

if [[ ! -d ui/node_modules ]]; then
  echo "Installing UI dependencies…"
  npm --prefix ui ci
fi

echo "Starting OMP Desktop…"
exec npm run dev
