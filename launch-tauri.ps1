# Launch Olive Studio desktop shell (Tauri 2)
# Starts the native window; beforeDevCommand runs `pnpm dev` for the web backend.
#
# Usage:
#   .\launch-tauri.ps1           # tauri dev (default)
#   .\launch-tauri.ps1 -Build    # tauri build (package installer; does not open the app)

[CmdletBinding()]
param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command "pnpm")) {
  Write-Error "pnpm is required. Install with: npm install -g pnpm@11.17.0 (or enable Corepack)."
  exit 1
}

if (-not (Test-Command "cargo")) {
  Write-Error @"
Rust / cargo is required for the Tauri shell.
Install from https://rustup.rs/ then reopen this terminal.
"@
  exit 1
}

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
  Write-Host "node_modules missing — running pnpm install..." -ForegroundColor Yellow
  pnpm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# @tauri-apps/cli is a project dep; pnpm tauri resolves it via package scripts
if ($Build) {
  Write-Host "Building Olive Studio desktop package (pnpm tauri:build)..." -ForegroundColor Cyan
  Write-Host "  This runs pnpm build first (see tauri.conf.json beforeBuildCommand)." -ForegroundColor DarkGray
  pnpm tauri:build
  exit $LASTEXITCODE
}

Write-Host "Starting Olive Studio desktop (Tauri dev)..." -ForegroundColor Cyan
Write-Host "  Web backend: http://127.0.0.1:3000 (auto via beforeDevCommand)" -ForegroundColor DarkGray
Write-Host "  Ctrl+C to stop both the window and the web server." -ForegroundColor DarkGray
pnpm tauri:dev
exit $LASTEXITCODE
