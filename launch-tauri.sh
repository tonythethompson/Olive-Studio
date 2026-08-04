#!/usr/bin/env bash
# Launch Olive Studio desktop shell (Tauri 2)
# Starts the native window; beforeDevCommand runs `pnpm dev` for the web backend.
#
# Usage:
#   ./launch-tauri.sh           # tauri dev (default)
#   ./launch-tauri.sh --build   # tauri build (package; does not open the app)

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    -h|--help)
      echo "Usage: $0 [--build]"
      exit 0
      ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install with: npm install -g pnpm@11.17.0 (or enable Corepack)." >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust / cargo is required for the Tauri shell." >&2
  echo "Install from https://rustup.rs/ then reopen this terminal." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "node_modules missing - running pnpm install..."
  pnpm install
fi

# Free port 3000 and stop leftover Olive Studio / Tauri processes for this repo.
stop_olive_studio_dev_stack() {
  echo "Stopping any running Olive Studio servers / Tauri leftovers..."

  local port=3000
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    # fuser prints PIDs to stderr; kill directly
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  elif command -v powershell.exe >/dev/null 2>&1; then
    # Git Bash / WSL-with-Windows: reuse the PowerShell port killer
    powershell.exe -NoProfile -Command \
      "Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue }" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n "${pids}" ]]; then
    echo "  Port ${port}: stopping PID(s) ${pids//$'\n'/ }"
    # shellcheck disable=SC2086
    kill ${pids} 2>/dev/null || true
    sleep 0.3
    # shellcheck disable=SC2086
    kill -9 ${pids} 2>/dev/null || true
  fi

  # Named desktop app processes (best-effort across platforms)
  if command -v pkill >/dev/null 2>&1; then
    pkill -f "Olive Studio" 2>/dev/null || true
    pkill -x "olive-studio" 2>/dev/null || true
  elif command -v taskkill.exe >/dev/null 2>&1; then
    taskkill.exe /F /IM "Olive Studio.exe" >/dev/null 2>&1 || true
    taskkill.exe /F /IM "olive-studio.exe" >/dev/null 2>&1 || true
  fi

  # Repo-scoped leftover tauri / server processes (avoid nuking unrelated node apps)
  if command -v pgrep >/dev/null 2>&1; then
    local match_pids
    match_pids="$(pgrep -f "$ROOT" 2>/dev/null || true)"
    if [[ -n "$match_pids" ]]; then
      local pid cmd
      for pid in $match_pids; do
        cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
        if [[ "$cmd" == *tauri* || "$cmd" == *server.ts* || "$cmd" == *server.mjs* ]]; then
          echo "  Stopping leftover PID $pid"
          kill "$pid" 2>/dev/null || true
        fi
      done
      sleep 0.2
      for pid in $match_pids; do
        if kill -0 "$pid" 2>/dev/null; then
          cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
          if [[ "$cmd" == *tauri* || "$cmd" == *server.ts* || "$cmd" == *server.mjs* ]]; then
            kill -9 "$pid" 2>/dev/null || true
          fi
        fi
      done
    fi
  fi

  sleep 0.3
}

stop_olive_studio_dev_stack

# Tauri bundle.resources maps ../dist -> dist and validates the path at cargo build,
# including `tauri dev`. Fresh clones/worktrees often have no dist/ yet.
if [[ ! -d dist ]]; then
  echo "Creating empty dist/ so Tauri resource paths resolve (run pnpm build for a production bundle)..."
  mkdir -p dist
fi

if [[ "$BUILD" -eq 1 ]]; then
  echo "Building Olive Studio desktop package (pnpm tauri:build)..."
  echo "  This runs pnpm build first (see tauri.conf.json beforeBuildCommand)."
  exec pnpm tauri:build
fi

echo "Starting Olive Studio desktop (Tauri dev)..."
echo "  Web backend: http://127.0.0.1:3000 (auto via beforeDevCommand)"
echo "  Ctrl+C to stop both the window and the web server."
exec pnpm tauri:dev
