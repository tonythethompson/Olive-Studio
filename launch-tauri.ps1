# Launch Olive Studio desktop shell (Tauri 2)
# Starts the native window; beforeDevCommand runs `pnpm dev` for the web backend.
#
# Usage:
#   .\launch-tauri.ps1           # tauri dev (default)
#   .\launch-tauri.ps1 -Build    # tauri build (package installer; does not open the app)
#   .\launch-tauri.ps1 --build   # same (CLI-style flag)

[CmdletBinding()]
param(
  [switch]$Build,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

if ($RemainingArgs -contains "--build" -or $RemainingArgs -contains "-Build") {
  $Build = $true
}

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Stop-OliveStudioDevStack {
  <#
    Free port 3000 and stop leftover Olive Studio / Tauri processes for this repo
    so a new `tauri:dev` can bind cleanly.
  #>
  Write-Host "Stopping any running Olive Studio servers / Tauri leftovers..." -ForegroundColor DarkGray

  $listenPids = @()
  try {
    $listenPids = @(
      Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    )
  } catch {
    # Older Windows / restricted environments: fall back to netstat parsing
    $netstat = & netstat -ano -p tcp 2>$null
    foreach ($line in $netstat) {
      if ($line -match '^\s*TCP\s+\S+:3000\s+\S+\s+LISTENING\s+(\d+)\s*$') {
        $listenPids += [int]$Matches[1]
      }
    }
    $listenPids = @($listenPids | Select-Object -Unique)
  }

  foreach ($procId in $listenPids) {
    if ($procId -le 4) { continue }
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if (-not $processInfo) { continue }
    $commandLine = $processInfo.CommandLine
    if (-not $commandLine -or $commandLine -notmatch [regex]::Escape($Root)) {
      continue
    }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    Write-Host "  Port 3000: stopping Olive Studio PID $procId ($($proc.ProcessName))" -ForegroundColor DarkGray
    Stop-Process -Id $procId -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }

  try {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match [regex]::Escape($Root) -and
        (
          $_.CommandLine -match 'tauri(\.cmd|\.exe)?(\s|$)' -or
          $_.CommandLine -match 'tauri:dev' -or
          $_.CommandLine -match 'server\.ts' -or
          $_.CommandLine -match 'dist[/\\]server\.mjs' -or
          $_.CommandLine -match 'olive-studio\.exe' -or
          $_.Name -eq 'Olive Studio' -or
          $_.Name -eq 'olive-studio'
        )
      } |
      ForEach-Object {
        Write-Host "  Stopping leftover $($_.Name) PID $($_.ProcessId)" -ForegroundColor DarkGray
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
  } catch {
    # CIM may be unavailable; port cleanup is enough for most cases
    Write-Host "  (Skipped command-line process scan: $($_.Exception.Message))" -ForegroundColor DarkGray
  }

  Start-Sleep -Milliseconds 400
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
  Write-Host "node_modules missing - running pnpm install..." -ForegroundColor Yellow
  pnpm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not $Build) {
  Stop-OliveStudioDevStack
}

# Tauri bundle.resources maps ../dist -> dist and validates the path at cargo build,
# including `tauri dev`. Fresh clones/worktrees often have no dist/ yet.
$distDir = Join-Path $Root "dist"
if (-not (Test-Path $distDir)) {
  Write-Host "Creating empty dist/ so Tauri resource paths resolve (run pnpm build for a production bundle)..." -ForegroundColor DarkGray
  New-Item -ItemType Directory -Path $distDir | Out-Null
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
