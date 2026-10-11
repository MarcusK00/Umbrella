#!/usr/bin/env bash
# Installs umbrella-mcp the way users get it (npm pack, then npx in an empty folder) and checks it against the running
# demo site. e2e.sh cannot catch install problems: when umbrella-mcp is installed as a dependency, npm ignores its
# "overrides", so a product package on another toolkit version would get its own copy and be skipped.
# Requires npm/.env and the demo site running.
set -euo pipefail
# NOTE: greps use here-strings; `echo | grep -q` under pipefail fails with SIGPIPE on large output.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

cd "$ROOT/npm"
set -a; source .env; set +a

echo "1. Pack"
npm run build >/dev/null
# --ignore-scripts: prepack would rebuild and print to stdout, which breaks the JSON.
npm pack --pack-destination "$WORK" --json --ignore-scripts >"$WORK/pack.json"
TARBALL="$WORK/$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))[0].filename)" "$WORK/pack.json")"
FILES=$(tar -tzf "$TARBALL")
grep -qx "package/dist/index.js" <<<"$FILES" || fail "dist/index.js missing from the package"
if grep -q "vendor/" <<<"$FILES"; then fail "the package contains vendor/ tarballs"; fi
echo "   $(basename "$TARBALL")"

echo "2. Install with npx in an empty folder"
mkdir "$WORK/consumer"
cd "$WORK/consumer"
TOOLS=$(npx -y --package="$TARBALL" umbrella-mcp --list-tools)
for prefix in "cms--" "forms--" "automate--"; do
  # A missing prefix usually means the product was skipped for running on its own toolkit copy.
  grep -q "^$prefix" <<<"$TOOLS" || fail "no $prefix tools (run get-mcp-health against the installed package)"
done
if grep -q "^engage--" <<<"$TOOLS"; then fail "engage-- tools loaded, but Engage is not shipped yet"; fi
grep -qx "get-mcp-health" <<<"$TOOLS" || fail "get-mcp-health missing"
echo "   $(wc -l <<<"$TOOLS" | tr -d ' ') tools"

echo "PASS"
