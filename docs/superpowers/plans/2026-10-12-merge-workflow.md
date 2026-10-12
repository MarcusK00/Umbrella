# Merge Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every PR to `main` shows three required checks (`dotnet`, `npm`, `guards`) plus a checklist for what CI can't check, so "safe to merge" is visible on the PR.

**Architecture:** One GitHub Actions workflow with three independent jobs. Repo-specific traps live in a bash guard script (with its own fixture-based test script) that runs the same way locally and in CI. The npm contract test learns to skip modules whose package is missing, but only when `CI=true`, so CI can run without the local-only Engage tarball. A PR template and `docs/merging.md` cover the manual part.

**Tech Stack:** GitHub Actions (`ubuntu-latest`), bash + git + node for the guards, Jest 30 + ts-jest (ESM) for the contract test, .NET 10 SDK.

**Spec:** `docs/superpowers/specs/2026-10-12-merge-workflow-design.md`

### Spec deltas (decided while planning, from verified facts)

1. **The contract test does not use `checkPackageInstalled`.** Under Jest's ESM runner a missing package makes `import.meta.resolve` throw with code `MODULE_NOT_FOUND`, not Node's `ERR_MODULE_NOT_FOUND`, and `checkPackageInstalled` rethrows anything else (verified 12-10-2026 with a probe test). A test-only helper accepts both codes. Production code is unchanged.
2. **The guard script has a test script**, `scripts/check-guards.test.sh`, that builds fixture git repos in a temp dir. CI's `guards` job runs it too, so a broken guard can't silently pass.
3. **The single-toolkit check counts physical copies**: exactly one `node_modules/**/@umbraco-cms/mcp-server-sdk/package.json`, with version `1.0.0-beta.45`. A second copy (even of the same version) is what breaks the shared client provider. `npm ls` prints a tree and only shows versions.

### Baseline (12-10-2026, worktree `chore/merge-workflow`)

- The Engage tarball is **not on this machine**: `npm/vendor/` is missing in the main checkout and there is no `@umbraco-engage` in its `node_modules`. It must be re-packed (CLAUDE.md, "Product packages") before the PR checklist's "npm test with Engage" item can be ticked.
- The worktree's `npm/node_modules` was installed **without Engage**, the way CI will (`package.json`/lockfile restored afterwards). With that install, `npm test` gives 122 passed and 3 failed, all in `src/modules/__tests__/contract.test.ts` (Engage `loads every LoadedModule field`, `defines well-formed tools`, `produces unique prefixed tool names across all modules`).
- `npm ls @umbraco-cms/mcp-server-sdk` shows a single `1.0.0-beta.45`, deduped.

## Global Constraints

