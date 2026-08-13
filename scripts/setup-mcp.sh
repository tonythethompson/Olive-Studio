#!/usr/bin/env bash
# Setup the Olive MCP Server Python virtual environment with all dependencies.
#
# Usage (from repo root):
#   ./scripts/setup-mcp.sh
#   ./scripts/setup-mcp.sh --rebuild-index
#   ./scripts/setup-mcp.sh --skip-verify

set -e

REBUILD_INDEX=false
SKIP_VERIFY=false

for arg in "$@"; do
  case "$arg" in
    --rebuild-index) REBUILD_INDEX=true ;;
    --skip-verify) SKIP_VERIFY=true ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MCP_DIR="$SCRIPT_DIR/../olive-mcp-server"
MCP_DIR="$(cd "$MCP_DIR" && pwd)"
VENV_DIR="$MCP_DIR/.venv"

echo ""
echo "=== Olive MCP Server Setup ==="
echo ""

# ── Step 1: Check Python ───────────────────────────────────────────────────────
echo "[1/5] Checking Python..."
PYTHON_CMD=""
for cmd in python3 python; do
  if command -v "$cmd" &>/dev/null; then
    ver=$("$cmd" --version 2>&1)
    # POSIX/BSD-safe: avoid grep -P (GNU/PCRE only; fails on macOS).
    if echo "$ver" | grep -q 'Python 3'; then
      minor=$(printf '%s\n' "$ver" | sed 's/.*Python 3\.//' | sed 's/[^0-9].*//')
      if [ "$minor" -ge 10 ] 2>/dev/null; then
        PYTHON_CMD="$cmd"
        echo "      Found: $ver"
        break
      fi
    fi
  fi
done

if [ -z "$PYTHON_CMD" ]; then
  echo "      ERROR: Python >= 3.10 not found on PATH."
  exit 1
fi

# ── Step 2: Create venv ────────────────────────────────────────────────────────
echo "[2/5] Setting up virtual environment..."
if [ -d "$VENV_DIR" ]; then
  echo "      Venv already exists at: $VENV_DIR"
else
  echo "      Creating venv at: $VENV_DIR"
  "$PYTHON_CMD" -m venv "$VENV_DIR"
  echo "      Created."
fi

# ── Step 3: Install dependencies ───────────────────────────────────────────────
echo "[3/5] Installing dependencies..."
PIP_CMD="$VENV_DIR/bin/pip"
"$PIP_CMD" install --upgrade pip --quiet 2>/dev/null
"$PIP_CMD" install -e "$MCP_DIR[dev]" "mcp<2" --quiet
echo "      All dependencies installed (including sentence-transformers for semantic search)."

# ── Step 4: Verify ─────────────────────────────────────────────────────────────
if [ "$SKIP_VERIFY" = false ]; then
  echo "[4/5] Verifying server starts..."
  PYTHON_VENV="$VENV_DIR/bin/python"
  output=$("$PYTHON_VENV" -c "from olive_mcp_server.mcp_server import _build_mcp; print('OK')" 2>&1)
  if echo "$output" | grep -q "OK"; then
    echo "      Server module imports successfully."
  else
    echo "      WARNING: Unexpected output: $output"
  fi
else
  echo "[4/5] Skipping verification (--skip-verify)."
fi

# ── Step 5: Rebuild indexes ────────────────────────────────────────────────────
if [ "$REBUILD_INDEX" = true ]; then
  echo "[5/5] Rebuilding semantic search indexes..."
  PYTHON_VENV="$VENV_DIR/bin/python"
  "$PYTHON_VENV" "$MCP_DIR/scripts/build_kb_index.py" || {
    echo "      WARNING: Index rebuild failed. Shipped indexes will be used."
  }
else
  echo "[5/5] Skipping index rebuild (use --rebuild-index to regenerate)."
  echo "      Pre-built indexes ship with the repo and work out of the box."
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "The MCP server is ready. Kiro will connect via the olive-mcp-tools Power."
echo "To test manually:  $VENV_DIR/bin/python $MCP_DIR/run.py"
echo ""
