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
  echo "pnpm is required. If corepack is missing (Node 25+), run: npm install -g corepack" >&2
  echo "Then activate pnpm: corepack enable && corepack install pnpm@11.17.0" >&2
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
  local self_pid=$$
  local parent_pid=${PPID:-0}

  is_self_or_parent() {
    local pid="$1"
    [[ -z "$pid" ]] && return 1
    [[ "$pid" == "$self_pid" || "$pid" == "$parent_pid" ]] && return 0
    return 1
  }

  # True when $ROOT appears as a full path token (not a prefix of a sibling checkout
  # such as /tmp/olive matching /tmp/olive-pr-98).
  cmdline_belongs_to_repo() {
    local cmd="$1"
    local root="$ROOT"
    local root_len=${#root}
    local search="$cmd"
    local prefix idx after
    while [[ "$search" == *"$root"* ]]; do
      prefix="${search%%"$root"*}"
      idx=${#prefix}
      after="${search:$((idx + root_len)):1}"
      if [[ -z "$after" || "$after" == "/" || "$after" == "\\" || "$after" == " " || "$after" == $'\t' || "$after" == '"' || "$after" == "'" ]]; then
        return 0
      fi
      search="${search:$((idx + 1))}"
    done
    return 1
  }

  if command -v lsof >/dev/null 2>&1; then
    while read -r pid; do
      [[ -z "$pid" ]] && continue
      if is_self_or_parent "$pid"; then
        continue
      fi
      local cmd
      cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
      # Only stop listeners whose command line belongs to this checkout.
      if cmdline_belongs_to_repo "$cmd"; then
        echo "  Port ${port}: stopping Olive Studio PID ${pid}"
        kill "$pid" 2>/dev/null || true
        sleep 0.3
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
      fi
    done < <(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  fi

  # Repo-scoped leftover tauri / server / desktop processes (avoid nuking unrelated installs).
  # Skip this shell and its parent: absolute-path launchers include $ROOT and "tauri" in argv.
  # Broad pgrep, then boundary-filter so sibling checkouts are not force-killed.
  if command -v pgrep >/dev/null 2>&1; then
    local match_pids
    match_pids="$(pgrep -f "$ROOT" 2>/dev/null || true)"
    if [[ -n "$match_pids" ]]; then
      local pid cmd
      local repo_pids=()
      for pid in $match_pids; do
        if is_self_or_parent "$pid"; then
          continue
        fi
        cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
        if ! cmdline_belongs_to_repo "$cmd"; then
          continue
        fi
        if [[ "$cmd" == *launch-tauri.sh* || "$cmd" == *launch-tauri.ps1* || "$cmd" == *launch-tauri.cmd* ]]; then
          continue
        fi
        if [[ "$cmd" == *tauri* || "$cmd" == *server.ts* || "$cmd" == *server.mjs* || "$cmd" == *olive-studio* || "$cmd" == *"Olive Studio"* ]]; then
          repo_pids+=("$pid")
        fi
      done
      for pid in "${repo_pids[@]+"${repo_pids[@]}"}"; do
        echo "  Stopping leftover PID $pid"
        kill "$pid" 2>/dev/null || true
      done
      sleep 0.2
      for pid in "${repo_pids[@]+"${repo_pids[@]}"}"; do
        if kill -0 "$pid" 2>/dev/null; then
          kill -9 "$pid" 2>/dev/null || true
        fi
      done
    fi
  fi

  sleep 0.3
}

if [[ "$BUILD" -eq 0 ]]; then
  stop_olive_studio_dev_stack
fi

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
