# Default-off Tool Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forms `umbraco-server` + `acceptance-tests` and Automate `umbraco-server` are off unless the site's saved list or the env says otherwise, and the dashboard shows them unticked until saved.

**Architecture:** Defaults live on the npm module definition. `buildEffectiveFilterInput` picks env → saved site list → defaults. The add-on reports "never saved" as `disabledCollections: null`; the catalogue report flags `disabledByDefault` per collection so the dashboard can start from the defaults. No store or `PUT` format change.

**Tech Stack:** TypeScript (ESM, strict, Jest 30), C# net10.0 / NUnit 3, Lit dashboard (plain JS).

**Spec:** `docs/superpowers/specs/2026-10-12-default-off-tool-groups-design.md`

## Global Constraints

- Defaults: Forms `["umbraco-server", "acceptance-tests"]`, Automate `["umbraco-server"]`. CMS and Engage: none.
- Precedence per module: env collection filter (incl. `module:*`) → saved site list (array, `[]` included) → `defaultDisabledCollections`.
- Capabilities `disabledCollections`: `null` = no saved list; missing is treated as `null` on the npm side.
- Catalogue collection field name: `disabledByDefault` (C# `DisabledByDefault`, default `false`).
- No change to `PUT /mcp/tool-settings`, the `umbracoKeyValue` keys or their JSON shape.
- No new dependencies, no version bumps. ESM `.js` import suffixes. Docs dates DD-MM-YYYY.
- Health copy (exact): `<displayName>: tool groups off by default: <a, b>. Switch them on in the Umbrella dashboard.`; without the add-on the last sentence is `Set UMBRACO_INCLUDE_TOOL_COLLECTIONS to switch them on.`

**Spec delta:** spec §7 lets the e2e default check skip when the demo site has saved Forms settings. The plan makes it deterministic instead: e2e PUTs `{"disabledCollections":{}}` (no saved lists → defaults) and then `{"disabledCollections":{"forms":[]}}` (saved, nothing off), and restores the original afterwards, as step 3 already does.

## Review Focus

1. A saved empty list (`"forms": []`) must switch the defaults back on, not be confused with "never saved". → Task 1 test `saved empty list beats defaults`, Task 5 test `Stored_empty_list_is_returned_as_empty_not_null`.
2. Missing `disabledCollections` (old add-on omitting the field, or Umbraco's JSON options dropping nulls) must behave like `null`. → Task 2 test `missing field means no saved list`.
3. Capabilities unavailable (site down at start) must still apply defaults, not crash. → Task 2 test (`unavailable` → `null`) + Task 1 `null applies defaults`.
4. A default naming a collection the package lacks (product rename) must fail loudly in tests, not silently do nothing. → Task 2 contract test.
5. A catalogue report from an older server (no `disabledByDefault`) must still validate and store `false`. → Task 5 test `Report_without_disabledByDefault_stores_false`.

---

### Task 1: Filter precedence with defaults

**Files:**
- Modify: `npm/src/core/filter-config.ts` (`buildEffectiveFilterInput`)
- Test: `npm/src/core/__tests__/filter-config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  buildEffectiveFilterInput(
    env: NodeJS.ProcessEnv, moduleId: string, isDefaultModule: boolean,
    siteDisabled: readonly string[] | null, siteReadOnly?: boolean, defaults?: readonly string[],
  ): { config: ServerConfigForCollections; siteSettingsIgnored: boolean; defaultsApplied: string[] }
  ```
  `defaultsApplied` is the defaults that became `excludeToolCollections` (empty when env or a saved list won, or there are none).

- [ ] **Step 1: Write the failing tests** in a new `describe("buildEffectiveFilterInput defaults")`:
  - `null applies defaults`: `(env {}, "forms", false, null, false, ["umbraco-server"])` → `config.excludeToolCollections` `["umbraco-server"]`, `defaultsApplied` `["umbraco-server"]`.
  - `saved empty list beats defaults`: `siteDisabled []` → `excludeToolCollections` undefined, `defaultsApplied` `[]`.
  - `saved list beats defaults`: `siteDisabled ["folder"]` → `["folder"]`, `defaultsApplied` `[]`.
  - `env collection filter beats defaults`: env `UMBRACO_EXCLUDE_TOOL_COLLECTIONS=forms:folder`, `siteDisabled null` → `excludeToolCollections` `["folder"]`, `siteSettingsIgnored` true, `defaultsApplied` `[]`.
  - `module:* ignores defaults`: env `UMBRACO_INCLUDE_TOOL_COLLECTIONS=forms:*` → no `excludeToolCollections`, `defaultsApplied` `[]`.
  - `no defaults and null excludes nothing`: `(…, null, false)` → no `excludeToolCollections`.
  - `read-only still applies with defaults`: `siteReadOnly true` + defaults → `config.readonly` true and defaults excluded.
  Update existing calls that pass `[]` only where they assert `defaultsApplied` shape; existing assertions stay.

- [ ] **Step 2: Run** `cd npm && npm test -- filter-config` → new tests FAIL (`defaultsApplied` undefined).

- [ ] **Step 3: Implement** the new signature. `siteDisabled === null && !siteSettingsIgnored` → use `defaults`; otherwise today's logic. Update the doc comment to state the three-step precedence.

- [ ] **Step 4: Run** `npm test -- filter-config` and `npm run compile` → PASS (compile will flag `server.ts` only if the call no longer type-checks; it should, since `[]` is still accepted).

- [ ] **Step 5: Commit** `feat(npm): default-off collections in the filter precedence`

### Task 2: Module defaults, `null` capabilities and server wiring

**Files:**
- Modify: `npm/src/core/module-contract.ts`, `npm/src/modules/forms.ts`, `npm/src/modules/automate.ts`, `npm/src/core/capabilities.ts` (`siteDisabledCollections`), `npm/src/core/health.ts` (`ModuleRuntimeState` only), `npm/src/core/server.ts` (phase 2 loop)
- Test: `npm/src/core/__tests__/capabilities.test.ts`, `npm/src/modules/__tests__/contract.test.ts`

**Interfaces:**
- Consumes: Task 1 `buildEffectiveFilterInput`.
- Produces:
  - `McpProductModule.defaultDisabledCollections?: string[]` (doc comment from spec §3.1).
  - `siteDisabledCollections(caps, moduleId): string[] | null` — `null` for non-`ok`, unknown product, `null` or missing field.
  - `ModuleRuntimeState.defaultDisabledCollections?: string[]` — the `defaultsApplied` from Task 1. `siteDisabledCollections` there stays `string[]`; server stores the site list or leaves it undefined when `null`.

- [ ] **Step 1: Write the failing tests**
  - `capabilities.test.ts` `describe("siteDisabledCollections")`: change the expectations for `no-addon`, `unavailable`, unknown product (`"cms"`) and a `null` field to `toBeNull()`; add `missing field means no saved list` (product object without `disabledCollections` → `null`); add `saved empty list stays empty` (`[]` → `[]`).
  - `contract.test.ts`, inside `describe.each`, using `itLoads`: `default-off collections exist in the package` — `for (const name of module.defaultDisabledCollections ?? []) expect(loaded.collections.map((c) => c.metadata.name)).toContain(name)`.
  - `contract.test.ts` `describe("module set")`: `forms and automate switch off their duplicate server groups` — `forms` defaults equal `["umbraco-server", "acceptance-tests"]`, `automate` `["umbraco-server"]`, `cms`/`engage` undefined.

- [ ] **Step 2: Run** `npm test -- capabilities contract` → FAIL.

- [ ] **Step 3: Implement** the field, the two module values, the `siteDisabledCollections` return type, and in `server.ts` pass `siteDisabledCollections(...)` and `module.defaultDisabledCollections ?? []` to `buildEffectiveFilterInput`, setting `state.siteDisabledCollections = site ?? undefined` and `state.defaultDisabledCollections = defaultsApplied`.

- [ ] **Step 4: Run** `npm test` and `npm run compile` → all PASS.

- [ ] **Step 5: Commit** `feat(npm): Forms and Automate server groups off by default`

### Task 3: Health note for default-off groups

**Files:**
- Modify: `npm/src/core/health.ts`
- Test: `npm/src/core/__tests__/health.test.ts`

**Interfaces:**
- Consumes: `ModuleRuntimeState.defaultDisabledCollections` (Task 2).

- [ ] **Step 1: Write the failing tests**
  - With `caps.kind === "ok"` and Forms state `defaultDisabledCollections: ["umbraco-server", "acceptance-tests"]` → notes contain exactly `Umbraco Forms: tool groups off by default: umbraco-server, acceptance-tests. Switch them on in the Umbrella dashboard.`
  - With `no-addon` → `Umbraco Forms: tool groups off by default: umbraco-server, acceptance-tests. Set UMBRACO_INCLUDE_TOOL_COLLECTIONS to switch them on.`
  - Empty or missing `defaultDisabledCollections` → no note containing `off by default`.

- [ ] **Step 2: Run** `npm test -- health` → FAIL.

- [ ] **Step 3: Implement** in the `state.modules.map` callback, independent of `hasDashboard` gating.

- [ ] **Step 4: Run** `npm test -- health` → PASS.

- [ ] **Step 5: Commit** `feat(npm): get-mcp-health names default-off tool groups`

### Task 4: `disabledByDefault` in the catalogue report (npm)

**Files:**
- Modify: `npm/src/core/catalogue.ts`
- Test: `npm/src/core/__tests__/catalogue.test.ts`

**Interfaces:**
- Produces: `CatalogueModule.collections[]` gains `disabledByDefault?: true` — present only on default collections (omitted otherwise, keeping the payload small).

- [ ] **Step 1: Write the failing test** `flags default-off collections`: a fake module with `defaultDisabledCollections: ["umbraco-server"]` and collections `umbraco-server`, `form` → the first has `disabledByDefault: true`, the second has no `disabledByDefault` key (`not.toHaveProperty`).
- [ ] **Step 2: Run** `npm test -- catalogue` → FAIL.
- [ ] **Step 3: Implement** in `buildCatalogue` from `module.defaultDisabledCollections`.
- [ ] **Step 4: Run** `npm test -- catalogue` → PASS.
- [ ] **Step 5: Commit** `feat(npm): report default-off collections in the catalogue`

### Task 5: Add-on: `null` capabilities and `DisabledByDefault`

**Files:**
- Modify: `src/Umbraco.Mcp/Detection/McpProductStatus.cs`, `src/Umbraco.Mcp/Capabilities/McpCapabilitiesService.cs`, `src/Umbraco.Mcp/ToolSettings/McpToolCatalogue.cs` (`McpCollectionInfo`), `src/Umbraco.Mcp/ToolSettings/McpToolSettingsValidation.cs` (`NormalizeCounts`)
- Test: `tests/Umbraco.Mcp.Tests/McpCapabilitiesServiceTests.cs`, `tests/Umbraco.Mcp.Tests/McpToolSettingsControllerTests.cs`, `tests/Umbraco.Mcp.Tests/KeyValueMcpToolSettingsStoreTests.cs`

**Interfaces:**
- Produces:
  - `McpProductStatus.DisabledCollections` : `IReadOnlyList<string>?`, default `null`; doc comment says `null` = never saved, the npm server then applies its defaults.
  - `McpCollectionInfo(string Name, int ToolCount, int? ReadOnlyToolCount = null, bool DisabledByDefault = false)`.

- [ ] **Step 1: Write the failing tests**
  - `McpCapabilitiesServiceTests`: `No_stored_entry_is_returned_as_null`, `Stored_empty_list_is_returned_as_empty_not_null`, `Failing_store_returns_null_for_every_product` (use the existing fake store; add a throwing variant in `Fakes.cs` if none exists).
  - `McpToolSettingsControllerTests`: `PostCatalogue_keeps_disabledByDefault` (report with `new McpCollectionInfo("umbraco-server", 1, 1, true)` → `store.Merged.Single()…Collections.Single().DisabledByDefault` true) and `Report_without_disabledByDefault_stores_false`.
  - `KeyValueMcpToolSettingsStoreTests`: `Catalogue_round_trips_disabledByDefault` (merge then `GetCatalogue()`).
- [ ] **Step 2: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj` → new tests FAIL / don't compile.
- [ ] **Step 3: Implement**: drop `?? []` in `GetCapabilities`; `SafeDisabledCollections` failure path keeps returning an empty dictionary (so every product gets `null`); `NormalizeCounts` carries `DisabledByDefault`.
- [ ] **Step 4: Run** the same command → all PASS.
- [ ] **Step 5: Commit** `feat(addon): report never-saved tool settings as null and keep disabledByDefault`

### Task 6: Dashboard starts from the defaults

**Files:**
- Modify: `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-dashboard.js` (`#load`)

**Interfaces:**
- Consumes: `GET /mcp/tool-settings` → `disabledCollections` (keys only for saved products) and `catalogue.modules[id].collections[].disabledByDefault` (Task 5).

- [ ] **Step 1: Implement**: in `#load`, for each `catalogue.modules` id without a key in `disabledCollections`, `_disabled[id]` = the names with `disabledByDefault`. Saved keys keep winning. No change to `#save`.
- [ ] **Step 2: Verify in the browser** (no JS test harness exists): start `demo-site` via `preview_start`, run `node npm/dist/index.js --list-tools` once (after `npm run build`) so the catalogue is reported, clear saved settings with `PUT {"disabledCollections":{}}`, open Settings → Umbrella. Expected: Forms shows `umbraco-server` and `acceptance-tests` unticked, Automate `umbraco-server` unticked, all else ticked; header "2 of 24 groups off" for Forms. Tick Forms `umbraco-server`, Save, reload → it stays ticked. Screenshot as proof.
- [ ] **Step 3: Commit** `feat(dashboard): untick default-off groups until settings are saved`

### Task 7: End-to-end check and docs

**Files:**
- Modify: `scripts/e2e.sh` (step 3), `README.md`, `docs/architecture.md`, `CLAUDE.md`, `docs/adding-a-product.md`

- [ ] **Step 1: Extend `e2e.sh` step 3** (after the read-only block, before restoring): `put_settings '{"disabledCollections":{}}'` → `--list-tools` must not contain `forms--get-server-info`, `automate--get-server-info` or `forms--get-acceptance-tests-system-info` (here-string greps, `fail` on match); then `put_settings '{"disabledCollections":{"forms":[]}}'` → must contain `forms--get-server-info`. Echo `   default-off groups are off until the site saves a list`.
- [ ] **Step 2: Run** `npm run build` then `scripts/e2e.sh` with the demo site running → `PASS`.
- [ ] **Step 3: Docs**:
  - `README.md` configuration: the three default-off groups, how to switch them on (dashboard, or `UMBRACO_INCLUDE_TOOL_COLLECTIONS=forms:*`), and the spec §2 consequence that any env collection filter for a module replaces its defaults.
  - `docs/architecture.md` + `CLAUDE.md` "cross-language contract": capabilities `disabledCollections` `null` = never saved; catalogue `disabledByDefault`; precedence env → saved → defaults.
  - `docs/adding-a-product.md`: optional `defaultDisabledCollections` (for duplicates of CMS tools and test aids; the contract test checks the names exist).
- [ ] **Step 4: Run** `bash scripts/check-guards.sh` → only the known local hmac-key failure from the uncommitted `demo-site/appsettings.json`; `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`, `cd npm && npm run compile && npm test` → PASS.
- [ ] **Step 5: Commit** (stage files explicitly) `test(e2e)+docs: default-off tool groups`
