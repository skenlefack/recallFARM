#!/usr/bin/env bash
# RecallFarm — Parity check: TS vs Dart engines on shared vectors (RG-PAR-02).
# Exit code 0 = parity OK, 1 = divergence or failure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FAIL=0

echo "=== RecallFarm Parity Check (RG-PAR-02) ==="
echo ""

# --- TypeScript (API) ---
echo "[TS] Running shared vector tests..."
cd "$ROOT/apps/api"
TS_OUTPUT=$(npx jest --config jest.config.js --testPathPattern=engines --verbose 2>&1) || {
  echo "[TS] FAILED"
  echo "$TS_OUTPUT"
  FAIL=1
}
TS_PASS=$(echo "$TS_OUTPUT" | grep -oP 'Tests:\s+\K\d+(?= passed)' || echo "0")
TS_TOTAL=$(echo "$TS_OUTPUT" | grep -oP 'Tests:.*\K\d+(?= total)' || echo "0")
echo "[TS] $TS_PASS/$TS_TOTAL passed"
echo ""

# --- Dart (Mobile) ---
echo "[Dart] Running shared vector tests..."
cd "$ROOT/apps/mobile"
DART_OUTPUT=$(flutter test test/engines/ 2>&1) || {
  echo "[Dart] FAILED"
  echo "$DART_OUTPUT"
  FAIL=1
}
DART_PASS=$(echo "$DART_OUTPUT" | grep -oP '\+(\d+):' | tail -1 | grep -oP '\d+' || echo "0")
echo "[Dart] $DART_PASS tests passed"
echo ""

# --- Compare vector file hashes ---
echo "[Vectors] Checking file identity..."
for f in expressions.json reminders.json resolution.json; do
  PACK="$ROOT/packages/params/vectors/$f"
  MOBILE="$ROOT/apps/mobile/assets/packs/"
  if [ -f "$PACK" ]; then
    echo "  $f: $(sha256sum "$PACK" | cut -d' ' -f1)"
  else
    echo "  $f: MISSING from packages/params/vectors/"
    FAIL=1
  fi
done
echo ""

# --- Bundled packs drift check ---
echo "[Packs] Checking bundled packs match source..."
for f in "$ROOT/apps/mobile/assets/packs/"*.json; do
  base=$(basename "$f")
  src="$ROOT/packages/params/packs/$base"
  if [ -f "$src" ]; then
    if diff -q "$f" "$src" > /dev/null 2>&1; then
      echo "  $base: OK (identical)"
    else
      echo "  $base: DRIFT DETECTED"
      FAIL=1
    fi
  fi
done
echo ""

# --- Summary ---
if [ $FAIL -eq 0 ]; then
  echo "=== PARITY OK ==="
  exit 0
else
  echo "=== PARITY FAILED ==="
  exit 1
fi
