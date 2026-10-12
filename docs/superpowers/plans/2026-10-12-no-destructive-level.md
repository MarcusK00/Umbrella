# No Destructive Tools Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each product gets a third tool level, No destructive tools, between Full access and Read-only. It removes every tool its product flags `destructiveHint`. You set it on the dashboard or with `UMBRACO_NO_DESTRUCTIVE=true`.

**Architecture:**
- **Add-on:** a second key/value list, `Umbraco.Mcp.NoDestructiveModules`, next to the read-only list. It goes out as `noDestructive` in capabilities and as `noDestructiveModules` in tool-settings.
- **npm server:** reads the flag into the filter input and skips destructive tools in `registerModuleTools`, after the toolkit's own filter. It reports `nonDestructiveToolCount` in the catalogue and notes the level in `get-mcp-health`.
- **Dashboard:** the read-only toggle becomes a three-way radio, and the Overview gets an Access column.

**Tech Stack:** .NET 10 / Umbraco 17.0.0 Management API, NUnit 3 with hand-written fakes; TypeScript ESM, Jest 30; Lit + UUI (no build step).

**Spec:** `docs/superpowers/specs/2026-10-12-no-destructive-level-design.md`

## Global Constraints

- **Definition:** "destructive" is exactly `tool.annotations?.destructiveHint === true`. Umbrella keeps no extra list.
- **Default:** a product with no saved level is Full access. Nothing changes on upgrade.
- **Stored levels:** read-only list → Read-only; else no-destructive list → No destructive tools; else Full access.
- **Payload names:** `noDestructive` (capabilities product), `noDestructiveModules` (tool-settings GET/PUT), `nonDestructiveToolCount` (catalogue collection), key/value row `Umbraco.Mcp.NoDestructiveModules`. On the npm side, missing or null means false / none.
- **Overlap:** a PUT with the same product in both lists → 400, and nothing is stored.
- **Env and precedence:** `UMBRACO_NO_DESTRUCTIVE`: `true` (trimmed, any case) applies the level to every module. The level always applies, even when env collection filters make the site's group settings ignored.
- **Copy, word for word:**
  - Radio labels: `Full access` / `No destructive tools` / `Read-only`.
  - Header suffix: ` · no destructive tools`.
  - Health notes: `{name}: no destructive tools ({n} removed), as set in the backoffice.` and `UMBRACO_NO_DESTRUCTIVE is set, so destructive tools are removed for every product.`
  - Older-server warning: `The MCP server that last started is older and still includes destructive tools. Update umbrella-mcp to apply this level.`
- **No changes:** no dependency upgrades, no toolkit changes, and `@umbraco-cms/mcp-server-sdk` stays pinned at `1.0.0-beta.45`.
- **Build target:** the add-on compiles against `Umbraco.Cms.Api.Management` 17.0.0.
- **Staging:** stage files by path. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Both levels on at once** (stored read-only plus env `UMBRACO_NO_DESTRUCTIVE`): the tools are exactly the read-only set, and nothing errors. Test: Task 2 `read-only and no-destructive together equal read-only`.
2. **A tool the toolkit already filtered out** (excluded group, or read-only): it doesn't count toward "removed", so the health number matches what the user lost to this level alone. Test: Task 2 `counts only the destructive tools the filter would otherwise have kept`.
3. **An older MCP server** (its catalogue has no `nonDestructiveToolCount`): the dashboard shows the warning and plain counts, not "undefined of 12". Test: Task 4, by hand.
4. **A PUT that sends only `readOnlyModules`** (an older dashboard tab still open): `noDestructiveModules` is cleared, not kept. This matches how read-only behaves today when its field is missing, and the spec says "A missing value means none". Test: Task 1 `Put_without_no_destructive_modules_clears_them`.
5. **A product release that changes which tools are flagged**: CI fails with a message naming the tools that were added or removed. Test: Task 3, the snapshot test.

---

