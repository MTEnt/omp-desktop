#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Assert-Command($Name, $Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $Hint"
  }
}

Assert-Command "npm" "Install Node.js 20+."
Assert-Command "cargo" "Install Rust via rustup."

Write-Host "Installing dependencies..."
if (-not (Test-Path "node_modules")) { npm install }
if (-not (Test-Path "ui\node_modules")) { npm --prefix ui install }

Write-Host "Building UI..."
npm --prefix ui run build

Write-Host "Building Tauri Windows bundles (NSIS + MSI when available)..."
# targets from tauri.conf.json; explicit nsis is the most reliable end-user installer
npm run tauri -- build --bundles nsis

Write-Host ""
Write-Host "Done. Installers are under:"
Write-Host "  src-tauri\target\release\bundle\nsis\"
if (Test-Path "src-tauri\target\release\bundle\msi") {
  Write-Host "  src-tauri\target\release\bundle\msi\"
}
Write-Host "Portable exe:"
Write-Host "  src-tauri\target\release\app.exe"
