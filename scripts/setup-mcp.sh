#!/usr/bin/env bash
# Set up the Olive MCP Server Python virtual environment with all dependencies.
#
# Usage (from repo root):
#   ./scripts/setup-mcp.sh
#   ./scripts/setup-mcp.sh --rebuild-index
#   ./scripts/setup-mcp.sh --skip-verify
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$ROOT/olive-mcp-server"
VENV_DIR="$MCP_DIR/.venv"

REBUILD_INDEX=0
SKIP_VERIFY=0
for arg in "$@"; do
  case "$arg" in
    --rebuild-index) REBUILD_INDEX=1 ;;
    --skip-verify) SKIP_VERIFY=1 ;;
    -h|--help)
      echo "Usage: $0 [--rebuild-index] [--skip-verify]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

echo ""
echo "=== Olive MCP Server Setup ==="
echo ""

echo "[1/5] Checking Python..."
PYTHON_CMD=""
for cmd in python3 python; do
  if command -v "$cmd" >/dev/null 2>&1; then
    ver="$("$cmd" --version 2>&1 || true)"
    if [[ "$ver" =~ Python\ 3\.([0-9]+) ]]; then
      minor="${BASH_REMATCH[1]}"
      if [[ "$minor" -ge 10 ]]; then
        PYTHON_CMD="$cmd"
        echo "      Found: $ver"
        break
      fi
    fi
  fi
done
if [[ -z "$PYTHON_CMD" ]]; then
  echo "      ERROR: Python >= 3.10 not found on PATH." >&2
  exit 1
fi

echo "[2/5] Setting up virtual environment..."
if [[ -d "$VENV_DIR" ]]; then
  echo "      Venv already exists at: $VENV_DIR"
else
  echo "      Creating venv at: $VENV_DIR"
  "$PYTHON_CMD" -m venv "$VENV_DIR"
  echo "      Created."
fi

if [[ -x "$VENV_DIR/bin/pip" ]]; then
  PIP_CMD="$VENV_DIR/bin/pip"
  PY_VENV="$VENV_DIR/bin/python"
elif [[ -x "$VENV_DIR/Scripts/pip" ]]; then
  PIP_CMD="$VENV_DIR/Scripts/pip"
  PY_VENV="$VENV_DIR/Scripts/python"
else
  echo "      ERROR: venv pip not found." >&2
  exit 1
fi

echo "[3/5] Installing dependencies..."
"$PIP_CMD" install --upgrade pip --quiet
"$PIP_CMD" install -e "${MCP_DIR}[dev]" "mcp<2" --quiet
echo "      All dependencies installed (including sentence-transformers for semantic search)."

if [[ "$SKIP_VERIFY" -eq 0 ]]; then
  echo "[4/5] Verifying server starts..."
  if ! test_output="$("$PY_VENV" -c "from olive_mcp_server.mcp_server import _build_mcp; print('OK')" 2>&1)"; then
    echo "      WARNING: Server import check failed:" >&2
    echo "      $test_output" >&2
    exit 1
  fi
  if [[ "$test_output" != *OK* ]]; then
    echo "      WARNING: Server import check returned unexpected output:" >&2
    echo "      $test_output" >&2
    exit 1
  fi
  echo "      Server module imports successfully."
else
  echo "[4/5] Skipping verification (--skip-verify)."
fi

if [[ "$REBUILD_INDEX" -eq 1 ]]; then
  echo "[5/5] Rebuilding semantic search indexes..."
  if ! "$PY_VENV" "$MCP_DIR/scripts/build_kb_index.py"; then
    echo "      WARNING: Index rebuild failed. Shipped indexes will be used."
  else
    echo "      Indexes rebuilt successfully."
  fi
else
  echo "[5/5] Skipping index rebuild (use --rebuild-index to regenerate)."
  echo "      Pre-built indexes ship with the repo and work out of the box."
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "The MCP server is ready. Kiro will connect via the olive-mcp-tools Power."
echo "To test manually:  $PY_VENV $MCP_DIR/run.py"
echo ""
