#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Set up the Olive MCP Server Python virtual environment with all dependencies.

.DESCRIPTION
    Creates the venv, installs core + dev + semantic dependencies, verifies the
    server starts cleanly, and rebuilds semantic search indexes when stale
    (set OLIVE_MCP_REBUILD_INDEX=1 or pass -RebuildIndex to force).

    Run from the repo root:
      .\scripts\setup-mcp.ps1

    Options:
      -RebuildIndex   Rebuild semantic search embedding indexes after install.
      -SkipVerify     Skip the server startup verification step.

.EXAMPLE
    .\scripts\setup-mcp.ps1
    .\scripts\setup-mcp.ps1 -RebuildIndex
#>
param(
    [switch]$RebuildIndex,
    [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$McpDir = Join-Path $PSScriptRoot "..\olive-mcp-server"
$McpDir = (Resolve-Path $McpDir).Path
$VenvDir = Join-Path $McpDir ".venv"

Write-Host ""
Write-Host "=== Olive MCP Server Setup ===" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check Python is available ──────────────────────────────────────────
Write-Host "[1/5] Checking Python..." -ForegroundColor Yellow
$pythonMinMinor = 10
$pythonMaxMinor = 13
$pythonCmd = $null
$pythonPrefixArgs = @()

function Test-SupportedPython {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string[]]$PrefixArgs = @()
    )
    try {
        $ver = & $Command @PrefixArgs --version 2>&1 | Out-String
        if ($ver -match "Python 3\.(\d+)") {
            $minor = [int]$Matches[1]
            return ($minor -ge $script:pythonMinMinor -and $minor -le $script:pythonMaxMinor)
        }
    } catch {
        Write-Debug "Python candidate '$Command' check failed: $_"
    }
    return $false
}

function New-McpVenv {
    & $pythonCmd @pythonPrefixArgs -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "      ERROR: Failed to create venv." -ForegroundColor Red
        exit 1
    }
}

if ($env:OLIVE_STUDIO_PYTHON) {
    $envArgs = @()
    if ($env:OLIVE_STUDIO_PYTHON_ARGS) {
        $envArgs = @($env:OLIVE_STUDIO_PYTHON_ARGS -split "`n" | Where-Object { $_ })
    }
    if (Test-SupportedPython -Command $env:OLIVE_STUDIO_PYTHON -PrefixArgs $envArgs) {
        $pythonCmd = $env:OLIVE_STUDIO_PYTHON
        $pythonPrefixArgs = $envArgs
        $ver = & $pythonCmd @pythonPrefixArgs --version 2>&1 | Out-String
        Write-Host "      Found: $($ver.Trim())" -ForegroundColor Green
    }
}

if (-not $pythonCmd) {
    foreach ($cmd in @("python", "python3.13", "python3.12", "python3.11", "python3.10", "python3")) {
        if (Test-SupportedPython -Command $cmd) {
            $pythonCmd = $cmd
            $ver = & $cmd --version 2>&1 | Out-String
            Write-Host "      Found: $($ver.Trim())" -ForegroundColor Green
            break
        }
    }
}

if (-not $pythonCmd) {
    foreach ($flag in @("-3.13", "-3.12", "-3.11", "-3.10")) {
        if (Test-SupportedPython -Command "py" -PrefixArgs @($flag)) {
            $pythonCmd = "py"
            $pythonPrefixArgs = @($flag)
            $ver = & py $flag --version 2>&1 | Out-String
            Write-Host "      Found: $($ver.Trim())" -ForegroundColor Green
            break
        }
    }
}

if (-not $pythonCmd) {
    $uvBases = @()
    if ($env:LOCALAPPDATA) { $uvBases += Join-Path $env:LOCALAPPDATA "uv\python" }
    if ($HOME) {
        $uvBases += Join-Path $HOME ".local\share\uv\python"
        $uvBases += Join-Path $HOME "Library/Application Support/uv/python"
    }
    foreach ($base in $uvBases) {
        if (-not (Test-Path $base)) { continue }
        foreach ($minor in @(13, 12, 11, 10)) {
            $dirs = Get-ChildItem -Path $base -Directory -Filter "cpython-3.$minor.*" -ErrorAction SilentlyContinue |
                Sort-Object -Property Name -Descending
            foreach ($dir in $dirs) {
                $bin = Join-Path $dir.FullName "python.exe"
                if (-not (Test-Path $bin)) {
                    $bin = Join-Path $dir.FullName (Join-Path "bin" "python3.$minor")
                }
                if ((Test-Path $bin) -and (Test-SupportedPython -Command $bin)) {
                    $pythonCmd = $bin
                    $ver = & $bin --version 2>&1 | Out-String
                    Write-Host "      Found: $($ver.Trim()) ($bin)" -ForegroundColor Green
                    break
                }
            }
            if ($pythonCmd) { break }
        }
        if ($pythonCmd) { break }
    }
}

if (-not $pythonCmd) {
    Write-Host "      ERROR: Python 3.10-3.13 not found on PATH." -ForegroundColor Red
    Write-Host "      Install Python 3.10-3.13 (3.12 recommended) and ensure 'python' is on PATH." -ForegroundColor Red
    Write-Host "      Download: https://www.python.org/downloads/windows/" -ForegroundColor DarkGray
    Write-Host "      Or:       winget install -e --id Python.Python.3.12" -ForegroundColor DarkGray
    exit 1
}

