#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "Usage: $0 <output-node-path>" >&2
  exit 2
fi

OUTPUT_NODE="$1"
NODE_VERSION="$(node -p 'process.version')"
NODE_STAGE="$(mktemp -d)"
X64_ARCHIVE="node-${NODE_VERSION}-darwin-x64.tar.gz"
ARM64_ARCHIVE="node-${NODE_VERSION}-darwin-arm64.tar.gz"
trap 'rm -rf "$NODE_STAGE"' EXIT

curl --fail --silent --show-error --location --retry 3 \
  "https://nodejs.org/dist/${NODE_VERSION}/${X64_ARCHIVE}" \
  --output "$NODE_STAGE/$X64_ARCHIVE"
curl --fail --silent --show-error --location --retry 3 \
  "https://nodejs.org/dist/${NODE_VERSION}/${ARM64_ARCHIVE}" \
  --output "$NODE_STAGE/$ARM64_ARCHIVE"
curl --fail --silent --show-error --location --retry 3 \
  "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" \
  --output "$NODE_STAGE/SHASUMS256.txt"
{
  grep -F "  $X64_ARCHIVE" "$NODE_STAGE/SHASUMS256.txt"
  grep -F "  $ARM64_ARCHIVE" "$NODE_STAGE/SHASUMS256.txt"
} > "$NODE_STAGE/SHASUMS256.selected"
(cd "$NODE_STAGE" && shasum -a 256 -c SHASUMS256.selected)
tar -xzf "$NODE_STAGE/$X64_ARCHIVE" -C "$NODE_STAGE"
tar -xzf "$NODE_STAGE/$ARM64_ARCHIVE" -C "$NODE_STAGE"

mkdir -p "$(dirname "$OUTPUT_NODE")"
lipo -create \
  "$NODE_STAGE/node-${NODE_VERSION}-darwin-x64/bin/node" \
  "$NODE_STAGE/node-${NODE_VERSION}-darwin-arm64/bin/node" \
  -output "$OUTPUT_NODE"
chmod 0755 "$OUTPUT_NODE"
lipo -verify_arch x86_64 arm64 "$OUTPUT_NODE"
"$OUTPUT_NODE" --version
