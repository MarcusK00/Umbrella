#!/usr/bin/env bash
# End-to-end smoke check against the running demo site. Requires npm/.env and a built npm/dist.
set -euo pipefail
# NOTE: greps use here-strings; `echo | grep -q` under pipefail fails with SIGPIPE on large output.
cd "$(dirname "$0")/../npm"
set -a; source .env; set +a

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "1. Capabilities endpoint"
TOKEN=$(curl -sk -X POST "$UMBRACO_BASE_URL/umbraco/management/api/v1/security/back-office/token" \
  -d grant_type=client_credentials -d client_id="$UMBRACO_CLIENT_ID" -d client_secret="$UMBRACO_CLIENT_SECRET" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).access_token))")
CAPS=$(curl -sk -H "Authorization: Bearer $TOKEN" "$UMBRACO_BASE_URL/umbraco/management/api/v1/mcp/capabilities")
echo "$CAPS"
grep -q '"id":"forms"' <<<"$CAPS" || fail "capabilities missing forms"
grep -q '"id":"automate"' <<<"$CAPS" || fail "capabilities missing automate"

echo "2. Tool list"
TOOLS=$(node dist/index.js --list-tools)
for prefix in "cms--" "forms--" "automate--"; do
  grep -q "^$prefix" <<<"$TOOLS" || fail "no $prefix tools"
done
grep -qx "get-mcp-health" <<<"$TOOLS" || fail "get-mcp-health missing"
echo "   $(echo "$TOOLS" | wc -l | tr -d ' ') tools"
LIST=$(npx -y @modelcontextprotocol/inspector@1 --cli node dist/index.js --method tools/list)
grep -q '\[Umbraco Forms\]' <<<"$LIST" || fail "tool descriptions are not product-prefixed"

echo "3. Smoke calls"
for tool in get-mcp-health forms--list-forms automate--list-automations; do
  npx -y @modelcontextprotocol/inspector@1 --cli node dist/index.js --method tools/call --tool-name "$tool" >/dev/null \
    || fail "$tool call failed"
  echo "   $tool ok"
done

echo "PASS"
