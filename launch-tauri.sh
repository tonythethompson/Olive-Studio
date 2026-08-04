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
  echo "node_modules missing — running pnpm install..."
  pnpm install
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
