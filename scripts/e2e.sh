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
for id in forms automate; do
  grep -Eq "\"id\": *\"$id\"[^}]*\"installed\": *true" <<<"$CAPS" || fail "capabilities: $id not installed (excerpt: ${CAPS:0:300})"
done

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
call() {
  npx -y @modelcontextprotocol/inspector@1 --cli node dist/index.js --method tools/call --tool-name "$1" \
    || fail "$1 call failed"
}
for tool in get-mcp-health forms--list-forms automate--list-automations; do
  OUT=$(call "$tool")
  if grep -Eq '"isError": *true' <<<"$OUT"; then fail "$tool returned isError (excerpt: ${OUT:0:300})"; fi
  case "$tool" in
    get-mcp-health)
      # The report is returned as structuredContent; check forms and automate are loaded.
      node -e "
        const r = JSON.parse(require('fs').readFileSync(0, 'utf8')).structuredContent;
        for (const id of ['forms', 'automate']) {
          const p = r.products.find((x) => x.id === id);
          if (!p || p.loaded !== true) { console.error('product not loaded: ' + id); process.exit(1); }
        }" <<<"$OUT" || fail "$tool: forms/automate not loaded (excerpt: ${OUT:0:300})" ;;
    *)
      grep -Eq '"total": *[0-9]+' <<<"$OUT" || fail "$tool: no total in result (excerpt: ${OUT:0:300})" ;;
  esac
  echo "   $tool ok"
done

echo "PASS"
