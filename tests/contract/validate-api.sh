#!/usr/bin/env bash
# RecallFarm — Contract validation: API responses match expected behavior.
# Requires: curl. Run: bash tests/contract/validate-api.sh [BASE_URL]
set -euo pipefail

BASE="${1:-http://localhost:9080/v1}"
FAIL=0
PASS=0

ok()   { echo "  OK   $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL $1"; FAIL=$((FAIL + 1)); }

check_status() {
  local desc="$1" method="$2" endpoint="$3" expected="$4"
  local opts="-s -o /dev/null -w %{http_code}"
  local status
  if [ "$method" = "POST" ]; then
    status=$(curl $opts -X POST -H "Content-Type: application/json" -d '{}' "$BASE$endpoint" 2>/dev/null || echo "000")
  else
    status=$(curl $opts "$BASE$endpoint" 2>/dev/null || echo "000")
  fi
  [ "$status" = "$expected" ] && ok "$desc ($status)" || fail "$desc — expected $expected, got $status"
}

check_body_contains() {
  local desc="$1" endpoint="$2" needle="$3"
  local body
  body=$(curl -s "$BASE$endpoint" 2>/dev/null || echo "")
  echo "$body" | grep -q "$needle" && ok "$desc (contains '$needle')" || fail "$desc — missing '$needle'"
}

echo "=== RecallFarm API Contract Validation ==="
echo "Base: $BASE"
echo ""

echo "--- Health & Readiness ---"
check_status "GET /health returns 200" GET "/health" "200"
check_body_contains "/health has status:ok" "/health" '"status":"ok"'
check_body_contains "/health has service name" "/health" '"service"'
check_status "GET /ready returns 200" GET "/ready" "200"

echo ""
echo "--- Public endpoints ---"
check_status "GET /plans returns 200" GET "/plans" "200"

echo ""
echo "--- Auth ---"
# NestJS validation pipe returns 422 for invalid DTO (acceptable: 400 or 422)
check_status "POST /auth/otp/request with empty body rejects" POST "/auth/otp/request" "422"

echo ""
echo "--- Protected endpoints (no auth -> 401) ---"
check_status "GET /me without token" GET "/me" "401"
check_status "GET /farms without token" GET "/farms" "401"
check_status "GET /sync/pull without token" GET "/sync/pull" "401"

echo ""
echo "--- Summary ---"
TOTAL=$((PASS + FAIL))
echo "$PASS/$TOTAL checks passed, $FAIL failed"
[ $FAIL -gt 0 ] && { echo "=== CONTRACT FAILED ==="; exit 1; } || { echo "=== CONTRACT OK ==="; exit 0; }