### Task 1: Add-on storage, payload, validation and Overview access

**Files:**
- Modify:
  - `src/Umbraco.Mcp/ToolSettings/IMcpToolSettingsStore.cs`, `KeyValueMcpToolSettingsStore.cs`, `McpToolCatalogue.cs`, `McpToolSettingsValidation.cs`
  - `src/Umbraco.Mcp/Detection/McpProductStatus.cs`, `src/Umbraco.Mcp/Capabilities/McpCapabilitiesService.cs`
  - `src/Umbraco.Mcp/Api/McpToolSettingsController.cs`
  - `src/Umbraco.Mcp/Overview/McpOverview.cs`, `McpOverviewService.cs`
  - `tests/Umbraco.Mcp.Tests/Fakes.cs` (`FakeToolSettingsStore.NoDestructive`)
- Test: `tests/Umbraco.Mcp.Tests/KeyValueMcpToolSettingsStoreTests.cs`, `McpCapabilitiesServiceTests.cs`, `McpToolSettingsControllerTests.cs`, `McpOverviewServiceTests.cs`

**Interfaces:**
- Produces:
  - **Store:** `IReadOnlyList<string> IMcpToolSettingsStore.GetNoDestructiveModules()` (empty when nothing is stored) and `void SetNoDestructiveModules(IReadOnlyList<string> moduleIds)`, using key `internal const string NoDestructiveKey = "Umbraco.Mcp.NoDestructiveModules"`.
  - **Capabilities:** `bool McpProductStatus.NoDestructive { get; init; }`, which serialises as `noDestructive`.
  - **Catalogue:** `McpCollectionInfo(string Name, int ToolCount, int? ReadOnlyToolCount = null, bool DisabledByDefault = false, int? NonDestructiveToolCount = null)`. It is a new last parameter, so existing calls still compile.
  - **Tool settings API:**
    - `McpToolSettingsRequest(…, IReadOnlyList<string?>? ReadOnlyModules = null, IReadOnlyList<string?>? NoDestructiveModules = null)`.
    - `McpToolSettingsResponse` and `McpToolSettings` gain `IReadOnlyList<string> NoDestructiveModules`, as the last parameter.
  - **Overview:** `McpOverviewProduct` gains `string Access` as its last parameter: `"full"`, `"noDestructive"` or `"readOnly"`.

- [ ] **Step 1: Write the failing tests:**
  - **Store:** `No_destructive_modules_round_trip` and `No_destructive_modules_empty_when_nothing_stored`.
  - **Capabilities:**
    - `No_destructive_comes_from_the_store`: the ids in the list get `NoDestructive == true` and the others false.
    - `No_destructive_store_failure_means_false`: the fake throws, so the value is false for all and the capabilities are still returned. This mirrors the read-only test.
  - **Controller:**
    - `Get_returns_no_destructive_modules`
    - `Put_stores_no_destructive_modules_trimmed_and_deduplicated`
    - `Put_rejects_a_module_in_both_lists_and_stores_nothing`: 400; the store's disabled, read-only and no-destructive lists are all unchanged.
    - `Put_without_no_destructive_modules_clears_them`
    - `Put_rejects_an_unknown_no_destructive_module`
    - `Post_keeps_non_destructive_counts_between_zero_and_the_tool_count`: test cases (-1→0, 5→5, 99→toolCount, null→null), like the existing read-only clamp test.
  - **Overview:** `Access_follows_the_level`. Read-only beats no-destructive, so a product in both lists maps to `"readOnly"`, `NoDestructive` alone to `"noDestructive"`, and neither to `"full"`.
