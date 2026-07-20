@echo off
setlocal
cd /d "%~dp0\.."

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js 20+ and try again.
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
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist ui\node_modules (
  echo Installing UI dependencies...
  call npm --prefix ui install
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
