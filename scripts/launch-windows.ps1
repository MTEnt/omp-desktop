#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Assert-Command($Name, $Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $Hint"
  }
}

try {
  Assert-Command "npm" "Install Node.js 20+ from https://nodejs.org and reopen the terminal."
  Assert-Command "cargo" "Install Rust from https://rustup.rs and ensure cargo is on PATH."
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($_.Exception.Message, "OMP Desktop", "OK", "Error") | Out-Null
  exit 1
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing root dependencies..."
  npm install
}

if (-not (Test-Path "ui\node_modules")) {
  Write-Host "Installing UI dependencies..."
  npm --prefix ui install
}

Write-Host "Starting OMP Desktop..."
npm run dev
