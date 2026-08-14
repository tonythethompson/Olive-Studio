#!/usr/bin/env bash
# Set up the Olive MCP Server Python virtual environment with all dependencies.
#
# Requires Python >= 3.10 and < 3.14 (3.13 or 3.12 preferred). Python 3.14+ is
# not supported yet because some dependencies (torch / sentence-transformers)
# do not ship 3.14 wheels. The semantic search indexes are (re)built when
# stale (set OLIVE_MCP_REBUILD_INDEX=1 to force a rebuild).
#
# Usage (from repo root):
#   ./scripts/setup-mcp.sh
#   ./scripts/setup-mcp.sh --skip-verify
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$ROOT/olive-mcp-server"
VENV_DIR="$MCP_DIR/.venv"

MIN_MINOR=10
MAX_MINOR=13

SKIP_VERIFY=0
for arg in "$@"; do
  case "$arg" in
    --skip-verify) SKIP_VERIFY=1 ;;
    -h|--help)
      echo "Usage: $0 [--skip-verify]"
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

# Print the minor version of a CPython 3.x interpreter (empty on failure).
python_minor() {
  local ver
  ver="$("$1" --version 2>&1 || true)"
  if [[ "$ver" =~ Python\ 3\.([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"
  fi
}

echo "[1/5] Checking Python (need 3.$MIN_MINOR-3.$MAX_MINOR; 3.13/3.12 preferred)..."
PYTHON_CMD=""
for cmd in python3.13 python3.12 python3.11 python3.10 python3 python; do
  if command -v "$cmd" >/dev/null 2>&1; then
    minor="$(python_minor "$cmd")"
    if [[ -n "$minor" ]] && (( minor >= MIN_MINOR && minor <= MAX_MINOR )); then
      PYTHON_CMD="$cmd"
      echo "      Found: $("$cmd" --version 2>&1)"
      break
    fi
  fi
done
# Fall back to uv-managed interpreters, which are usually not on PATH.
if [[ -z "$PYTHON_CMD" ]]; then
  for base in "$HOME/.local/share/uv/python" "$HOME/Library/Application Support/uv/python"; do
    [[ -d "$base" ]] || continue
    for minor in 13 12 11 10; do
      for cand in "$base"/cpython-3."$minor".*/bin/python3."$minor"; do
        if [[ -x "$cand" ]]; then
          PYTHON_CMD="$cand"
          echo "      Found: $("$cand" --version 2>&1) ($cand)"
          break 3
        fi
      done
    done
  done
fi
if [[ -z "$PYTHON_CMD" ]]; then
  echo "      ERROR: No compatible Python found (need >= 3.$MIN_MINOR, < 3.14)." >&2
  echo "      Python 3.14+ is not supported yet (torch/sentence-transformers lack 3.14 wheels)." >&2
  echo "      Install Python 3.13 or 3.12 and re-run this script." >&2
  exit 1
fi

echo "[2/5] Setting up virtual environment..."
if [[ -d "$VENV_DIR" ]]; then
  existing_py=""
  if [[ -x "$VENV_DIR/bin/python" ]]; then
    existing_py="$VENV_DIR/bin/python"
  elif [[ -x "$VENV_DIR/Scripts/python" ]]; then
    existing_py="$VENV_DIR/Scripts/python"
  fi
  recreate=0
  if [[ -z "$existing_py" ]]; then
    recreate=1
  else
    minor="$(python_minor "$existing_py")"
    if [[ -z "$minor" ]]; then
      recreate=1
    elif (( minor < MIN_MINOR )); then
      echo "      Existing venv is $("$existing_py" --version 2>&1) (< 3.$MIN_MINOR); recreating..."
      recreate=1
    elif (( minor > MAX_MINOR )); then
      echo "      Existing venv is $("$existing_py" --version 2>&1) (>= 3.14, unsupported); recreating..."
      recreate=1
    fi
  fi
  if [[ "$recreate" -eq 1 ]]; then
    rm -rf "$VENV_DIR"
    echo "      Creating venv at: $VENV_DIR"
    "$PYTHON_CMD" -m venv "$VENV_DIR"
    echo "      Created."
  else
    echo "      Venv already exists at: $VENV_DIR"
  fi
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
  if ! test_output="$("$PY_VENV" -c "from olive_mcp_server.mcp_server import _build_mcp; _build_mcp(); print('OK')" 2>&1)"; then
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

echo "[5/5] Building semantic search indexes (skipped when already up to date)..."
echo "      (embeds KB docs via sentence-transformers; a fresh build may take a few minutes)"
if ! "$PY_VENV" "$MCP_DIR/scripts/build_kb_index.py"; then
  echo "      WARNING: Index build failed. Shipped indexes will be used." >&2
else
  echo "      Semantic search indexes are up to date."
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "The MCP server is ready. Kiro will connect via the olive-mcp-tools Power."
echo "To test manually:  $PY_VENV $MCP_DIR/run.py"
echo ""
