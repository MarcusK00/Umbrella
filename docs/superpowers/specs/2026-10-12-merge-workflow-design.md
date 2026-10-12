# Merge Workflow — Design Spec

- **Date:** 12-10-2026
- **Status:** Draft
- **Author:** mkr@umbraco.dk (with Claude)

## 1. Intent

Before merging a branch into `main`, it should be obvious whether it is **safe to merge**, and what else needs a human look. Today nothing runs automatically: "safe" means remembering to run `dotnet test`, `npm run compile`, `npm test`, `scripts/e2e.sh` and `scripts/pack-check.sh` by hand, and remembering a handful of repo-specific traps (the generated HMAC key, `file:` dependencies, a second toolkit copy, version drift).

### Definition

> **Safe to merge** = every required CI check on the PR is green **and** every checklist item in the PR description that applies is ticked.

### Success criteria

- Every PR to `main` shows three required checks: `dotnet`, `npm`, `guards`.
- Each of these fails on a branch that:
  - breaks a .NET test or the demo-site build (`dotnet`);
  - breaks `tsc`, a Jest test or the tsup build, or ends up with more than one `@umbraco-cms/mcp-server-sdk` copy (`npm`);
  - commits a non-empty `Imaging:HMACSecretKey`, a `file:` dependency in `dependencies`, a tracked secret/artifact, mismatched README versions, a removed `"private": true`, or a secret found by gitleaks (`guards`).
- `scripts/check-guards.sh` gives the same result locally as in CI.
- The PR description template lists the manual checks, each with the condition under which it applies.
- `docs/merging.md` states the definition above and the branch protection settings.

### Decisions

| Question | Decision |
|---|---|
| Where the signal lives | GitHub PR checks + PR template checklist. No local-only pre-merge script. |
| Engage in CI | CI runs without the Engage tarball. The contract test skips a module whose package is not installed, **only when `CI=true`**. Engage stays a local checklist item. Nothing unreleased leaves the developer's machine. |
| E2E / pack-check in CI | Not now. They need a running demo site; they stay checklist items. |
| Number of workflow files | One: `.github/workflows/ci.yml`. |
| Dependabot / release automation | Out of scope. Versions are pinned deliberately and are not upgraded unprompted. |
| Branch protection | Documented, set by hand in GitHub settings. |

## 2. Workflow: `.github/workflows/ci.yml`

Triggers: `pull_request` targeting `main`, and `push` to `main`. Three independent jobs on `ubuntu-latest`. Action versions are pinned to a major tag (`actions/checkout@v4`, `actions/setup-dotnet@v4`, `actions/setup-node@v4`, `gitleaks/gitleaks-action@v2`).

### 2.1 `dotnet`

1. Check out, set up .NET 10 (`10.0.x`).
2. `dotnet test Umbraco.Mcp.slnx`.

The solution includes `demo-site/`, so a demo site that no longer builds fails the job. All demo-site packages (Umbraco.Cms, Forms, Automate, Engage, Forms.Automate) come from nuget.org, so no extra feeds are needed.

### 2.2 `npm`

Working directory `npm/`, Node 22, `CI=true` (set by GitHub).

1. Remove the local-only devDependency: `npm pkg delete devDependencies.@umbraco-engage/mcp-dev`.
2. `npm install --no-audit --no-fund`. Not `npm ci`: the committed lockfile references the Engage tarball, so it no longer matches `package.json` after step 1. `npm install` still uses the lockfile for every other package.
3. Single toolkit copy: `npm ls @umbraco-cms/mcp-server-sdk --all` must list only `1.0.0-beta.45`. The check parses `npm ls --json` output so that any other version fails the step.
4. `npm run compile`.
5. `npm test`.
6. `npm run build`.

When a registry release of Engage with `createApiClient` exists and moves into `dependencies` (CLAUDE.md, "Product packages"), step 1 becomes a no-op; it is then removed and step 2 becomes `npm ci`.

### 2.3 `guards`

1. Check out with `fetch-depth: 0` (gitleaks needs history).
2. `bash scripts/check-guards.sh`.
3. `gitleaks/gitleaks-action@v2` with `GITHUB_TOKEN`. On a personal (non-organisation) repo it needs no licence key.

## 3. Engage skip in the contract test

`npm/src/modules/__tests__/contract.test.ts` calls `module.load()` for every module in two places: the per-module `describe.each` and "produces unique prefixed tool names across all modules". Without the Engage package, both fail.

