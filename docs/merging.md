# Merging

> **Safe to merge** = every required CI check on the PR is green **and** every checklist item in the PR description that applies is ticked.

## What CI checks

`.github/workflows/ci.yml` runs on every PR to `main` and on every push to `main`.

| Check | Runs | Does not cover |
|---|---|---|
| `dotnet` | `dotnet test Umbraco.Mcp.slnx`, which also builds the demo site | Running the site |
| `npm` | Install, single toolkit copy (`@umbraco-cms/mcp-server-sdk` `1.0.0-beta.45`, one copy), `npm run compile`, `npm test`, `npm run build` | Engage: the tarball is local-only, so CI installs without it and the contract test skips Engage (only packages listed in `CI_ABSENT_PACKAGES`, only when `CI=true`) |
| `guards` | `scripts/check-guards.test.sh`, `scripts/check-guards.sh`, gitleaks secret scan | — |

`e2e.sh`, `pack-check.sh` and the Engage tests need your machine, so they are items in the PR checklist (`.github/pull_request_template.md`).

### Guards

`scripts/check-guards.sh` prints `PASS`/`FAIL` per check:

| Check | Fails when | Fix |
|---|---|---|
| `hmac-key` | `demo-site/appsettings.json` has a generated `Imaging:HMACSecretKey` (the demo site writes one on boot) | Set `HMACSecretKey` back to `""` in `demo-site/appsettings.json` and commit that |
| `no-local-deps` | an npm `dependencies` entry is a `file:`, `link:`, git or path reference | Use a registry version, or keep it in `devDependencies` + `external` (see CLAUDE.md, "Product packages") |
| `no-tracked-secrets` | a `.env`, `*.tgz`, `appsettings.local.json`, `demo-site/.mcp.json` or demo-site data/logs file is tracked | `git rm --cached <file>` |
| `readme-versions` | an `umbrella-mcp@<x>` in a README differs from the npm `version` | Update the README |
| `npm-private` | `"private": true` is gone from `npm/package.json` | Put it back, unless this is the first release ([releasing.md](releasing.md)) |

## Run it locally

```bash
dotnet test Umbraco.Mcp.slnx
cd npm && npm run compile && npm test && npm run build   # with the Engage tarball installed
bash scripts/check-guards.sh
```

## Branch protection

Set once, by hand, in GitHub → Settings → Branches (or Rules → Rulesets) for `main`:

- Require a pull request before merging.
- Require status checks to pass: `dotnet`, `npm`, `guards`. They only appear in the picker after the workflow has run once.
- Require branches to be up to date before merging.
- Block force pushes.

Branch protection is free on a public repository; on a private one it needs GitHub Pro.

## Merge method

Merge commits ("Merge pull request #N"), as before.
