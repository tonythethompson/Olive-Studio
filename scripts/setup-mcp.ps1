#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Set up the Olive MCP Server Python virtual environment with all dependencies.

.DESCRIPTION
    Creates the venv, installs core + dev + semantic dependencies, verifies the
    server starts cleanly, and optionally rebuilds the semantic search indexes.

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
$McpDir = Join-Path $PSScriptRoot ".." "olive-mcp-server"
$McpDir = (Resolve-Path $McpDir).Path
$VenvDir = Join-Path $McpDir ".venv"

Write-Host ""
Write-Host "=== Olive MCP Server Setup ===" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check Python is available ──────────────────────────────────────────
Write-Host "[1/5] Checking Python..." -ForegroundColor Yellow
$pythonCmd = $null
foreach ($cmd in @("python", "python3")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($ver -match "Python 3\.(\d+)") {
            $minor = [int]$Matches[1]
            if ($minor -ge 10) {
                $pythonCmd = $cmd
                Write-Host "      Found: $ver" -ForegroundColor Green
                break
            }
        }
    } catch {}
}
if (-not $pythonCmd) {
    Write-Host "      ERROR: Python >= 3.10 not found on PATH." -ForegroundColor Red
    Write-Host "      Install Python 3.10+ and ensure 'python' is on PATH." -ForegroundColor Red
    exit 1
}

# ── Step 2: Create venv if it doesn't exist ────────────────────────────────────
Write-Host "[2/5] Setting up virtual environment..." -ForegroundColor Yellow
if (Test-Path $VenvDir) {
    Write-Host "      Venv already exists at: $VenvDir" -ForegroundColor DarkGray
} else {
    Write-Host "      Creating venv at: $VenvDir"
    & $pythonCmd -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "      ERROR: Failed to create venv." -ForegroundColor Red
        exit 1
    }
    Write-Host "      Created." -ForegroundColor Green
}

# ── Step 3: Install dependencies ───────────────────────────────────────────────
Write-Host "[3/5] Installing dependencies..." -ForegroundColor Yellow
$pipCmd = Join-Path $VenvDir "Scripts" "pip"
if (-not (Test-Path $pipCmd)) {
    # Linux/macOS fallback
    $pipCmd = Join-Path $VenvDir "bin" "pip"
}

# Core + dev + semantic deps, with mcp pinned <2
& $pipCmd install --upgrade pip --quiet 2>$null
& $pipCmd install -e "$McpDir[dev]" "mcp<2" --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "      ERROR: pip install failed." -ForegroundColor Red
    exit 1
}
Write-Host "      All dependencies installed (including sentence-transformers for semantic search)." -ForegroundColor Green

# ── Step 4: Verify server starts ───────────────────────────────────────────────
if (-not $SkipVerify) {
    Write-Host "[4/5] Verifying server starts..." -ForegroundColor Yellow
    $pythonVenv = Join-Path $VenvDir "Scripts" "python"
    if (-not (Test-Path $pythonVenv)) {
        $pythonVenv = Join-Path $VenvDir "bin" "python"
    }
    $testOutput = & $pythonVenv -c "from olive_mcp_server.mcp_server import _build_mcp; print('OK')" 2>&1
    if ($testOutput -match "OK") {
        Write-Host "      Server module imports successfully." -ForegroundColor Green
    } else {
        Write-Host "      WARNING: Server import check returned unexpected output:" -ForegroundColor Yellow
        Write-Host "      $testOutput" -ForegroundColor DarkGray
    }
} else {
    Write-Host "[4/5] Skipping verification (--SkipVerify)." -ForegroundColor DarkGray
}

# ── Step 5: Optionally rebuild semantic indexes ────────────────────────────────
if ($RebuildIndex) {
    Write-Host "[5/5] Rebuilding semantic search indexes..." -ForegroundColor Yellow
    $pythonVenv = Join-Path $VenvDir "Scripts" "python"
    if (-not (Test-Path $pythonVenv)) {
        $pythonVenv = Join-Path $VenvDir "bin" "python"
    }
    & $pythonVenv (Join-Path $McpDir "scripts" "build_kb_index.py")
    if ($LASTEXITCODE -ne 0) {
        Write-Host "      WARNING: Index rebuild failed. Shipped indexes will be used." -ForegroundColor Yellow
    } else {
        Write-Host "      Indexes rebuilt successfully." -ForegroundColor Green
    }
} else {
    Write-Host "[5/5] Skipping index rebuild (use -RebuildIndex to regenerate)." -ForegroundColor DarkGray
    Write-Host "      Pre-built indexes ship with the repo and work out of the box." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "The MCP server is ready. Kiro will connect via the olive-mcp-tools Power." -ForegroundColor Cyan
Write-Host "To test manually:  $VenvDir\Scripts\python $McpDir\run.py" -ForegroundColor DarkGray
Write-Host ""
