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
ORIGINAL=$(node -e "const s = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(JSON.stringify({ disabledCollections: s.disabledCollections, readOnlyModules: s.readOnlyModules, noDestructiveModules: s.noDestructiveModules || [], offModules: s.offModules || [] }));" <<<"$SETTINGS")
put_settings() {
  curl -sfk -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$1" "$API/tool-settings" >/dev/null
}
# The checks below change the defaults, so this API user must follow them: its own settings are parked until the end.
USER_KEY=$(CLIENT_ID="$UMBRACO_CLIENT_ID" node -e "
  const s = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const u = (s.apiUsers || []).find((u) => u.clientIds.includes(process.env.CLIENT_ID));
  if (!u) { console.error('no API user with client id ' + process.env.CLIENT_ID); process.exit(1); }
  console.log(u.key);" <<<"$SETTINGS") || fail "could not find this API user in tool-settings"
USER_ORIGINAL=$(curl -sfk -H "Authorization: Bearer $TOKEN" "$API/tool-settings/users/$USER_KEY" \
  | node -e "const s = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(JSON.stringify({ overrides: s.overrides || {} }));") \
  || fail "GET this API user's tool settings failed"
put_user_settings() {
  curl -sfk -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$1" "$API/tool-settings/users/$USER_KEY" >/dev/null
}
restore() {
  put_settings "$ORIGINAL" || echo "WARN: could not restore the default tool settings" >&2
  put_user_settings "$USER_ORIGINAL" || echo "WARN: could not restore this API user's own tool settings" >&2
}
trap restore EXIT
put_user_settings '{"overrides":{}}' || fail "could not clear this API user's own tool settings"
put_settings '{"disabledCollections":{"forms":["prevalue-source"]}}' || fail "PUT tool-settings failed"
TOOLS_OFF=$(node dist/index.js --list-tools)
# The separate prevalue-source-type group stays on, so leave its tools out of the check.
# No `grep -q` at the end of the pipe: under pipefail an early exit could SIGPIPE the first grep and hide a leak.
LEFT=$(grep "^forms--.*prevalue-source" <<<"$TOOLS_OFF" | grep -v "prevalue-source-type" || true)
[ -z "$LEFT" ] || fail "prevalue-source tools still listed after disabling them: $LEFT"
grep -qx "forms--list-forms" <<<"$TOOLS_OFF" || fail "other forms tools vanished"
echo "   disabling forms prevalue-source removed its tools"
put_settings '{"disabledCollections":{},"readOnlyModules":["forms"]}' || fail "PUT read-only tool-settings failed"
TOOLS_RO=$(node dist/index.js --list-tools)
grep -qx "forms--list-forms" <<<"$TOOLS_RO" || fail "read-only forms lost its read-only tools"
if grep -qx "forms--delete-form" <<<"$TOOLS_RO"; then fail "read-only forms still lists forms--delete-form"; fi
grep -qx "cms--delete-document" <<<"$TOOLS_RO" || fail "read-only forms also made CMS read-only"
echo "   read-only forms kept list-forms and dropped delete-form"
put_settings '{"disabledCollections":{},"noDestructiveModules":["forms"]}' || fail "PUT no-destructive tool-settings failed"
TOOLS_ND=$(node dist/index.js --list-tools)
grep -qx "forms--list-forms" <<<"$TOOLS_ND" || fail "no-destructive forms lost its read tools"
if grep -qx "forms--delete-form" <<<"$TOOLS_ND"; then fail "no-destructive forms still lists forms--delete-form"; fi
grep -qx "cms--delete-document" <<<"$TOOLS_ND" || fail "no-destructive forms also affected CMS"
echo "   no-destructive forms kept list-forms and dropped delete-form"
put_settings '{"disabledCollections":{},"offModules":["forms"]}' || fail "PUT off tool-settings failed"
TOOLS_SO=$(node dist/index.js --list-tools)
LEFT=$(grep "^forms--" <<<"$TOOLS_SO" || true)
[ -z "$LEFT" ] || fail "forms switched off but still lists: ${LEFT:0:200}"
grep -qx "cms--delete-document" <<<"$TOOLS_SO" || fail "switching forms off also affected CMS"
echo "   switching forms off removed all its tools"
put_settings '{"disabledCollections":{}}' || fail "PUT empty tool-settings failed"
TOOLS_DEF=$(node dist/index.js --list-tools)
for tool in forms--get-server-info automate--get-server-info forms--get-acceptance-tests-system-info; do
  if grep -qx "$tool" <<<"$TOOLS_DEF"; then fail "$tool listed although its group is off by default"; fi
done
put_settings '{"disabledCollections":{"forms":[]}}' || fail "PUT forms tool-settings failed"
TOOLS_SAVED=$(node dist/index.js --list-tools)
grep -qx "forms--get-server-info" <<<"$TOOLS_SAVED" || fail "a saved empty Forms list did not switch its default-off groups on"
put_settings "$ORIGINAL" || fail "could not restore tool settings"
put_user_settings "$USER_ORIGINAL" || fail "could not restore this API user's own tool settings"
trap - EXIT
echo "   default-off groups are off until the site saves a list"

echo "   overview and client-setup endpoints"
OVERVIEW=$(curl -sfk -H "Authorization: Bearer $TOKEN" "$API/overview") || fail "GET overview failed"
node -e "
  const o = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (typeof o.addonVersion !== 'string' || !o.addonVersion) { console.error('no addonVersion'); process.exit(1); }" <<<"$OVERVIEW" \
  || fail "overview check failed (excerpt: ${OVERVIEW:0:300})"
SETUP=$(curl -sfk -G -H "Authorization: Bearer $TOKEN" --data-urlencode "clientId=$UMBRACO_CLIENT_ID" "$API/client-setup") \
  || fail "GET client-setup for $UMBRACO_CLIENT_ID failed"
SECRET="$UMBRACO_CLIENT_SECRET" CLIENT_ID="$UMBRACO_CLIENT_ID" node -e "
  const s = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (s.clientId !== process.env.CLIENT_ID) { console.error('clientId is ' + s.clientId); process.exit(1); }
  if (!Array.isArray(s.clients) || s.clients.length !== 6) { console.error('expected 6 clients, got ' + (s.clients && s.clients.length)); process.exit(1); }
  if (!s.clients.every((c) => c.content.includes(process.env.CLIENT_ID))) { console.error('a client snippet lacks the client id'); process.exit(1); }
  const secret = process.env.SECRET;
  if (secret && s.clients.some((c) => c.content.includes(secret))) { console.error('a client snippet contains the client secret'); process.exit(1); }" <<<"$SETUP" \
  || fail "client-setup check failed (excerpt: ${SETUP:0:300})"
echo "   overview has the add-on version; client-setup has 6 client snippets for this API user, without the secret"

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