- [ ] **Step 2: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`. Expected: the build fails because the members don't exist yet.
- [ ] **Step 3: Implement.**
  - **Validation:** reuse `TryNormalizeReadOnlyModules`'s logic for the new list. Rename it, or add `TryNormalizeModuleIds` and have both lists call it, but don't copy its body. Its error text names the field (`readOnlyModules` / `noDestructiveModules`).
  - **Overlap:** check it after both lists normalise. The error is `A product cannot be both read-only and limited to non-destructive tools: {ids}.`
  - **Count:** clamp `NonDestructiveToolCount` in `NormalizeCounts` the same way as `ReadOnlyToolCount`.
  - **Capabilities:** add `SafeNoDestructiveModules`, the counterpart of `SafeReadOnlyModules`. Its log text is `Could not read the MCP no-destructive settings. No product is limited in the capabilities.`
- [ ] **Step 4: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(addon): store and report a no-destructive tool level per product`.

### Task 2: npm filter, catalogue count and server wiring

**Files:**
- Create: `npm/src/core/destructive.ts`
- Modify: `npm/src/core/capabilities.ts`, `filter-config.ts`, `tool-registrar.ts`, `catalogue.ts`, `server.ts`, `health.ts` (only the `ModuleRuntimeState` fields)
- Test: `npm/src/core/__tests__/capabilities.test.ts`, `filter-config.test.ts`, `tool-registrar.test.ts`, `catalogue.test.ts`

**Interfaces:**
- Consumes: the payload names from Task 1.
- Produces:
  - **Predicate:** `export function isDestructive(tool: { annotations?: { destructiveHint?: boolean } }): boolean` in `destructive.ts`.
  - **Capabilities:** `noDestructive?: boolean | null` on the product payload type, and `export function siteNoDestructive(caps: CapabilitiesResult, moduleId: string): boolean`.
  - **Filter input:**
    - `buildEffectiveFilterInput(env, moduleId, isDefaultModule, siteDisabled, siteReadOnly = false, defaults = [], siteNoDestructive = false)` returns `{ config, siteSettingsIgnored, defaultsApplied, excludeDestructive: boolean }`.
    - `excludeDestructive = siteNoDestructive || envNoDestructive(env)`.
    - `export function envNoDestructive(env: NodeJS.ProcessEnv): boolean` is true for `UMBRACO_NO_DESTRUCTIVE` = `true` (trimmed, any case).
  - **Registration:** `registerModuleTools(ctx, module, loaded, filter, options: { excludeDestructive?: boolean } = {}): { registered: number; destructiveRemoved: number }`. Update every existing caller and test from the number return to `.registered`.
  - **Catalogue:** each collection gains `nonDestructiveToolCount: number`, the usable tools with `!isDestructive(t)`.
  - **Runtime state:** `ModuleRuntimeState` gains `siteNoDestructive?: boolean` and `destructiveRemoved?: number`, which `server.ts` fills.

- [ ] **Step 1: Write the failing tests:**
  - **capabilities:**
    - `noDestructive missing or null is false`
    - `siteNoDestructive reads the product`
    - `a non-boolean noDestructive fails validation` (same style as `readOnly`)
  - **filter-config:**
    - `UMBRACO_NO_DESTRUCTIVE=true excludes destructive tools for every module`: `" TRUE "` → true, `"1"` → false.
    - `the site level excludes destructive tools`
    - `the level still applies when env collection filters are set`: `UMBRACO_INCLUDE_TOOL_COLLECTIONS: "forms:*"` with the site level on → `excludeDestructive` true and `siteSettingsIgnored` true.
    - Update the existing `toEqual` at the `cms` default case to include `excludeDestructive: false`.
  - **tool-registrar**, using the existing `tool("delete-form", { annotations: { destructiveHint: true } })` helper:
    - `excludeDestructive drops exactly the flagged tools`: registered names are `forms--list-forms` only, and `destructiveRemoved` is 1.
    - `without the option nothing is dropped`: registered 2, removed 0.
    - `read-only and no-destructive together equal read-only`: compare the names with `filter.readonly` alone.
    - `counts only the destructive tools the filter would otherwise have kept`: a destructive tool already excluded by `excludeTools` adds 0 to `destructiveRemoved`.
  - **catalogue:** `reports nonDestructiveToolCount per collection`: a collection with 3 usable tools, 1 flagged → 2.
