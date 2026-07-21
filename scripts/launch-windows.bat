@echo off
setlocal
cd /d "%~dp0\.."

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js 22.12+ and try again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)" >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Update Node.js and try again.
  pause
  exit /b 1
)


where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust/cargo was not found. Install Rust from https://rustup.rs and try again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing root dependencies...
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist ui\node_modules (
  echo Installing UI dependencies...
  call npm --prefix ui ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Starting OMP Desktop...
call npm run dev
if errorlevel 1 (
  echo.
  echo OMP Desktop exited with an error.
  pause
  exit /b 1
)
