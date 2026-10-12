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
for id in forms automate engage; do
  grep -Eq "\"id\": *\"$id\"[^}]*\"installed\": *true" <<<"$CAPS" || fail "capabilities: $id not installed (excerpt: ${CAPS:0:300})"
done

echo "2. Tool list"
TOOLS=$(node dist/index.js --list-tools)
for prefix in "cms--" "forms--" "automate--" "engage--"; do
  grep -q "^$prefix" <<<"$TOOLS" || fail "no $prefix tools"
done
grep -qx "get-mcp-health" <<<"$TOOLS" || fail "get-mcp-health missing"
echo "   $(echo "$TOOLS" | wc -l | tr -d ' ') tools"
LIST=$(npx -y @modelcontextprotocol/inspector@1 --cli node dist/index.js --method tools/list)
grep -q '\[Umbraco Forms\]' <<<"$LIST" || fail "tool descriptions are not product-prefixed"

echo "3. Backoffice tool settings"
API="$UMBRACO_BASE_URL/umbraco/management/api/v1/mcp"
SETTINGS=$(curl -sfk -H "Authorization: Bearer $TOKEN" "$API/tool-settings") || fail "GET tool-settings failed"
# The --list-tools run above reported the catalogue.
node -e "
  const s = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const forms = s.catalogue.modules.forms;
  if (!forms || !forms.collections.some((c) => c.name === 'prevalue-source')) { console.error('forms not reported'); process.exit(1); }" <<<"$SETTINGS" \
  || fail "catalogue does not list forms/prevalue-source (excerpt: ${SETTINGS:0:300})"
ORIGINAL=$(node -e "const s = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(JSON.stringify({ disabledCollections: s.disabledCollections }));" <<<"$SETTINGS")
put_settings() {
  curl -sfk -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$1" "$API/tool-settings" >/dev/null
}
trap 'put_settings "$ORIGINAL" || true' EXIT
put_settings '{"disabledCollections":{"forms":["prevalue-source"]}}' || fail "PUT tool-settings failed"
TOOLS_OFF=$(node dist/index.js --list-tools)
# The separate prevalue-source-type group stays on, so leave its tools out of the check.
# No `grep -q` at the end of the pipe: under pipefail an early exit could SIGPIPE the first grep and hide a leak.
LEFT=$(grep "^forms--.*prevalue-source" <<<"$TOOLS_OFF" | grep -v "prevalue-source-type" || true)
[ -z "$LEFT" ] || fail "prevalue-source tools still listed after disabling them: $LEFT"
grep -qx "forms--list-forms" <<<"$TOOLS_OFF" || fail "other forms tools vanished"
put_settings "$ORIGINAL" || fail "could not restore tool settings"
trap - EXIT
echo "   disabling forms prevalue-source removed its tools"

echo "4. Smoke calls"
call() {
  npx -y @modelcontextprotocol/inspector@1 --cli node dist/index.js --method tools/call --tool-name "$1" \
    || fail "$1 call failed"
}
for tool in get-mcp-health forms--list-forms automate--list-automations; do
  OUT=$(call "$tool")
  if grep -Eq '"isError": *true' <<<"$OUT"; then fail "$tool returned isError (excerpt: ${OUT:0:300})"; fi
  case "$tool" in
    get-mcp-health)
      # The report is returned as structuredContent; check forms, automate and engage are loaded.
      node -e "
        const r = JSON.parse(require('fs').readFileSync(0, 'utf8')).structuredContent;
        for (const id of ['forms', 'automate', 'engage']) {
          const p = r.products.find((x) => x.id === id);
          if (!p || p.loaded !== true) { console.error('product not loaded: ' + id); process.exit(1); }
        }" <<<"$OUT" || fail "$tool: forms/automate/engage not loaded (excerpt: ${OUT:0:300})" ;;
    *)
      grep -Eq '"total": *[0-9]+' <<<"$OUT" || fail "$tool: no total in result (excerpt: ${OUT:0:300})" ;;
  esac
  echo "   $tool ok"
done

echo "PASS"
