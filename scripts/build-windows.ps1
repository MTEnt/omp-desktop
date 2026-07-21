#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Assert-Command($Name, $Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $Hint"
  }
}

function Assert-NodeVersion {
  $Version = [version]((& node -p "process.versions.node").Trim())
  if ($Version -lt [version]"22.12.0") {
    throw "Node.js 22.12 or newer is required."
  }
}

Assert-Command "npm" "Install Node.js 22.12+."
Assert-Command "cargo" "Install Rust via rustup."
Assert-NodeVersion

Write-Host "Installing dependencies..."
if (-not (Test-Path "node_modules")) {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "Root dependency installation failed." }
}
if (-not (Test-Path "ui\node_modules")) {
  npm --prefix ui ci
  if ($LASTEXITCODE -ne 0) { throw "UI dependency installation failed." }
}

Write-Host "Building UI..."
npm --prefix ui run build
if ($LASTEXITCODE -ne 0) { throw "UI build failed." }

Write-Host "Building Tauri Windows NSIS bundle..."
npm run tauri -- build --bundles nsis
if ($LASTEXITCODE -ne 0) { throw "Tauri Windows build failed." }

Write-Host ""
Write-Host "Done. Installers are under:"
Write-Host "  src-tauri\target\release\bundle\nsis\"
Write-Host "Portable exe:"
Write-Host "  src-tauri\target\release\app.exe"
