#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "=== matcher.test.mjs ==="
node tests/matcher.test.mjs
echo
echo "=== cleanup.test.mjs ==="
node tests/cleanup.test.mjs
echo
echo "All tests passed."
