#!/usr/bin/env bash
# Repo guards CI runs on every PR (see docs/merging.md). Usage: scripts/check-guards.sh [repo-root]
# Prints PASS/FAIL per check and exits 1 if any check failed. Tests: scripts/check-guards.test.sh
set -uo pipefail
ROOT="${1:-$(git rev-parse --show-toplevel)}"
FAILED=0

# json <file> <js expression over `j`>: prints the expression's result for the parsed file.
json() {
  node -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(eval(process.argv[2]))' "$1" "$2"
}

check_hmac_key() {
  local key
  key="$(json "$ROOT/demo-site/appsettings.json" 'j.Umbraco?.CMS?.Imaging?.HMACSecretKey ?? ""')" || return 0
  [ -z "$key" ] || echo "demo-site/appsettings.json has a generated Imaging:HMACSecretKey; reset it to \"\""
}

check_no_local_deps() {
  json "$ROOT/npm/package.json" \
    'Object.entries(j.dependencies ?? {}).filter(([, v]) => /^(file:|link:|git\+|git:|github:|\.|\/|~)/.test(v)).map(([k, v]) => `${k} -> ${v}`).join(", ")'
}

check_no_tracked_secrets() {
  git -C "$ROOT" ls-files \
    | grep -E '(^|/)\.env$|\.tgz$|(^|/)appsettings\.local\.json$|^demo-site/\.mcp\.json$|^demo-site/umbraco/(Data|Logs)/' \
    | paste -sd ' ' -
}

check_readme_versions() {
  local version file found
  version="$(json "$ROOT/npm/package.json" 'j.version')"
  for file in README.md npm/README.md src/Umbraco.Mcp/README.md; do
    [ -f "$ROOT/$file" ] || continue
    while read -r found; do
      [ -z "$found" ] || [ "$found" = "umbrella-mcp@$version" ] || echo "$file mentions $found, package version is $version"
    # Only concrete versions: placeholders such as umbrella-mcp@<version> are allowed.
    done <<<"$(grep -oE "umbrella-mcp@[0-9][^\"'\`[:space:]]*" "$ROOT/$file")"
  done
}

check_npm_private() {
  [ "$(json "$ROOT/npm/package.json" 'j.private === true')" = "true" ] \
    || echo "npm/package.json no longer has \"private\": true (remove this check as part of the first release, docs/releasing.md)"
}

run() {
  local id="$1" reason
  reason="$("$2" 2>&1)"
  if [ -z "$reason" ]; then
    echo "PASS $id"
  else
    echo "FAIL $id: $(paste -sd ';' - <<<"$reason")"
    FAILED=1
  fi
}

run hmac-key check_hmac_key
run no-local-deps check_no_local_deps
run no-tracked-secrets check_no_tracked_secrets
run readme-versions check_readme_versions
run npm-private check_npm_private
exit "$FAILED"
