#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || -z "$1" ]]; then
  echo "Usage: $0 <bundle-directory> [port]" >&2
  exit 2
fi

BUNDLE_DIR="$1"
PORT="${2:-31415}"
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || ((PORT < 1 || PORT > 65535)); then
  echo "ERROR: Port must be an integer between 1 and 65535" >&2
  exit 2
fi

if [[ ! -d "$BUNDLE_DIR/macos" ]]; then
  echo "ERROR: macOS bundle directory not found at $BUNDLE_DIR/macos"
  exit 1
fi
BUNDLE_DIR="$(cd "$BUNDLE_DIR" && pwd -P)"

APP_BUNDLE="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name '*.app' -print -quit)"
if [[ -z "$APP_BUNDLE" ]]; then
  echo "ERROR: No .app bundle found in $BUNDLE_DIR/macos"
  exit 1
fi
echo "Found app bundle: $APP_BUNDLE"

RESOURCES="$APP_BUNDLE/Contents/Resources"
NODE="$RESOURCES/node-runtime/node"
if [[ ! -f "$NODE" ]]; then
  echo "ERROR: Bundled Node runtime not found at $NODE"
  echo "Contents of Resources/node-runtime/:"
  ls -la "$RESOURCES/node-runtime/" 2>/dev/null || echo "(directory missing)"
  exit 1
fi
test -x "$NODE"
# Xcode 26+ lipo requires the input file before -verify_arch.
lipo "$NODE" -verify_arch x86_64 arm64
echo "Bundled Node version: $("$NODE" --version)"

SERVER_MJS="$RESOURCES/dist/server.mjs"
if [[ ! -f "$SERVER_MJS" ]]; then
  echo "ERROR: server.mjs not found at $SERVER_MJS"
  exit 1
fi

SERVER_PID=""
stop_server() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}
trap stop_server EXIT

(
  cd "$RESOURCES"
  PORT="$PORT" exec "$NODE" dist/server.mjs
) &
SERVER_PID=$!

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "macOS smoke test passed — server started from packaged .app bundle"
    exit 0
  fi
  sleep 1
done
echo "macOS smoke test FAILED — server did not respond within 20s"
exit 1
