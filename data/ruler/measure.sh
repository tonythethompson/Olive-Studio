#!/usr/bin/env bash
# Olive Studio — Auto-Improvement Ruler Measurement Harness
# Primary metric: production bundle size (bytes, lower is better)
# Secondary: tsc --noEmit wall-clock (seconds, lower is better)
# Guardrail: all tests must pass (exit 0)
#
# Usage: ./data/ruler/measure.sh [--json]
# Output: JSON to stdout with metric values
set -euo pipefail
cd "$(dirname "$0")/../.."

VITEST="node_modules/.bin/vitest"
TSC="node_modules/.bin/tsc"
VITE="node_modules/.bin/vite"
ESBUILD="node_modules/.bin/esbuild"

# --- Guardrail: tests must pass ---
echo "▶ Running unit tests..." >&2
if ! $VITEST run >/dev/null 2>&1; then
  echo '{"status":"FAIL","reason":"unit tests failed"}'
  exit 1
fi

echo "▶ Running server tests..." >&2
if ! $VITEST run --config vitest.server.config.ts >/dev/null 2>&1; then
  echo '{"status":"FAIL","reason":"server tests failed"}'
  exit 1
fi

# --- Guardrail: type-check must pass ---
echo "▶ Type-checking..." >&2
TSC_START=$(date +%s%N)
if ! $TSC --noEmit 2>/dev/null; then
  echo '{"status":"FAIL","reason":"tsc --noEmit failed"}'
  exit 1
fi
TSC_END=$(date +%s%N)
TSC_MS=$(( (TSC_END - TSC_START) / 1000000 ))

# --- Primary metric: production build bundle size ---
echo "▶ Building..." >&2
rm -rf dist/
$VITE build >/dev/null 2>&1
$ESBUILD server.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server.mjs >/dev/null 2>&1

# Measure: total client JS bytes (uncompressed, excludes server.mjs)
CLIENT_JS_BYTES=$(find dist/ -name "*.js" ! -name "server.mjs" -exec cat {} + | wc -c)
# Measure: total client JS gzipped bytes
CLIENT_GZ_BYTES=$(find dist/ -name "*.js.gz" -exec cat {} + | wc -c)
# Measure: server bundle size
SERVER_BYTES=$(wc -c < dist/server.mjs)
# CSS size
CSS_BYTES=$(find dist/ -name "*.css" -exec cat {} + | wc -c)
# Chunk count
CHUNK_COUNT=$(find dist/assets/ -name "*.js" | wc -l)

echo "▶ Done." >&2
cat <<EOF
{
  "status": "OK",
  "primary": {
    "label": "client_js_bytes",
    "value": $CLIENT_JS_BYTES,
    "unit": "bytes",
    "direction": "lower_is_better"
  },
  "secondary": [
    {"label": "client_gz_bytes", "value": $CLIENT_GZ_BYTES, "unit": "bytes"},
    {"label": "server_bytes", "value": $SERVER_BYTES, "unit": "bytes"},
    {"label": "css_bytes", "value": $CSS_BYTES, "unit": "bytes"},
    {"label": "tsc_ms", "value": $TSC_MS, "unit": "ms"},
    {"label": "chunk_count", "value": $CHUNK_COUNT, "unit": "count"}
  ],
  "guardrails": {
    "unit_tests": "pass",
    "server_tests": "pass",
    "type_check": "pass"
  }
}
EOF
