#!/usr/bin/env bash
# Launch Olive Studio in the browser (web only — no Tauri shell).
# For the desktop app, use: ./launch-tauri.sh
#
# Usage:
#   ./launch.sh           # dev server (default)
#   ./launch.sh --prod    # production (requires dist/)
#   ./launch.sh --no-browser

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PROD=0
NO_BROWSER=0
for arg in "$@"; do
  case "$arg" in
    --prod) PROD=1 ;;
    --no-browser) NO_BROWSER=1 ;;
    -h|--help)
      echo "Usage: $0 [--prod] [--no-browser]"
      exit 0
      ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install with: npm install -g pnpm@11.17.0 (or enable Corepack)." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "node_modules missing — running pnpm install..."
  pnpm install
fi

URL="http://localhost:3000"

open_browser() {
  sleep 2
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  fi
}

if [[ "$PROD" -eq 1 ]]; then
  if [[ ! -f dist/server.mjs ]]; then
    echo "dist/server.mjs not found — running pnpm build..."
    pnpm build
  fi
  echo "Starting Olive Studio (production) at $URL ..."
  if [[ "$NO_BROWSER" -eq 0 ]]; then open_browser & fi
  exec pnpm start
else
  echo "Starting Olive Studio (dev) at $URL ..."
  echo "  Ctrl+C to stop."
  if [[ "$NO_BROWSER" -eq 0 ]]; then open_browser & fi
  exec pnpm dev
fi
