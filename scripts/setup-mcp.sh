#!/usr/bin/env bash
# Set up the Olive MCP Server Python virtual environment with all dependencies.
#
# Requires Python >= 3.10 and < 3.14 (3.13 or 3.12 preferred). Indexes are
# rebuilt when stale; --rebuild-index or OLIVE_MCP_REBUILD_INDEX=1 forces it.
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
PYTHON_MIN_MINOR=10
PYTHON_MAX_MINOR=13
PYTHON_CMD=""
PYTHON_PREFIX_ARGS=()

supported_python() {
  local cmd="$1"
  shift
  local ver
  if [[ $# -gt 0 ]]; then
    ver="$("$cmd" "$@" --version 2>&1 || true)"
  else
    ver="$("$cmd" --version 2>&1 || true)"
  fi
  if [[ "$ver" =~ Python\ 3\.([0-9]+) ]]; then
    local minor="${BASH_REMATCH[1]}"
    if [[ "$minor" -ge "$PYTHON_MIN_MINOR" && "$minor" -le "$PYTHON_MAX_MINOR" ]]; then
      return 0
    fi
  fi
  return 1
}

create_venv() {
  if [[ ${#PYTHON_PREFIX_ARGS[@]} -gt 0 ]]; then
    "$PYTHON_CMD" "${PYTHON_PREFIX_ARGS[@]}" -m venv "$VENV_DIR"
  else
    "$PYTHON_CMD" -m venv "$VENV_DIR"
  fi
}

if [[ -n "${OLIVE_STUDIO_PYTHON:-}" ]]; then
  if [[ -n "${OLIVE_STUDIO_PYTHON_ARGS:-}" ]]; then
    while IFS= read -r arg || [[ -n "$arg" ]]; do
      [[ -n "$arg" ]] && PYTHON_PREFIX_ARGS+=("$arg")
    done <<< "$OLIVE_STUDIO_PYTHON_ARGS"
  fi
  if supported_python "$OLIVE_STUDIO_PYTHON" "${PYTHON_PREFIX_ARGS[@]+"${PYTHON_PREFIX_ARGS[@]}"}"; then
    PYTHON_CMD="$OLIVE_STUDIO_PYTHON"
    if [[ ${#PYTHON_PREFIX_ARGS[@]} -gt 0 ]]; then
      echo "      Found: $("$PYTHON_CMD" "${PYTHON_PREFIX_ARGS[@]}" --version 2>&1 || true)"
    else
      echo "      Found: $("$PYTHON_CMD" --version 2>&1 || true)"
    fi
  else
    PYTHON_PREFIX_ARGS=()
  fi
fi

if [[ -z "$PYTHON_CMD" ]]; then
  for cmd in python3.13 python3.12 python3.11 python3.10 python3 python; do
    if command -v "$cmd" >/dev/null 2>&1 && supported_python "$cmd"; then
      PYTHON_CMD="$cmd"
      echo "      Found: $("$cmd" --version 2>&1 || true)"
      break
    fi
  done
fi

if [[ -z "$PYTHON_CMD" ]] && command -v py >/dev/null 2>&1; then
  for flag in -3.13 -3.12 -3.11 -3.10; do
    if supported_python py "$flag"; then
      PYTHON_CMD="py"
      PYTHON_PREFIX_ARGS=("$flag")
      echo "      Found: $(py "$flag" --version 2>&1 || true)"
      break
    fi
  done
fi

if [[ -z "$PYTHON_CMD" ]]; then
  for base in "$HOME/.local/share/uv/python" "$HOME/Library/Application Support/uv/python"; do
    [[ -d "$base" ]] || continue
    for minor in 13 12 11 10; do
      for cand in "$base"/cpython-3."$minor".*/bin/python3."$minor"; do
        if [[ -x "$cand" ]] && supported_python "$cand"; then
          PYTHON_CMD="$cand"
          echo "      Found: $("$cand" --version 2>&1 || true) ($cand)"
          break 3
        fi
      done
    done
  done
fi

if [[ -z "$PYTHON_CMD" ]]; then
  echo "      ERROR: Python 3.10–3.13 (3.12 recommended) not found on PATH." >&2
  echo "      Debian/Ubuntu: sudo apt install -y python3 python3-venv python3-pip" >&2
  echo "      Fedora:        sudo dnf install -y python3 python3-pip" >&2
  echo "      macOS:         brew install python@3.12" >&2
  echo "      Download:      https://www.python.org/downloads/" >&2
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
    ver="$("$existing_py" --version 2>&1 || true)"
    if [[ "$ver" =~ Python\ 3\.([0-9]+) ]]; then
      existing_minor="${BASH_REMATCH[1]}"
      if [[ "$existing_minor" -lt "$PYTHON_MIN_MINOR" || "$existing_minor" -gt "$PYTHON_MAX_MINOR" ]]; then
        echo "      Existing venv is $ver (need 3.10–3.13); recreating..."
        recreate=1
      fi
    else
      recreate=1
    fi
  fi
  if [[ "$recreate" -eq 1 ]]; then
    rm -rf "$VENV_DIR"
    echo "      Creating venv at: $VENV_DIR"
    create_venv
    echo "      Created."
  else
    echo "      Venv already exists at: $VENV_DIR"
  fi
else
  echo "      Creating venv at: $VENV_DIR"
  create_venv
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
if [[ "$REBUILD_INDEX" -eq 1 ]]; then
  export OLIVE_MCP_REBUILD_INDEX=1
fi
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