- [ ] **Step 2: Run** `cd npm && npm test`. Expected: FAIL (missing exports and fields).
- [ ] **Step 3: Implement.**
  - **Registrar:** in `registerModuleTools`, the destructive check sits after `shouldIncludeTool`. Each tool skipped by it increments `destructiveRemoved`.
  - **Server:** `server.ts` passes `siteNoDestructive(capabilities, module.id)` into `buildEffectiveFilterInput` and `{ excludeDestructive }` into `registerModuleTools`. It stores `state.siteNoDestructive`, `state.destructiveRemoved` and `state.toolCount = result.registered`.
- [ ] **Step 4: Run** `cd npm && npm run compile && npm test`. Expected: compile clean, all tests pass.
- [ ] **Step 5: Commit** `feat(npm): no-destructive level removes tools the products flag destructiveHint`.

### Task 3: Health notes and the destructive-tools snapshot

**Files:**
- Modify: `npm/src/core/health.ts`
- Create: `npm/src/modules/__tests__/destructive-tools.snapshot.json`
- Test: `npm/src/core/__tests__/health.test.ts`, `npm/src/modules/__tests__/contract.test.ts`

**Interfaces:**
- Consumes: `isDestructive` and the `ModuleRuntimeState` fields from Task 2. `HealthState` gains `noDestructiveFromEnv: boolean`, which `server.ts` sets from `envNoDestructive(env)`.
- Produces: the two notes, with the exact copy from Global Constraints.

