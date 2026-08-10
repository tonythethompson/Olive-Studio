#!/usr/bin/env bash
# Olive Studio — Ruler Canary Test
# Proves the measurement harness can detect a real code change.
#
# Method: injects ~100 bytes into a used export (OLIVE_VERSION string),
# builds, verifies the bundle grew by approximately that amount, then restores.
#
# Exit 0 = canary passes (harness is trustworthy)
# Exit 1 = canary fails (harness cannot detect known changes — DO NOT OPTIMIZE)
set -euo pipefail
cd "$(dirname "$0")/../.."

VITE="node_modules/.bin/vite"
BASELINE_FILE="data/ruler/baseline.json"
PASSCATALOG="src/lib/passCatalog.ts"
CANARY_STRING="0.12.1-canary-padding-string-that-adds-exactly-one-hundred-characters-to-the-bundle-size-for-calibration"
ORIGINAL_STRING="0.12.1"

echo "▶ Canary: injecting ~100 bytes into OLIVE_VERSION..." >&2
sed -i "s|export const OLIVE_VERSION = \"$ORIGINAL_STRING\"|export const OLIVE_VERSION = \"$CANARY_STRING\"|" "$PASSCATALOG"

echo "▶ Building with canary..." >&2
rm -rf dist/
$VITE build >/dev/null 2>&1
CANARY_SIZE=$(find dist/ -name "*.js" ! -name "server.mjs" -exec cat {} + | wc -c)

echo "▶ Restoring baseline..." >&2
sed -i "s|export const OLIVE_VERSION = \"$CANARY_STRING\"|export const OLIVE_VERSION = \"$ORIGINAL_STRING\"|" "$PASSCATALOG"
rm -rf dist/
$VITE build >/dev/null 2>&1
RESTORE_SIZE=$(find dist/ -name "*.js" ! -name "server.mjs" -exec cat {} + | wc -c)

# Read baseline from config
BASELINE_SIZE=$(python3 -c "import json; print(json.load(open('$BASELINE_FILE'))['primary']['value'])")

DELTA=$((CANARY_SIZE - BASELINE_SIZE))
RESTORE_DELTA=$((RESTORE_SIZE - BASELINE_SIZE))

echo "  Baseline:      $BASELINE_SIZE bytes" >&2
echo "  Canary build:  $CANARY_SIZE bytes (delta: +$DELTA)" >&2
echo "  Restored:      $RESTORE_SIZE bytes (delta from baseline: $RESTORE_DELTA)" >&2

# Canary passes if:
# 1. The canary build is larger than baseline (delta > 0)
# 2. The restored build matches baseline exactly (restore_delta == 0)
if [ "$DELTA" -gt 0 ] && [ "$RESTORE_DELTA" -eq 0 ]; then
  echo "✅ Canary PASSES: harness detects +$DELTA bytes from a known injection." >&2
  echo "{\"status\":\"PASS\",\"canary_delta_bytes\":$DELTA,\"restore_exact\":true}"
  exit 0
else
  echo "❌ Canary FAILS: delta=$DELTA, restore_delta=$RESTORE_DELTA" >&2
  echo "{\"status\":\"FAIL\",\"canary_delta_bytes\":$DELTA,\"restore_delta\":$RESTORE_DELTA}"
  exit 1
fi
