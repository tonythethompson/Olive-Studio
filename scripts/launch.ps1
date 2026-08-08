# Launch Olive Studio in the browser (web only — no Tauri shell).
# For the desktop app, use: .\launch-tauri.ps1
#
# Usage:
#   .\launch.ps1           # dev server (default)
#   .\launch.ps1 -Prod     # production build server (requires dist/)
#   .\launch.ps1 -NoBrowser

[CmdletBinding()]
param(
  [switch]$Prod,
  [switch]$NoBrowser
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

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
  Write-Host "node_modules missing — running pnpm install..." -ForegroundColor Yellow
  pnpm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$Url = "http://localhost:3000"
$Mode = if ($Prod) { "prod" } else { "dev" }

if ($Prod) {
  $server = Join-Path $Root "dist\server.mjs"
  if (-not (Test-Path $server)) {
    Write-Host "dist/server.mjs not found — running pnpm build..." -ForegroundColor Yellow
    pnpm build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  Write-Host "Starting Olive Studio (production) at $Url ..." -ForegroundColor Cyan
  $LaunchCmd = "pnpm start"
} else {
  Write-Host "Starting Olive Studio (dev) at $Url ..." -ForegroundColor Cyan
  Write-Host "  Ctrl+C to stop." -ForegroundColor DarkGray
  $LaunchCmd = "pnpm dev"
}

if (-not $NoBrowser) {
  # Open after a short delay so the server can bind
  Start-Job -ScriptBlock {
    param($U)
    Start-Sleep -Seconds 2
    Start-Process $U
  } -ArgumentList $Url | Out-Null
}

# Run in foreground so logs stream to this console
Invoke-Expression $LaunchCmd
exit $LASTEXITCODE