Change:

- Whether a module's package resolves is decided with the existing `checkPackageInstalled(packageName, displayName)` from `core/sdk-instance.ts` (returns `null` when installed, an issue string otherwise).
- If it does not resolve **and** `process.env.CI === "true"`: the load-dependent tests for that module are skipped (`it.skip` via a conditional `it`), and the cross-module uniqueness test iterates only over resolvable modules. The skip is visible in Jest's output as a skipped test.
- If it does not resolve and `CI` is not `"true"`: the tests run and fail as today. A local run without the tarball is never silently green.
- The non-load tests (id, prefix, routing text, routing length budget) always run for every module.

No other test touches the Engage package.

## 4. Guard script: `scripts/check-guards.sh`

Bash, `set -euo pipefail`, runs from the repo root, no dependencies beyond `git`, `node` and `grep`. It runs every check, prints one `PASS`/`FAIL` line per check with the reason, and exits non-zero if any check failed. Checks:

| # | Check | Fails when |
|---|---|---|
| 1 | HMAC key | `Umbraco.CMS.Imaging.HMACSecretKey` in the committed `demo-site/appsettings.json` is anything other than `""` (read with `node` as JSON). |
| 2 | No local deps | Any `npm/package.json` `dependencies` value starts with `file:`, `link:`, `git+`, `git:`, `github:` or is a path. `devDependencies` are allowed to (Engage). |
| 3 | No tracked secrets/artifacts | `git ls-files` lists any of: `npm/.env`, `.env` anywhere, `*.tgz`, `appsettings.local.json`, `demo-site/.mcp.json`, `demo-site/umbraco/Data/**`, `demo-site/umbraco/Logs/**`. (`npm/.env.example` is allowed.) |
| 4 | README versions | Any `umbrella-mcp@<x>` in `README.md`, `npm/README.md` or `src/Umbraco.Mcp/README.md` where `<x>` differs from `npm/package.json` `version`. (The csproj ↔ npm version match is already covered by `NpmPackageContractTests`.) |
| 5 | Still private | `npm/package.json` has no `"private": true`. `docs/releasing.md` "Before the first release" gets a step to delete this check. |

The script checks what is **committed in the working tree** (and `git ls-files` for check 3), so running it locally before pushing gives the same answer as CI.

## 5. PR template: `.github/pull_request_template.md`

Sections: **What & why** (free text), **Breaking change?** (yes/no + what moves in the version), and **Checklist**. Each item says when it applies; items that do not apply are struck through or marked n/a.

- [ ] **Always:** `cd npm && npm test` passed locally **with** the Engage tarball installed (CI skips Engage).
- [ ] **If** npm dependencies, a module, `npm/src/core/` or the capabilities/catalogue handling changed: `scripts/e2e.sh` and `scripts/pack-check.sh` passed against the running demo site.
- [ ] **If** a detector id, the capabilities payload, or the tool-settings/catalogue shapes changed: both the C# and the npm side are updated (cross-language contract, CLAUDE.md).
- [ ] **If** behaviour or configuration changed: `README.md` / `npm/README.md` / `src/Umbraco.Mcp/README.md` / `CLAUDE.md` updated; dates in DD-MM-YYYY.
- [ ] **If** the Engage tarball was re-packed: `npm ls @umbraco-cms/mcp-server-sdk` shows one deduped copy locally.

## 6. `docs/merging.md`

Short doc, linked from the `## Develop` section of `README.md`:

1. The definition from §1.
2. What each CI job covers, and what it deliberately does not (Engage, e2e, pack-check) — pointing to the checklist.
3. How to run the same checks locally (`dotnet test …`, `npm` steps, `scripts/check-guards.sh`).
4. Branch protection for `main`, set by hand under GitHub → Settings → Branches (or Rules → Rulesets): require a pull request, require status checks `dotnet`, `npm`, `guards` to pass, require branches to be up to date, block force pushes. Note: protection rules on a **private** repository need GitHub Pro; on a public repository they are free.
5. Merge method: keep the current merge-commit style ("Merge pull request #N").

## 7. CLAUDE.md

Add one bullet under "Commands": `scripts/check-guards.sh` — the repo guards CI runs; see `docs/merging.md`.

## 8. Out of scope

- Booting the demo site in CI for `e2e.sh` / `pack-check.sh`.
- Uploading the Engage tarball anywhere.
- Dependabot, CodeQL, release/publish workflows.
- Changing the merge method.
