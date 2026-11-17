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

# The dashboard's modules: what they import from a released module must still be exported by that module as released,
# since a browser may keep an old cached copy next to newer modules. The released ref is the current major's released
# branch (origin/v<major>/main), or GUARD_RELEASED_REF.
check_dashboard_imports() {
  local major ref
  major="$(json "$ROOT/npm/package.json" 'String(j.version ?? "").split(".")[0]')"
  ref="${GUARD_RELEASED_REF:-origin/v$major/main}"
  node "$(dirname "${BASH_SOURCE[0]}")/check-dashboard-imports.mjs" "$ROOT" "$ref"
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
run dashboard-imports check_dashboard_imports
exit "$FAILED"