- Node 22 (`>=22.0.0`), .NET SDK `10.0.x`, `ubuntu-latest` runners.
- Actions pinned to a major tag: `actions/checkout@v4`, `actions/setup-dotnet@v4`, `actions/setup-node@v4`, `gitleaks/gitleaks-action@v2`.
- Check names are exactly `dotnet`, `npm`, `guards` (branch protection refers to them).
- No new npm or NuGet dependencies, and no dependency version changes.
- Never commit `npm/vendor/*.tgz`, `npm/.env` or a non-empty `Imaging:HMACSecretKey`. Stage files explicitly; never `git add -A`.
- Toolkit: `@umbraco-cms/mcp-server-sdk` exactly `1.0.0-beta.45`, one physical copy.
- The Engage skip happens **only** when `process.env.CI === "true"`.
- Docs: dates DD-MM-YYYY; follow the existing doc tone (short, direct).
- Commit messages: conventional prefix (`feat`, `test`, `ci`, `docs`, `chore`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not push or open a PR without the user's go-ahead.

## Review Focus

1. **Local run without Engage and without `CI`**: must still fail, never silently skip. Pinned in Task 2 (`does not skip outside CI`).
2. **HMAC key absent** (no `Imaging` section, or no key): this is not a secret, so it passes. Pinned in Task 1 (`hmac section missing`).
3. **`npm/.env.example` tracked**: allowed. A `.env` in any subfolder is not. Pinned in Task 1 (the clean fixture tracks `.env.example`; `nested .env`).
4. **CRLF files on Windows (Git Bash)**: a README version at the end of a CRLF line must not pick up `\r` and fail. Pinned in Task 1 (`crlf readme`).
5. **Several problems at once**: every failing check is reported, not only the first. Pinned in Task 1 (`two failures`).

---

### Task 1: Guard script and its tests

**Files:**
- Create: `scripts/check-guards.sh`
- Create: `scripts/check-guards.test.sh`

**Interfaces:**
- Produces: `bash scripts/check-guards.sh [repo-root]`. The root defaults to `git rev-parse --show-toplevel`, so it works from any subfolder. It prints one line per check, `PASS <id>` or `FAIL <id>: <reason>`, in this order: `hmac-key`, `no-local-deps`, `no-tracked-secrets`, `readme-versions`, `npm-private`. It exits 1 if any check failed, else 0.
- Produces: `bash scripts/check-guards.test.sh`, which prints `ok <case>` / `not ok <case>` per case and exits 1 if any case failed. Task 3 runs both scripts in CI.

- [ ] **Step 1: Write the test script**

`scripts/check-guards.test.sh` (`set -euo pipefail`, header comment in the style of `scripts/e2e.sh`). Helpers:
- `make_fixture`: creates a temp dir (`mktemp -d`) with `git init -q` and these files staged with `git add`:
  - `demo-site/appsettings.json` = `{"Umbraco":{"CMS":{"Imaging":{"HMACSecretKey":""}}}}`
  - `npm/package.json` = `{"name":"umbrella-mcp","version":"1.2.3","private":true,"dependencies":{"zod":"^4.0.0"},"devDependencies":{"x":"file:vendor/x.tgz"}}`
  - `README.md` and `npm/README.md`, each containing `"args": ["-y", "umbrella-mcp@1.2.3"],`
  - `npm/.env.example` (any content)
- `run_case <name> <expected-exit> <expected FAIL ids…>`: runs the guard against the fixture. It passes when the exit code matches, every expected id has a `FAIL <id>` line, and no other id has one.

Cases. Each one starts from a fresh fixture, applies one mutation, and re-stages it:

| Case | Mutation | Expect |
|---|---|---|
| `clean` | none | exit 0, five `PASS` lines |
| `hmac set` | key = `"abc"` | 1, `hmac-key` |
| `hmac section missing` | appsettings = `{"Umbraco":{"CMS":{}}}` | 0 |
| `file dependency` | `dependencies.y = "file:../y"` | 1, `no-local-deps` |
| `github dependency` | `dependencies.y = "github:a/b"` | 1, `no-local-deps` |
| `tracked npm/.env` | add `npm/.env` | 1, `no-tracked-secrets` |
| `nested .env` | add `src/x/.env` | 1, `no-tracked-secrets` |
| `tracked tarball` | add `npm/vendor/x.tgz` | 1, `no-tracked-secrets` |
| `tracked local settings` | add `demo-site/appsettings.local.json` | 1, `no-tracked-secrets` |
| `tracked demo data` | add `demo-site/umbraco/Data/Umbraco.sqlite.db` | 1, `no-tracked-secrets` |
| `tracked mcp json` | add `demo-site/.mcp.json` | 1, `no-tracked-secrets` |
| `readme version mismatch` | `npm/README.md` says `umbrella-mcp@1.2.2` | 1, `readme-versions` |
| `crlf readme` | `README.md` rewritten with CRLF line endings, line ends right after `umbrella-mcp@1.2.3` | 0 |
| `not private` | delete `private` from `npm/package.json` | 1, `npm-private` |
| `two failures` | hmac set + not private | 1, `hmac-key` and `npm-private` |
| `from subfolder` | none; run `bash <abs script>` with no argument from `<fixture>/npm` | 0 |

- [ ] **Step 2: Run it and see it fail**

Run: `bash scripts/check-guards.test.sh`
Expected: every case is `not ok` (the guard script doesn't exist yet) and the exit code is 1.

- [ ] **Step 3: Implement `scripts/check-guards.sh`**

Use `set -uo pipefail` (not `-e`, so that every check runs). Each check is a function that echoes a reason on failure. A small runner prints the `PASS`/`FAIL` lines and remembers whether anything failed. Read JSON with `node -e '…' "$file"`, passing the file as an argument (never interpolated into the program). The rules are spec §4:
- `hmac-key`: `Umbraco.CMS.Imaging.HMACSecretKey` is `undefined` or `""`.
- `no-local-deps`: no `dependencies` value matches `^(file:|link:|git\+|git:|github:|\.|/|~)`. The reason names the dependency.
- `no-tracked-secrets`: `git -C "$root" ls-files` has no path matching `(^|/)\.env$`, `\.tgz$`, `(^|/)appsettings\.local\.json$`, `^demo-site/\.mcp\.json$` or `^demo-site/umbraco/(Data|Logs)/`. The reason lists the paths.
- `readme-versions`: every `umbrella-mcp@[^"'\`[:space:]]+` found in `README.md`, `npm/README.md` and `src/Umbraco.Mcp/README.md` (skip any file that doesn't exist) equals `npm/package.json` `version`. `[:space:]` excludes `\r`.
- `npm-private`: `npm/package.json` has `private === true`.

- [ ] **Step 4: Run the tests, then the guard on the real repo**

Run: `bash scripts/check-guards.test.sh`
Expected: every case `ok`, exit 0.

Run: `bash scripts/check-guards.sh`
Expected: five `PASS` lines, exit 0 (this branch is based on `main`, whose committed HMAC key is `""`).

- [ ] **Step 5: Commit**

```bash
git add scripts/check-guards.sh scripts/check-guards.test.sh
git commit -m "feat(scripts): repo guard checks for merges"
```

---

### Task 2: Contract test skips missing product packages in CI only

**Files:**
- Create: `npm/src/modules/__tests__/skipped-modules.ts` (helper; not a `*.test.ts`, so Jest doesn't collect it)
- Create: `npm/src/modules/__tests__/skipped-modules.test.ts`
- Modify: `npm/src/modules/__tests__/contract.test.ts`

**Interfaces:**
- Consumes: `McpProductModule` (`npm/src/core/module-contract.ts`, fields `id`, `packageName`), `modules` (`npm/src/modules/index.ts`).
- Produces: `export function modulesSkippedInCi(mods: readonly McpProductModule[], env: Record<string, string | undefined>, resolve: (specifier: string) => string): Set<string>`. It returns the ids of modules whose `${packageName}/collections` doesn't resolve, but only when `env.CI === "true"`. Otherwise it returns an empty set and doesn't call `resolve`. A resolve error with code `MODULE_NOT_FOUND` or `ERR_MODULE_NOT_FOUND` means "missing"; any other error is rethrown.

- [ ] **Step 1: Write the failing helper tests**

`skipped-modules.test.ts` uses fake modules `{ id: "cms", packageName: "@a/cms" }` and `{ id: "engage", packageName: "@a/engage" }` (cast to `McpProductModule`), plus a fake `resolve` that throws `Object.assign(new Error("x"), { code })` for `@a/engage/collections`:
- `skips a missing package in CI`: `CI: "true"`, code `MODULE_NOT_FOUND` → `new Set(["engage"])`.
- `treats Node's ERR_MODULE_NOT_FOUND as missing too`: `CI: "true"`, code `ERR_MODULE_NOT_FOUND` → `new Set(["engage"])`.
- `does not skip outside CI`: `{}` env, same missing package → empty set, and `resolve` is never called (a `jest.fn`).
- `rethrows other resolve errors`: `CI: "true"`, code `EACCES` → throws.
- `skips nothing when every package resolves`: `CI: "true"`, resolve always returns → empty set.

- [ ] **Step 2: Run them and see them fail**

Run: `cd npm && npm test -- skipped-modules`
Expected: FAIL with `Could not locate module ./skipped-modules.js mapped as: $1` (or similar).

- [ ] **Step 3: Implement `modulesSkippedInCi` in `skipped-modules.ts`**

- [ ] **Step 4: Run the helper tests**

Run: `cd npm && npm test -- skipped-modules`
Expected: 5 passed.

- [ ] **Step 5: Use it in `contract.test.ts`**

- At the top: `const skipped = modulesSkippedInCi(modules, process.env, (s) => import.meta.resolve(s));`. If the set isn't empty, `console.warn` once, naming the skipped ids and saying why (`CI=true and the package is not installed`).
- In `describe.each`: the two `load()`-based tests use `(skipped.has(module.id) ? it.skip : it)`. The id/prefix and routing-text tests always run.
- `produces unique prefixed tool names across all modules` iterates `modules.filter((m) => !skipped.has(m.id))`.
- `keeps the routing instructions … under 2,000 characters` stays on the full `modules` list.

- [ ] **Step 6: Verify all three situations** (the worktree's `node_modules` currently has no Engage, see Baseline)

Run: `cd npm && npm test -- contract` (no `CI`)
Expected: the 3 Engage failures from the baseline. A local run without the tarball is still red.

Run: `cd npm && CI=true npm test`
Expected: all suites pass; Jest reports 2 skipped tests plus the warning naming `engage`.

Run: `cd npm && npm run compile`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add npm/src/modules/__tests__/skipped-modules.ts npm/src/modules/__tests__/skipped-modules.test.ts npm/src/modules/__tests__/contract.test.ts
git commit -m "test(npm): skip contract load tests for missing product packages in CI"
```

---

### Task 3: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/check-guards.sh`, `scripts/check-guards.test.sh` (Task 1); the CI-only skip (Task 2).
- Produces: check names `dotnet`, `npm`, `guards` (Task 4's docs list them for branch protection).

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

- `name: CI`. `on`: `pull_request` with `branches: [main]`, and `push` with `branches: [main]`.
- `concurrency`: group `ci-${{ github.ref }}`, `cancel-in-progress: true`.
- `permissions: contents: read`.
- Job **`dotnet`** (`name: dotnet`): checkout; `setup-dotnet` with `dotnet-version: 10.0.x`; run `dotnet test Umbraco.Mcp.slnx`.
- Job **`npm`** (`name: npm`), with `defaults.run.working-directory: npm`:
  1. checkout; `setup-node` with `node-version: 22`.
  2. `npm pkg delete devDependencies.@umbraco-engage/mcp-dev`. Add a comment: the Engage tarball is local-only (CLAUDE.md "Product packages"); remove this step and switch to `npm ci` once Engage comes from the registry.
  3. `npm install --no-audit --no-fund`.
  4. Single toolkit copy: find every `node_modules/**/@umbraco-cms/mcp-server-sdk/package.json`. Fail unless there is exactly one and its `version` is `1.0.0-beta.45`, printing the paths found.
  5. `npm run compile`, `npm test`, `npm run build` (three separate steps, so the failing one is obvious in the PR).
- Job **`guards`** (`name: guards`): checkout with `fetch-depth: 0`; `setup-node` 22; `bash scripts/check-guards.test.sh`; `bash scripts/check-guards.sh`; `gitleaks/gitleaks-action@v2` with `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.

- [ ] **Step 2: Run each job's commands locally**

The workflow itself can only run on GitHub. Locally, check that every command it runs passes in the worktree:
- `dotnet test Umbraco.Mcp.slnx` → all passed (stop the demo site first if it's running).
- In `npm/`, the single-copy step's command against the current `node_modules` → finds one copy, `1.0.0-beta.45`.
- `cd npm && CI=true npm test && npm run compile && npm run build` → all green.
- `bash scripts/check-guards.test.sh && bash scripts/check-guards.sh` → green.
- `git status --short` → only `.github/workflows/ci.yml` new. Undo any `package.json`/lockfile changes before committing.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: dotnet, npm and guards checks for pull requests"
```

---

### Task 4: PR template, merge doc and doc links

**Files:**
- Create: `.github/pull_request_template.md`
- Create: `docs/merging.md`
- Modify: `README.md` (`## Develop` list)
- Modify: `CLAUDE.md` (`## Commands`)
- Modify: `docs/releasing.md` ("Before the first release")
- Modify: `docs/superpowers/specs/2026-10-12-merge-workflow-design.md` (`Status: Draft` → `Status: Implemented`)

- [ ] **Step 1: `.github/pull_request_template.md`**

Sections: `## What and why`, `## Breaking change?` (yes/no, and which version part moves), `## Checklist`. Open the checklist with one line: tick what applies, write n/a next to the rest, and see `docs/merging.md`. The items are the five from spec §5, word for word in meaning, each starting with its bold **Always:** / **If …:** condition.

- [ ] **Step 2: `docs/merging.md`**

Content per spec §6:
1. The definition, as a quote.
2. A table: job → what it runs → what it doesn't cover (Engage, e2e, pack-check → checklist).
3. Run it locally: `dotnet test Umbraco.Mcp.slnx`, `cd npm && npm test` (with the Engage tarball), `bash scripts/check-guards.sh`. What to do when a guard fails: for `hmac-key`, run `git checkout -- demo-site/appsettings.json` before committing.
4. Branch protection steps for `main`: require a PR; require the status checks `dotnet`, `npm` and `guards`; require branches to be up to date; block force pushes. Note that this needs GitHub Pro on a private repo and is free on a public one. The checks only show up in the picker after the workflow has run once.
5. Merge method: merge commits, as today.

- [ ] **Step 3: Links and release step**

- README `## Develop`: add `- Before merging: [docs/merging.md](docs/merging.md) (CI checks, guards, PR checklist)` next to the "Releasing" line.
- CLAUDE.md `## Commands`, under "Demo site and end-to-end check": add `bash scripts/check-guards.sh   # repo guards CI runs on every PR; see docs/merging.md`.
- `docs/releasing.md` "Before the first release": add `- Delete the npm-private check from scripts/check-guards.sh and its "not private" case from scripts/check-guards.test.sh.`
- Spec: set `Status: Implemented`.

- [ ] **Step 4: Verify**

Run: `bash scripts/check-guards.sh`
Expected: five `PASS` lines. The README edit must not add an `umbrella-mcp@` mention with a different version.

Check every relative link in the new and changed docs resolves (`ls` the targets).

- [ ] **Step 5: Commit**

```bash
git add .github/pull_request_template.md docs/merging.md README.md CLAUDE.md docs/releasing.md docs/superpowers/specs/2026-10-12-merge-workflow-design.md
git commit -m "docs: merge workflow, PR checklist and branch protection"
```

---

### Task 5: Push, open the PR, watch the checks (needs the user's go-ahead)

- [ ] **Step 1: Ask the user** before pushing `chore/merge-workflow` and opening a PR to `main`. `gh` isn't on the Bash PATH here, so the PR may need to be opened in the browser or from PowerShell.
- [ ] **Step 2: Push and open the PR.** Its description uses the new template, filled in. It is the first PR to run the workflow, so its own checks are the end-to-end test.
- [ ] **Step 3: Confirm** that `dotnet`, `npm` and `guards` all ran and passed. Any failure goes through systematic debugging, not a quick re-run.
- [ ] **Step 4: Hand over** the branch protection steps from `docs/merging.md` to the user (a manual GitHub settings change).