# ── Step 2: Create venv if it doesn't exist ────────────────────────────────────
Write-Host "[2/5] Setting up virtual environment..." -ForegroundColor Yellow
if (Test-Path $VenvDir) {
    $existingPy = Join-Path $VenvDir "Scripts\python.exe"
    if (-not (Test-Path $existingPy)) {
        $existingPy = Join-Path $VenvDir "bin\python"
    }
    $recreate = $false
    if (-not (Test-Path $existingPy)) {
        $recreate = $true
    } else {
        $ver = & $existingPy --version 2>&1
        if ($ver -match "Python 3\.(\d+)") {
            $existingMinor = [int]$Matches[1]
            if ($existingMinor -lt $pythonMinMinor -or $existingMinor -gt $pythonMaxMinor) {
                Write-Host "      Existing venv is $ver (need 3.10-3.13); recreating..." -ForegroundColor Yellow
                $recreate = $true
            }
        } else {
            $recreate = $true
        }
    }
    if ($recreate) {
        Remove-Item -Recurse -Force $VenvDir
        Write-Host "      Creating venv at: $VenvDir"
        New-McpVenv
        Write-Host "      Created." -ForegroundColor Green
    } else {
        Write-Host "      Venv already exists at: $VenvDir" -ForegroundColor DarkGray
    }
} else {
    Write-Host "      Creating venv at: $VenvDir"
    New-McpVenv
    Write-Host "      Created." -ForegroundColor Green
}

# ── Step 3: Install dependencies ───────────────────────────────────────────────
Write-Host "[3/5] Installing dependencies..." -ForegroundColor Yellow
$pythonVenv = Join-Path $VenvDir "Scripts\python.exe"
if (-not (Test-Path $pythonVenv)) {
    # Linux/macOS fallback
    $pythonVenv = Join-Path $VenvDir "bin\python"
}

# Core + dev + semantic deps, with mcp pinned <2
& $pythonVenv -m pip install --upgrade pip --quiet 2>$null
& $pythonVenv -m pip install -e ($McpDir + "[dev]") "mcp<2" --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "      ERROR: pip install failed." -ForegroundColor Red
    exit 1
}
Write-Host "      All dependencies installed (including sentence-transformers for semantic search)." -ForegroundColor Green

# ── Step 4: Verify server starts ───────────────────────────────────────────────
if (-not $SkipVerify) {
    Write-Host "[4/5] Verifying server starts..." -ForegroundColor Yellow
    $pythonVenv = Join-Path $VenvDir "Scripts\python.exe"
    if (-not (Test-Path $pythonVenv)) {
        $pythonVenv = Join-Path $VenvDir "bin\python"
    }
    # A benign Python warning on stderr (e.g. a pydantic deprecation notice) can
    # get promoted to a terminating PowerShell error under
    # $ErrorActionPreference = "Stop" -- especially when this script's own
    # stdio is piped rather than an interactive console (e.g. spawned from
    # Node for postinstall). Redirecting stderr alone doesn't prevent that
    # promotion, so relax EAP just for this native call.
    $prevEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $testOutput = & $pythonVenv -c "from olive_mcp_server.mcp_server import _build_mcp; _build_mcp(); print('OK')" 2>$null
        $testExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
    if ($testExit -eq 0 -and $testOutput -match "OK") {
        Write-Host "      Server module imports successfully." -ForegroundColor Green
    } else {
        Write-Host "      WARNING: Server import check returned unexpected output:" -ForegroundColor Yellow
        Write-Host "      $testOutput" -ForegroundColor DarkGray
        exit 1
    }
} else {
    Write-Host "[4/5] Skipping verification (--SkipVerify)." -ForegroundColor DarkGray
}

# ── Step 5: Build semantic search indexes (skip when hashes match) ─────────────
Write-Host "[5/5] Building semantic search indexes (skipped when already up to date)..." -ForegroundColor Yellow
Write-Host "      (embeds KB docs via sentence-transformers; a fresh build may take a few minutes)" -ForegroundColor DarkGray
$pythonVenv = Join-Path $VenvDir "Scripts\python.exe"
if (-not (Test-Path $pythonVenv)) {
    $pythonVenv = Join-Path $VenvDir "bin\python"
}
$indexScript = Join-Path $McpDir (Join-Path "scripts" "build_kb_index.py")
if ($RebuildIndex) {
    $env:OLIVE_MCP_REBUILD_INDEX = "1"
}
$prevEapIndex = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    & $pythonVenv $indexScript
    $indexExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $prevEapIndex
}
if ($indexExit -eq 0) {
    Write-Host "      Semantic search indexes are up to date." -ForegroundColor Green
} else {
    Write-Host "      WARNING: Index build failed. Shipped indexes will be used." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "The MCP server is ready. Kiro will connect via the olive-mcp-tools Power." -ForegroundColor Cyan
Write-Host "To test manually:  $VenvDir\Scripts\python $McpDir\run.py" -ForegroundColor DarkGray
Write-Host ""