- [ ] **Step 1: Write the failing tests.**
  - **health:**
    - `notes a product limited to non-destructive tools in the backoffice`: a module with `siteNoDestructive: true` and `destructiveRemoved: 10`, `displayName` "Umbraco Forms" → notes contain `Umbraco Forms: no destructive tools (10 removed), as set in the backoffice.`
    - `notes UMBRACO_NO_DESTRUCTIVE once`: with `noDestructiveFromEnv: true` and two modules, the env note appears exactly once. A module whose level comes from the env alone gets no backoffice note.
    - `no note without the add-on for the backoffice level`: with `kind: "no-addon"`, there's no backoffice note, like the read-only case.
  - **contract snapshot**, `destructive tools match the committed snapshot`:
    - Build the sorted list of `module.toolPrefix + tool.name` for every tool with `isDestructive`, using the same loop and `createPermissiveCodegenUser()` user the contract test already uses.
    - Compare it to the JSON array in the snapshot file.
    - On mismatch, fail with a message listing `added: […]` and `removed: […]`, and saying: `A product release changed which tools are flagged destructiveHint. Review them, then update destructive-tools.snapshot.json.`
    - Respect `CI_ABSENT_PACKAGES` the way the other contract tests do (skip that module's entries).
- [ ] **Step 2: Write the snapshot.** It is the 74 prefixed names from the spec's Appendix A (`cms--delete-data-type-folder`, …, `engage--post-permissions-user-group`), sorted, one JSON array.
- [ ] **Step 3: Run** `cd npm && npm test -- health contract`. Expected: the health tests fail (no notes yet). The snapshot test passes; if it fails, stop and report the diff, because that means the packages changed since 12-10-2026.
- [ ] **Step 4: Implement** the notes in `buildHealthReport`, gated like the read-only note (`hasDashboard && siteNoDestructive`), plus the env note. Set `noDestructiveFromEnv` in `server.ts`.
- [ ] **Step 5: Run** `cd npm && npm run compile && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(npm): get-mcp-health notes the no-destructive level; snapshot the flagged tools`.

### Task 4: Dashboard three-way level and Overview Access column

**Files:**
- Modify: `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-tool-groups.js`, `umbrella-overview.js`

**Interfaces:**
- Consumes:
  - `GET /mcp/tool-settings` → `noDestructiveModules`, and the catalogue collections' `nonDestructiveToolCount`. PUT accepts `noDestructiveModules`.
  - `GET /mcp/overview` → each product's `access`.

- [ ] **Step 1: Implement the Tool groups tab.**
  - Replace `this._readOnly` (a Set) with `this._levels`, an object of product id → `"full" | "noDestructive" | "readOnly"`. It is loaded from `readOnlyModules` (read-only wins) and `noDestructiveModules`.
  - Replace the `uui-toggle` with a `uui-radio-group` whose three `uui-radio` values are `full`, `noDestructive` and `readOnly`, labelled as in Global Constraints.
  - Show the header suffix ` · no destructive tools` or ` · read-only`.
  - `#toolCount(collection, level)`:
    - `readOnly` and a numeric `readOnlyToolCount` → `"{readOnlyToolCount} of {toolCount}"`
    - `noDestructive` and a numeric `nonDestructiveToolCount` → `"{nonDestructiveToolCount} of {toolCount}"`
    - otherwise `"{toolCount}"`
  - **Older-server warning:** when the level is `noDestructive` and no collection of the module has a numeric `nonDestructiveToolCount`, show the warning in a `<p class="warning">`.
  - **Save:** sends `readOnlyModules` and `noDestructiveModules`, both over `this._data.products`, as read-only does today.
- [ ] **Step 2: Implement the Overview tab.** Add an `Access` column after `MCP server`. It maps `full`/`noDestructive`/`readOnly` to `Full access`/`No destructive tools`/`Read-only`.
- [ ] **Step 3: Run** `node --check` on both files. Expected: no output.
- [ ] **Step 4: Commit** `feat(dashboard): Full access / No destructive tools / Read-only per product`.
- [ ] **Step 5: Check by hand.** This is done by the controller on the demo site after it is rebuilt with Tasks 1–3:
  - Pick No destructive tools for Forms, Save, reload: the choice stays.
  - The header shows the suffix.
  - After the MCP server restarts, the counts read `n of m`.
  - Before the restart, the older-server warning shows.
  - The Overview's Access column says `No destructive tools`.
  - Afterwards, restore Forms to Full access.

### Task 5: End-to-end check and docs

**Files:**
- Modify: `scripts/e2e.sh`, `README.md`, `npm/README.md`, `src/Umbraco.Mcp/README.md`, `docs/architecture.md`, `CLAUDE.md`

- [ ] **Step 1: Extend `scripts/e2e.sh`.** After the existing tool-settings checks:
  1. GET the current settings.
  2. PUT them back with `"noDestructiveModules":["forms"]`.
  3. Run `node --env-file=npm/.env npm/dist/index.js --list-tools` into `TOOLS_ND`.
  4. Assert with here-strings that `forms--delete-form` is absent and `forms--list-forms` is present.
  5. PUT the saved settings back exactly as they were.
- [ ] **Step 2: Run** `cd npm && npm run build`, then `bash scripts/e2e.sh` with the demo site running. Expected: it ends without `FAIL:`.
- [ ] **Step 3: Docs.** Follow spec section 6:
  - `README.md`: the three levels and the env var table row for `UMBRACO_NO_DESTRUCTIVE`. Say what destructive means, and that unpublish is not included.
  - `npm/README.md`: the env var.
  - `src/Umbraco.Mcp/README.md`: the levels.
  - `docs/architecture.md` and `CLAUDE.md`, in the "cross-language contract" and "Tool settings" bullets: `noDestructive`, `noDestructiveModules`, `nonDestructiveToolCount`, the `Umbraco.Mcp.NoDestructiveModules` row, `isDestructive`, the level being ORed with `UMBRACO_NO_DESTRUCTIVE` and surviving env collection filters, and the snapshot test.
- [ ] **Step 4: Run** `bash scripts/check-guards.sh` and `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`. Expected: both pass.
- [ ] **Step 5: Commit** `test(e2e)+docs: no destructive tools level`.
