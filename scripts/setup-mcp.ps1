#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Set up the Olive MCP Server Python virtual environment with all dependencies.

.DESCRIPTION
    Creates the venv, installs core + dev + semantic dependencies, verifies the
    server starts cleanly, and rebuilds the semantic search indexes when stale
    (set OLIVE_MCP_REBUILD_INDEX=1 to force a rebuild).

    Requires Python >= 3.10 and < 3.14 (3.13 or 3.12 preferred). Python 3.14+
    is not supported yet because some dependencies (torch / sentence-transformers)
    do not ship 3.14 wheels.

    Run from the repo root:
      .\scripts\setup-mcp.ps1

    Options:
      -SkipVerify     Skip the server startup verification step.

.EXAMPLE
    .\scripts\setup-mcp.ps1
#>
param(
    [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$McpDir = Join-Path $PSScriptRoot "..\olive-mcp-server"
$McpDir = (Resolve-Path $McpDir).Path
$VenvDir = Join-Path $McpDir ".venv"
$MinMinor = 10
$MaxMinor = 13

Write-Host ""
Write-Host "=== Olive MCP Server Setup ===" -ForegroundColor Cyan
Write-Host ""

# Returns the minor version of a Python invocation (e.g. @("py", "-3.13")), or
# $null when the command is missing or does not look like CPython 3.x.
function Get-PythonMinor {
    param([string[]]$Invocation)
    try {
        $exe = $Invocation[0]
        $rest = @()
        if ($Invocation.Count -gt 1) { $rest = $Invocation[1..($Invocation.Count - 1)] }
        $ver = & $exe @rest --version 2>&1
        if ($LASTEXITCODE -eq 0 -and $ver -match "Python 3\.(\d+)") {
            return [int]$Matches[1]
        }
    } catch {
        Write-Debug "Python candidate '$($Invocation -join ' ')' check failed: $_"
    }
    return $null
}

# ── Step 1: Check Python is available ──────────────────────────────────────────
Write-Host "[1/5] Checking Python (need 3.$MinMinor-3.$MaxMinor; 3.13/3.12 preferred)..." -ForegroundColor Yellow
$pythonExe = $null
$pythonArgs = @()
$pythonCandidates = @(
    ,@("python3.13")
    ,@("python3.12")
    ,@("python3.11")
    ,@("python3.10")
    ,@("python3")
    ,@("python")
    ,@("py", "-3.13")
    ,@("py", "-3.12")
    ,@("py", "-3.11")
    ,@("py", "-3.10")
)
foreach ($candidate in $pythonCandidates) {
    $minor = Get-PythonMinor -Invocation $candidate
    if ($null -ne $minor -and $minor -ge $MinMinor -and $minor -le $MaxMinor) {
        $pythonExe = $candidate[0]
        if ($candidate.Count -gt 1) { $pythonArgs = $candidate[1..($candidate.Count - 1)] }
        $foundVer = & $pythonExe @pythonArgs --version 2>&1
        Write-Host "      Found: $foundVer" -ForegroundColor Green
        break
    }
}
# Fall back to uv-managed interpreters, which are usually not on PATH.
if (-not $pythonExe) {
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
                if (Test-Path $bin) {
                    $pythonExe = $bin
                    $foundVer = & $bin --version 2>&1
                    Write-Host "      Found: $foundVer ($bin)" -ForegroundColor Green
                    break
                }
            }
            if ($pythonExe) { break }
        }
        if ($pythonExe) { break }
    }
}
if (-not $pythonExe) {
    Write-Host "      ERROR: No compatible Python found (need >= 3.$MinMinor, < 3.14)." -ForegroundColor Red
    Write-Host "      Python 3.14+ is not supported yet (torch/sentence-transformers lack 3.14 wheels)." -ForegroundColor Red
    Write-Host "      Install Python 3.13 or 3.12 and re-run this script." -ForegroundColor Red
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
            if ($existingMinor -lt $MinMinor) {
                Write-Host "      Existing venv is $ver (< 3.$MinMinor); recreating..." -ForegroundColor Yellow
                $recreate = $true
            } elseif ($existingMinor -gt $MaxMinor) {
                Write-Host "      Existing venv is $ver (>= 3.14, unsupported); recreating..." -ForegroundColor Yellow
                $recreate = $true
            }
        } else {
            $recreate = $true
        }
    }
    if ($recreate) {
        Remove-Item -Recurse -Force $VenvDir
        Write-Host "      Creating venv at: $VenvDir"
        & $pythonExe @pythonArgs -m venv $VenvDir
        if ($LASTEXITCODE -ne 0) {
            Write-Host "      ERROR: Failed to create venv." -ForegroundColor Red
            exit 1
        }
        Write-Host "      Created." -ForegroundColor Green
    } else {
        Write-Host "      Venv already exists at: $VenvDir" -ForegroundColor DarkGray
    }
} else {
    Write-Host "      Creating venv at: $VenvDir"
    & $pythonExe @pythonArgs -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "      ERROR: Failed to create venv." -ForegroundColor Red
        exit 1
    }
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

# ── Step 5: Build semantic search indexes ──────────────────────────────────────
Write-Host "[5/5] Building semantic search indexes (skipped when already up to date)..." -ForegroundColor Yellow
Write-Host "      (embeds KB docs via sentence-transformers; a fresh build may take a few minutes)" -ForegroundColor DarkGray
$pythonVenv = Join-Path $VenvDir "Scripts\python.exe"
if (-not (Test-Path $pythonVenv)) {
    $pythonVenv = Join-Path $VenvDir "bin\python"
}
$indexScript = Join-Path $McpDir (Join-Path "scripts" "build_kb_index.py")
# Same EAP relaxation as step 4: benign stderr warnings from native commands can
# otherwise be promoted to terminating errors when this script's stdio is piped.
$prevEap = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    & $pythonVenv $indexScript
    $indexExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $prevEap
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
