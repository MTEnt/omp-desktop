# OMP Desktop

Cross-platform desktop cockpit (macOS + Windows + Linux) for [OMP](https://github.com/) (`omp` CLI) coding-agent sessions.

Zen-default UI with expandable panels, multi-tab `omp --mode rpc` sessions, live transcript, plan/activity/subagents, settings, command palette, and an app-owned PTY terminal.

## Requirements

- macOS 12+ (Apple Silicon or Intel)
- Windows 10/11 x64 (WebView2)
- Linux x64 (Debian/Ubuntu-class; WebKitGTK 4.1)
- Rust toolchain (`rustc` / `cargo`)
- Node.js 22.12+ and npm
- [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/)
- `omp` on PATH (v17+), or set the binary path in Settings

## Install from Releases

Prebuilt installers are published on [GitHub Releases](https://github.com/MTEnt/omp-desktop/releases) for tags matching `v*` (for example `v0.1.0`).

| Platform | Artifacts |
| --- | --- |
| macOS | Universal `.dmg` |
| Windows | NSIS `.exe` installer |
| Linux | `.deb` and `.AppImage` |

**macOS (unsigned):** builds are not Apple-notarized yet. After download, if Gatekeeper blocks the app, open **System Settings → Privacy & Security** and choose **Open Anyway**, or run `xattr -dr com.apple.quarantine "/path/to/OMP Desktop.app"`. Notarization secrets are not required for CI.

**Linux:** install WebKitGTK and related runtime packages if the AppImage or `.deb` reports missing libraries — on Debian/Ubuntu typically `libwebkit2gtk-4.1-0`, `libgtk-3-0`, and `libayatana-appindicator3-1` (package names vary by distro). Prefer the `.deb` on Ubuntu 22.04+.

You still need `omp` v17+ on PATH (or set the binary path in Settings) after installing the desktop app.

## Screenshots

![Home](docs/screenshots/home.png)

## Launch, Browser, and Companion

Desktop can keep OMP workflows inside the GUI:

- **Launch panel** — Superpowers brainstorm, Impeccable critique/polish, browser QA recipes, and discovered skills
- **Browser panel** — launch headless/headed browser tasks and collect screenshots/artifacts from the OMP `browser` tool
- **Companion panel** — attach/embed localhost companions (e.g. brainstorm visual server)

Also available from the command palette under **Launch**.

## Connect via SSH

Use **SSH** in the top bar (or Sessions panel / command palette → “Connect via SSH”):

1. Pick a host from `~/.ssh/config` or OMP `~/.omp/agent/ssh.json`
2. Optionally add a host
3. Enter the remote folder (`~` or `/path`)
4. **Test connection**, then **Connect**

Creates a session labeled `user@host:path` with:

- remote folder browser + recents
- stronger remote-root instructions for the agent
- **remote integrated terminal** (`ssh -tt` into the folder)
- top-bar SSH status chip

## First-launch walkthrough

On first launch, OMP Desktop opens a short setup:

1. Confirm the `omp` CLI is available
2. Optionally install **Impeccable** (default UI craft standard for agents)
3. Pick approval defaults
4. Open your first folder/session

Replay anytime from **Settings → Replay first-launch walkthrough**.


## Launch on Windows

Double-click:

```text
scripts\launch-windows.bat
```

Or from PowerShell in the project root:

```powershell
npm run launch:windows
# same as: npm run dev
```

### Windows prerequisites

- [Node.js 22.12+](https://nodejs.org/)
- [Rust / rustup](https://rustup.rs/) (`cargo` on PATH)
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (usually preinstalled on Win11)
- `omp` on PATH (v17+), or set the binary path in Settings (`omp.cmd` / `omp.exe` are auto-detected)

### Build a Windows installer

```powershell
npm run build:windows
# or: powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

Outputs:

- `src-tauri\target\release\bundle\nsis\*.exe` installer
- `src-tauri\target\release\app.exe` portable binary

## Launch on macOS

Double-click:

```text
Launch OMP Desktop.command
```

Or from a terminal in the project root:

```bash
npm run start
# same as: npm run dev
```

The first launch installs dependencies if needed, then opens the OMP Desktop window.

## Development

```bash
npm install
npm --prefix ui install
npm run dev
```

Other scripts:

```bash
npm run ui:dev      # Vite only
npm run ui:build    # frontend production build
npm run build       # tauri build
```

Rust tests:

```bash
cd src-tauri && cargo test
```

## Architecture

- **Rust / Tauri host** (`src-tauri/`): spawns one `omp --mode rpc` child per session tab, JSONL RPC client, settings, PTY, Tauri commands + `omp-event` bridge.
- **React UI** (`ui/`): Zen shell, transcript/composer, pinnable panels, palette, xterm terminal view.
- **OMP** remains source of truth for agent loop, tools, session files, and auth.

Deeper reference:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — process model, RPC/event bridge, PTY/SSH/memory, 1 MiB frame limit, stock-OMP boundary, security notes
- [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md) — capability × authority × desktop surface × roadmap status

## Defaults

- Approval mode: **write** (`--approval-mode write`) by default; OMP may read and edit normally, but asks before running commands.
- Layout: Zen (icon rails); click to drawer, pin to dock.
- Terminal: app-owned PTY per session (not the OMP TUI).

## Manual QA checklist

1. App launches via `npm run dev`
2. Open folder → session becomes ready
3. Prompt streams assistant text
4. Coding prompt shows tool cards
5. Two tabs on two folders stay isolated
6. Plan panel updates when OMP todos change
7. Activity lists tools
8. Terminal `pwd` matches session cwd
9. Yolo path shows no approval chrome
10. Settings → approval mode persists for next session
11. Kill omp child → exited banner + Restart works
12. Missing `omp` → error points at Settings / PATH

## Repo

https://github.com/MTEnt/omp-desktop

## Windows notes

- Local terminal prefers PowerShell (`pwsh` / `powershell`) when available, otherwise `COMSPEC`/`cmd.exe`.
- SSH features require OpenSSH Client (`ssh` on PATH). Enable via Optional Features if needed.
- Remote `ssh://` file IO still expects POSIX remotes (Linux/macOS servers).
- Impeccable one-click install uses `npx` through `cmd /C` on Windows.
