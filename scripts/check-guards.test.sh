#!/usr/bin/env bash
# Tests for scripts/check-guards.sh: builds a small fixture git repo per case in a temp dir and checks the guard's verdict.
set -euo pipefail
GUARD="$(cd "$(dirname "$0")" && pwd)/check-guards.sh"
IDS="hmac-key no-local-deps no-tracked-secrets readme-versions npm-private"
FIXTURE=""
FAILED=0

cleanup() { [ -n "$FIXTURE" ] && rm -rf "$FIXTURE"; return 0; }
trap cleanup EXIT

# write <relative path> <content>: writes a file into the fixture and stages it.
write() {
  mkdir -p "$(dirname "$FIXTURE/$1")"
  printf '%s\n' "$2" > "$FIXTURE/$1"
  git -C "$FIXTURE" add -- "$1"
}

PKG_PREFIX='{"name":"umbrella-mcp","version":"1.2.3"'
PKG_DEPS='"dependencies":{"zod":"^4.0.0"},"devDependencies":{"x":"file:vendor/x.tgz"}'

make_fixture() {
  cleanup
  FIXTURE="$(mktemp -d)"
  git init -q "$FIXTURE"
  git -C "$FIXTURE" config core.autocrlf false
  write demo-site/appsettings.json '{"Umbraco":{"CMS":{"Imaging":{"HMACSecretKey":""}}}}'
  write npm/package.json "$PKG_PREFIX,\"private\":true,$PKG_DEPS}"
  write README.md '"args": ["-y", "umbrella-mcp@1.2.3"],'
  write npm/README.md '"args": ["-y", "umbrella-mcp@1.2.3"],'
  write npm/.env.example 'UMBRACO_CLIENT_SECRET=your-secret'
}

# run_case <name> <expected exit> [expected FAIL ids...]: runs the guard against the fixture (or from $RUN_FROM
# without an argument, when set) and compares the exit code and the set of FAIL lines.
run_case() {
  local name="$1" expected_exit="$2"; shift 2
  local out exit_code=0 problems="" id
  if [ -n "${RUN_FROM:-}" ]; then
    out="$(cd "$RUN_FROM" && bash "$GUARD" 2>&1)" || exit_code=$?
  else
    out="$(bash "$GUARD" "$FIXTURE" 2>&1)" || exit_code=$?
  fi
  [ "$exit_code" = "$expected_exit" ] || problems+=" exit $exit_code, expected $expected_exit;"
  for id in $IDS; do
    local want=0 got=0
    case " $* " in *" $id "*) want=1 ;; esac
    grep -q "^FAIL $id" <<<"$out" && got=1
    if [ "$want" = 1 ] && [ "$got" = 0 ]; then problems+=" no FAIL $id;"; fi
    if [ "$want" = 0 ] && [ "$got" = 1 ]; then problems+=" unexpected FAIL $id;"; fi
    if [ "$want" = 0 ] && ! grep -q "^PASS $id" <<<"$out"; then problems+=" no PASS $id;"; fi
  done
  if [ -z "$problems" ]; then
    echo "ok $name"
  else
    echo "not ok $name:$problems"
    sed 's/^/    /' <<<"$out"
    FAILED=1
  fi
}

make_fixture
run_case "clean" 0

make_fixture
write demo-site/appsettings.json '{"Umbraco":{"CMS":{"Imaging":{"HMACSecretKey":"abc"}}}}'
run_case "hmac set" 1 hmac-key

make_fixture
write demo-site/appsettings.json '{"Umbraco":{"CMS":{}}}'
run_case "hmac section missing" 0

make_fixture
write npm/package.json "$PKG_PREFIX,\"private\":true,\"dependencies\":{\"zod\":\"^4.0.0\",\"y\":\"file:../y\"}}"
run_case "file dependency" 1 no-local-deps

make_fixture
write npm/package.json "$PKG_PREFIX,\"private\":true,\"dependencies\":{\"zod\":\"^4.0.0\",\"y\":\"github:a/b\"}}"
run_case "github dependency" 1 no-local-deps

make_fixture
write npm/.env 'UMBRACO_CLIENT_SECRET=x'
run_case "tracked npm/.env" 1 no-tracked-secrets

make_fixture
write src/x/.env 'X=1'
run_case "nested .env" 1 no-tracked-secrets

make_fixture
write npm/vendor/x.tgz 'not really a tarball'
run_case "tracked tarball" 1 no-tracked-secrets

make_fixture
write demo-site/appsettings.local.json '{}'
run_case "tracked local settings" 1 no-tracked-secrets

make_fixture
write demo-site/umbraco/Data/Umbraco.sqlite.db 'db'
run_case "tracked demo data" 1 no-tracked-secrets

make_fixture
write demo-site/.mcp.json '{}'
run_case "tracked mcp json" 1 no-tracked-secrets

make_fixture
write npm/README.md '"args": ["-y", "umbrella-mcp@1.2.2"],'
run_case "readme version mismatch" 1 readme-versions

make_fixture
write README.md '"args": ["-y", "umbrella-mcp@1.2.3"], and in general `["-y", "umbrella-mcp@<version>"]`'
run_case "placeholder version" 0

make_fixture
printf 'npx -y umbrella-mcp@1.2.3\r\nmore text\r\n' > "$FIXTURE/README.md"
git -C "$FIXTURE" add README.md
run_case "crlf readme" 0

make_fixture
write npm/package.json "$PKG_PREFIX,$PKG_DEPS}"
run_case "not private" 1 npm-private

make_fixture
write demo-site/appsettings.json '{"Umbraco":{"CMS":{"Imaging":{"HMACSecretKey":"abc"}}}}'
write npm/package.json "$PKG_PREFIX,$PKG_DEPS}"
run_case "two failures" 1 hmac-key npm-private

make_fixture
RUN_FROM="$FIXTURE/npm" run_case "from subfolder" 0

exit "$FAILED"
