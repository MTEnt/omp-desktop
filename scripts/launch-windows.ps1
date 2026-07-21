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
    throw "Node.js 22.12 or newer is required. Install a current Node.js release and reopen the terminal."
  }
}

try {
  Assert-Command "npm" "Install Node.js 22.12+ from https://nodejs.org and reopen the terminal."
  Assert-NodeVersion
  Assert-Command "cargo" "Install Rust from https://rustup.rs and ensure cargo is on PATH."
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($_.Exception.Message, "OMP Desktop", "OK", "Error") | Out-Null
  exit 1
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing root dependencies..."
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "Root dependency installation failed." }
}

if (-not (Test-Path "ui\node_modules")) {
  Write-Host "Installing UI dependencies..."
  npm --prefix ui ci
  if ($LASTEXITCODE -ne 0) { throw "UI dependency installation failed." }
}

Write-Host "Starting OMP Desktop..."
npm run dev
if ($LASTEXITCODE -ne 0) { throw "OMP Desktop exited with code $LASTEXITCODE." }
