# Tool Permissions Redesign and Product Off Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Tool Permissions tab around one access ladder per product (Off · Read-only · No deletes · Full), with visible and consistently guarded unsaved changes, and add an **Off** level that stops the MCP server from loading a product.

**Architecture:**
- **Add-on:** stores Off as a fourth level, both as a new defaults row and as an override level. It sends `off` per product in capabilities and treats off products as 0 tools with no findings.
- **npm server:** skips off modules in `selectModules`, and `get-mcp-health` reports them as a note.
- **Dashboard:** split into a page element, a product card element and an unsaved-changes guard controller.

**Tech Stack:** .NET 10 / Umbraco 17.0.0 Management API, NUnit 3 with hand-written fakes; TypeScript ESM, Jest 30; Lit + UUI backoffice JS (no build step).

**Spec:** `docs/superpowers/specs/2026-10-13-tool-permissions-redesign-design.md`

## Global Constraints

- **Level values:** `full`, `noDestructive`, `readOnly`, `off` (`McpToolLevel.Off = "off"`).
  - **Precedence:** when several apply, off > readOnly > noDestructive > full.
  - **Defaults rows:** `OffModules`, `ReadOnlyModules` and `NoDestructiveModules` are mutually exclusive. An id in two of them gives a 400 and nothing is stored.
- **Storage:** a new row `Umbraco.Mcp.OffModules` holds a JSON list of ids. A missing or blank row means none, and no migration is needed.
- **CMS:** `McpProducts.RequiredId = "cms"`. Off for it is rejected with exactly: `CMS cannot be switched off: the MCP server signs in through it.`
- **Payload:** `off: boolean` on every capabilities product. npm treats missing or null as `false`. The other fields are still sent as stored when `off` is true.
- **npm decision reasons, word for word:**
  - `Switched off in the backoffice (Settings → Umbrella).`
  - `Switched off for this API user in the backoffice (Settings → Umbrella).` (when `settingsScope` is `"user"`)
- **UI copy, word for word:**
  - **Ladder labels:** `Off`, `Read-only`, `No deletes`, `Full`.
  - **Hints:**
    - Off: `Not loaded. Your AI tool won't see any {Product} tools.`
    - Read-only: `Only tools that read. Nothing is created, changed or deleted.`
    - No deletes: `Can create and change, but no tool that deletes or empties.`
    - Full: `Every tool in the groups that are switched on.`
    - CMS (Off disabled): `CMS is always on: the MCP server signs in through it.`
  - **Groups row:** `Tool groups: {on} of {total} on`.
  - **Card summary:** `Off` | `{Level label} · {n} tools` | `{Level label}`.
  - **Tags:** `custom`, `disabled`, `locked out` (side list); `Follows defaults`, `Custom for {name}` (card).
  - **Buttons:** `Customise for {name}`, `Reset to defaults`, `Discard`, `Save`.
  - **Dirty bar:** `Unsaved changes`.
  - **Confirm popup:** headline `Discard unsaved changes?`; content `Your changes to {the defaults | {name}'s settings} haven't been saved.`; confirm `Discard changes` (danger); cancel `Keep editing`.
  - **Missing counts:** `Counts appear after this user's MCP server starts with {Product} on.`
- **No dependency upgrades:** `@umbraco-cms/mcp-server-sdk` stays at `1.0.0-beta.46`, and the add-on compiles against `Umbraco.Cms.Api.Management` 17.0.0.
- **Backoffice imports only from existing packages:** `@umbraco-cms/backoffice/external/lit`, `/lit-element`, `/auth`, `/notification`, `/style`, `/modal` (`umbConfirmModal`, which exists in 17.2.2 static assets).
- **Staging:** stage files by path, never `git add -A`. Each commit ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Branch:** work on `feat/tool-permissions-redesign`. The spec and this plan are committed in Task 0.

## Review Focus

1. **A product off for one API user but on in the defaults:** that user's MCP server must not load it. Its Overview access shows `off` with 0 tools, and no "cannot use … tools: none of its user groups grant the … section" finding is raised for that user and product (Task 2).
2. **Turning a product back on for a user whose own catalogue lacks it:** the card must still show its groups (from the defaults catalogue) with counts hidden, rather than "Not reported yet" (Task 5).
3. **Edit then undo:** the dirty bar must disappear, and leaving must not ask (Task 5).
4. **Navigating to another backoffice section while dirty and choosing "Keep editing":** the URL and page stay put. "Discard changes" lands on the requested URL, and only one popup is shown (Task 6).
5. **An older add-on without `off`, or with `off: null`:** npm must load products exactly as before (Task 3).

---

### Task 0: Branch and commit the design

- [ ] **Step 1:** `git switch -c feat/tool-permissions-redesign`
- [ ] **Step 2:** Commit the spec and the plan.

```bash
git add docs/superpowers/specs/2026-10-13-tool-permissions-redesign-design.md docs/superpowers/plans/2026-10-13-tool-permissions-redesign.md
git commit -m "docs: spec and plan for the tool permissions redesign and Off level"
```

---

### Task 1: Off level in the add-on (storage, API, capabilities)

**Files:**
- Create: `src/Umbraco.Mcp/Detection/McpProducts.cs`
- Modify:
  - `src/Umbraco.Mcp/ToolSettings/McpProductOverride.cs`
  - `src/Umbraco.Mcp/ToolSettings/IMcpToolSettingsStore.cs`
  - `src/Umbraco.Mcp/ToolSettings/KeyValueMcpToolSettingsStore.cs`
  - `src/Umbraco.Mcp/ToolSettings/McpToolSettingsValidation.cs`
  - `src/Umbraco.Mcp/Api/McpToolSettingsController.cs`
  - `src/Umbraco.Mcp/Detection/McpProductStatus.cs`
  - `src/Umbraco.Mcp/Capabilities/McpCapabilitiesService.cs`
  - `src/Umbraco.Mcp/Detection/Detectors/CmsDetector.cs` (use the constant)
  - `tests/Umbraco.Mcp.Tests/Fakes.cs` (the fake store)
- Test:
  - `tests/Umbraco.Mcp.Tests/KeyValueMcpToolSettingsStoreTests.cs`
  - `McpToolSettingsControllerTests.cs`
  - `McpCapabilitiesServiceTests.cs`
  - `NpmPackageContractTests.cs`

**Interfaces:**
- Produces:
  - `McpToolLevel.Off = "off"`, and `McpToolLevel.IsValid` accepts it.
  - `public static class McpProducts { public const string RequiredId = "cms"; }` (namespace `Umbraco.Mcp.Detection`).
  - `IMcpToolSettingsStore.GetOffModules(): IReadOnlyList<string>` and `SetOffModules(IReadOnlyList<string>)`, stored in the row `Umbraco.Mcp.OffModules` (`internal const string OffKey`).
  - `McpProductStatus.Off { get; init; }` (`bool`), serialised as `off`.
  - `McpToolSettingsResponse` gains `OffModules` (after `NoDestructiveModules`). `McpToolSettingsRequest` gains `IReadOnlyList<string?>? OffModules = null`. `McpToolSettings` gains `OffModules`.
  - `McpToolSettingsValidation.CheckLevelOverlap(IReadOnlyList<string> off, IReadOnlyList<string> readOnly, IReadOnlyList<string> noDestructive): string?` replaces the two-list version.
  - `McpToolSettingsValidation.CheckRequiredNotOff(IEnumerable<string> offIds): string?` returns the exact CMS message from Global Constraints when `RequiredId` is among the ids.

- [ ] **Step 1: Write the failing tests.**
  - **Store:**
    - `Off_modules_round_trip`: set `["forms"]`, then get `["forms"]`.
    - `Off_modules_default_to_empty`: a blank row returns `[]`.
  - **Controller:**
    - `Put_saves_off_modules`: PUT `offModules: ["forms"]` → 200, the store has `["forms"]`, and GET returns `offModules: ["forms"]`.
    - `Put_rejects_a_module_off_and_read_only_and_stores_nothing`: `offModules:["forms"], readOnlyModules:["forms"]` → 400, and all three store lists are unchanged.
    - `Put_rejects_cms_off`: `offModules:["cms"]` → 400 with `ProblemDetails.Detail == "CMS cannot be switched off: the MCP server signs in through it."`
    - `Put_user_accepts_level_off`: `{ forms: { disabledCollections: [], level: "off" } }` → 200, stored.
    - `Put_user_rejects_cms_off`: → 400, the same message, and nothing stored.
    - Update the existing invalid-level test: the message lists `"full", "noDestructive", "readOnly" or "off"`.
  - **Capabilities:**
    - `Off_comes_from_the_defaults`: OffModules `["forms"]` → forms `Off == true`, `ReadOnly == false`, `NoDestructive == false`.
    - `Off_comes_from_a_user_override`: override `level "off"` → `Off == true`, `SettingsScope == "user"`.
    - `Off_is_false_when_nothing_is_stored`.
  - **Contract:** `Required_product_id_matches_the_required_npm_module`. It reads `npm/src/modules/{McpProducts.RequiredId}.ts` (same repo-root lookup as `ReadPackageJson`) and asserts that it contains `required: true`.
- [ ] **Step 2: Confirm the failures.**
  - Run: `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`
  - Expected: compile errors for `GetOffModules`, `Off` and `McpProducts`.
- [ ] **Step 3: Implement the interfaces above.**
  - **`PutToolSettings`:** normalise `offModules` with `TryNormalizeModuleIds(..., "offModules", ...)`, then check overlap, then `CheckRequiredNotOff`, then store all four values.
  - **`TryNormalizeOverrides`:** reject `RequiredId` with level `off`, using the CMS message prefixed `cms: `. The test asserts the Detail *contains* the message.
  - **Capabilities:** set `Off = level == Off` for overrides, and `Off = offModules.Contains(id)` for the defaults.
  - **Store read:** add `SafeOffModules`, mirroring `SafeReadOnlyModules`, with the log message "Could not read the MCP off settings. No product is off in the capabilities."
  - **Fake store in `Fakes.cs`:** gets the two members.
- [ ] **Step 4: Run the tests.**
  - Run: `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`
  - Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(addon): Off level for products, defaults and per API user`, staging the files listed in this task.

---

### Task 2: Off in counts, Overview, findings and the defaults catalogue

**Files:**
- Modify:
  - `src/Umbraco.Mcp/ToolSettings/McpToolCounts.cs`
  - `src/Umbraco.Mcp/Overview/McpOverviewService.cs`
  - `src/Umbraco.Mcp/ToolSettings/McpCatalogueFallback.cs`
  - `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-overview.js` (`ACCESS_LABELS` gains `off: "Off"`)
- Test:
  - `McpToolCountsTests.cs`
  - `McpOverviewServiceTests.cs`
  - `McpCatalogueFallbackTests.cs`

**Interfaces:**
- Consumes: `McpProductStatus.Off` (Task 1).
- Produces:
  - `McpOverviewService.BuildFindings` gains an optional last parameter, `IReadOnlyDictionary<Guid, McpCapabilities>? userCapabilities = null`. The service passes the per-user capabilities it already reads for `BuildUser`.

- [ ] **Step 1: Write the failing tests.**
  - `Effective_is_zero_when_off`: a module with 10 tools and `Off = true` gives 0.
  - `Access_level_is_off`: a user's capabilities with forms `Off` → `access[forms].Level == "off"` and `ToolCount == 0`.
  - `No_section_finding_for_a_product_off_in_the_defaults`: forms installed with section `forms`, the user lacks it, and forms is `Off` in the defaults caps → no finding naming Forms.
  - `No_section_finding_for_a_product_off_for_that_user`: defaults on, `userCapabilities[user]` has forms `Off` → no finding for that user and Forms. Another user without the section still gets the finding.
  - `Highest_fills_modules_no_user_reported_from_the_shared_row`: user reports have `cms` only and the shared row has `cms` and `forms` → the result has forms from the shared row and cms from the user report.
- [ ] **Step 2: Confirm the failures** with `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter "FullyQualifiedName~McpToolCountsTests|FullyQualifiedName~McpOverviewServiceTests|FullyQualifiedName~McpCatalogueFallbackTests"`.
- [ ] **Step 3: Implement.**
  - **`Effective`:** returns `0` first when `product.Off`. This comes before the `SiteSettingsIgnored` null.
  - **`AccessLevel`:** `p.Off ? "off" : …`.
  - **`BuildUserFindings`:** skips products that are `Off` in the user's own capabilities when given, else in the defaults products.
  - **`Highest`:** after merging, add every shared-row module whose id is not yet present.
  - **`umbrella-overview.js`:** the label.
- [ ] **Step 4: Run the full .NET suite.** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj` must pass.
- [ ] **Step 5: Commit** with the message `feat(addon): off products count 0 tools and raise no findings`.

---

### Task 3: npm skips off modules

**Files:**
- Modify:
  - `npm/src/core/capabilities.ts`
  - `npm/src/core/module-selection.ts`
  - `npm/src/core/health.ts`
- Test:
  - `npm/src/core/__tests__/capabilities.test.ts`
  - `module-selection.test.ts`
  - `health.test.ts`

**Interfaces:**
- Produces:
  - `ProductCapability.off?: boolean | null`.
  - `siteOff(caps: CapabilitiesResult, moduleId: string): boolean`.
  - `ModuleDecision.switchedOff?: true`, set only when Off caused the skip.

- [ ] **Step 1: Write the failing tests.**
  - **Capabilities:**
    - `accepts off true, false, null and missing`;
    - `rejects a non-boolean off` (`off: "yes"` → `unavailable`);
    - `siteOff is false without the add-on, for null and for missing`.
  - **Selection:**
    - `does not load a product that is off, with the site reason`: `product("forms",{off:true})` → `load false`, `reason === "Switched off in the backoffice (Settings → Umbrella)."`, `switchedOff === true`.
    - `uses the API user wording when settingsScope is user` → `"Switched off for this API user in the backoffice (Settings → Umbrella)."`
    - `off wins over UMBRACO_MCP_MODULES`: forced `["forms"]` with off → `load false`.
    - `still loads the required module when the payload says off` → cms `load true`.
    - `loads as before when off is null or missing` (Review Focus 5).
  - **Health:**
    - `reports an off module as a note, not an issue`: the decision has `switchedOff`, `load false` → `products[forms].issues` doesn't contain the reason, and `notes` contains `"{displayName}: " + reason`.
- [ ] **Step 2: Confirm the failures.** `cd npm && npm test -- capabilities module-selection health` should fail.
- [ ] **Step 3: Implement.**
  - **Payload validation:** `isProduct` accepts `off` as undefined, null or boolean.
  - **`selectModules`:** add the off check after `required` and before `forced`, using `product?.off === true` and the scope from `product.settingsScope === "user"`.
  - **`buildHealthReport`:** when `decision.switchedOff`, push `${name}: ${decision.reason}` to `notes` and leave it out of `issues`.
- [ ] **Step 4: Run the checks.** `cd npm && npm run compile && npm test` should all pass.
- [ ] **Step 5: Commit** with the message `feat(npm): skip products switched off in the backoffice`.

---

### Task 4: Product card element

**Files:**
- Create: `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-product-card.js`

**Interfaces:**
- Produces: the custom element `<umbrella-product-card>` (class `UmbrellaProductCardElement`).
  - **Properties** (all `attribute: false`):
    - `product` (`{ id, displayName }`);
    - `module` (a catalogue entry `{ collections, siteSettingsIgnored }` or `null`);
    - `level` (`"off" | "readOnly" | "noDestructive" | "full"`);
    - `disabled` (a `Set<string>` of group names);
    - `editable` (bool);
    - `showCounts` (bool);
    - `mode` (`"defaults" | "follows" | "custom"`);
    - `userName` (string, for the tags and buttons);
    - `isRequired` (bool);
    - `notes` (`string[]`, muted lines).
  - **Events:** each is a `CustomEvent` with `bubbles: true, composed: true`:
    - `level-change` (`detail: { productId, level }`);
    - `group-change` (`detail: { productId, name, enabled }`);
    - `customise` (`detail: { productId }`);
    - `reset` (`detail: { productId }`).
  - **Internal state:** only `_open` (whether the groups disclosure is expanded), default `false`.

- [ ] **Step 1: Write the element.** Render, in order:
  1. A `uui-box` whose `headline` is `product.displayName`.
  2. `header-actions`: the summary from Global Constraints. The count is the sum over collections that are on of `#keptCount ?? toolCount`. Move `#keptCount` / `#toolCount` here from `umbrella-tool-groups.js` unchanged.
  3. In `follows` / `custom` mode, a tag (`uui-tag`) `Follows defaults` or `Custom for {userName}`.
  4. The ladder: a `uui-button-group` with four `uui-button`s. The selected one gets `look="primary"`, the others `look="outline"`. The Off button is `disabled` when `isRequired`, and every button is disabled when `!editable`. Clicking a button fires `level-change`.
  5. The hint `<p>`: the selected step's hint. When `isRequired`, add the CMS hint as a second muted line.
  6. When `level !== "off"` and `module`: a `<button class="disclosure" aria-expanded>` reading `Tool groups: {on} of {total} on`. When `_open`, the checkbox grid as in today's `#renderProduct` (labels with counts only when `showCounts`).
  7. `notes`, each as a `<p class="muted">`.
  8. In `follows` mode, the button `Customise for {userName}` (fires `customise`). In `custom` mode, the link-styled button `Reset to defaults` (fires `reset`).
  9. Without a `module`: today's "Not reported yet…" text instead of the disclosure, with the ladder still shown.
  - **Dimming:** the content is dimmed (`opacity: .55`) when `!editable`, except the Customise button.
  - **Styles:** move the `.groups`, `.muted`, `.warning` and `.dimmed` rules from `umbrella-tool-groups.js`.
- [ ] **Step 2: Load the file in the browser** (Task 5 imports it) and check for no console errors. The full check is in Task 7.
- [ ] **Step 3: Commit** with the message `feat(dashboard): product card with the access ladder`.

---

### Task 5: Tool Permissions page (side list, snapshot, sticky bar, save)

**Files:**
- Modify (rewrite): `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-tool-groups.js`

**Interfaces:**
- Consumes: `<umbrella-product-card>` (Task 4). From the API: `offModules` (Task 1), the level `off`, and `catalogue` on both GETs.
- Produces:
  - `UmbrellaToolGroupsElement.confirmLeave(): Promise<boolean>`. It resolves `true` when clean or when the user confirmed the discard (the snapshot is then restored). Otherwise it resolves `false`.
  - `selectUser(key)`, as today, but it goes through `confirmLeave()`.
  - The getter `dirty: boolean`.

- [ ] **Step 1: Restructure the state.**
  - **Shared state** is `this._edit`. The defaults view uses `{ disabled: {id: Set}, levels: {id: level} }`, the user view `{ overrides: {id: {disabled:Set, level}} }`.
  - **Snapshot:** keep `this.#snapshot`, a JSON string of the PUT body built from the state as saved. `dirty` compares `JSON.stringify(this.#body())` with `#snapshot`.
  - **Sorted body:** `#body()` must sort ids and group names so that an undo compares equal.
  - **Load:** levels come from `offModules`, then `readOnlyModules`, then `noDestructiveModules`. Off wins: apply it last.
  - **Defaults PUT body:** `{ disabledCollections, readOnlyModules, noDestructiveModules, offModules }`.
  - **User PUT body:** `{ overrides }` with `level` possibly `"off"`.
  - **Remove:** `_switchTo`, `#discardAndSwitch`, `#renderDiscardNotice` and the `uui-select` code.
- [ ] **Step 2: Render the layout from spec section 2.**
  - **Sticky bar:** a `<header class="bar">` with `position: sticky; top: 0; z-index: 1` and the surface background. It holds the title `Tool permissions`; when dirty, a `● Unsaved changes` status and a `Discard` button that restores the snapshot without asking; and `Save` (disabled when `!dirty || _saving`).
  - **Two-column grid:** `grid-template-columns: 16rem 1fr`, collapsing to one column under `48rem` via `@media`.
  - **Side list:** a `<nav>` of `<button>`s.
    - `Defaults` with the sub-line `All API users`.
    - The heading `API users`, then each user as `{name}` with its client ids muted. Tags: `custom` when `overriddenProducts.length`, plus `disabled` / `locked out` from `state`.
    - The selected entry gets `aria-current="true"`.
    - A click awaits `confirmLeave()`, then switches (reusing today's `#switchTo` fetch logic).
  - **Cards:** one `<umbrella-product-card>` per visible product.
    - **`mode`:** `defaults` in the defaults view; otherwise `custom` if overridden, else `follows`.
    - **`isRequired`:** `product.id === "cms"`.
    - **`module`:** the user's catalogue module, or `this._data.catalogue.modules[id]` when the user's catalogue lacks it (Review Focus 2). In that fallback case `showCounts` is false, and the notes include `Counts appear after this user's MCP server starts with {Product} on.`
    - **`notes`:** the override note (defaults view), the env-filters line and the older-server line, using today's conditions and wording. The older-server line becomes `The MCP server that last started is older and still includes destructive tools.`
  - **Above the cards:** the catalogue notes (today's `#renderCatalogueNotes`), as one muted line.
- [ ] **Step 3: Handle the card events.**
  - `level-change` / `group-change` edit `_edit` (in the user view only when overridden).
  - `customise` copies the defaults' level and disabled set into an override.
  - `reset` deletes the override.
  - All four only reassign state, so `dirty` updates by itself.
- [ ] **Step 4: Implement `confirmLeave()`.**
  - It returns `true` if `!this.dirty`.
  - Otherwise it calls `umbConfirmModal(this, { headline, content, confirmLabel: "Discard changes", cancelLabel: "Keep editing", color: "danger" })`, using the copy from Global Constraints.
  - On resolve it restores the snapshot and returns `true`. On reject it returns `false`.
  - Before relying on `cancelLabel`, check that `umbConfirmModal` accepts it (`grep -o "cancelLabel" .../core/modal/index.js` in the 17.2.2 static assets). If it doesn't, omit it.
- [ ] **Step 5: Save.** Same as today, but after a successful save, rebuild `#snapshot` from the reloaded data so that `dirty` becomes `false`.
- [ ] **Step 6: Commit** with the message `feat(dashboard): tool permissions page with side list and unsaved-changes bar`.

---

### Task 6: Unsaved-changes guard and dashboard tabs

**Files:**
- Create: `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-unsaved-guard.js`
- Modify:
  - `umbrella-tool-groups.js` (attach the guard)
  - `umbrella-dashboard.js` (`#show`, `#editPermissions`)

**Interfaces:**
- Consumes: `confirmLeave()`, `dirty` (Task 5).
- Produces: `export class UmbrellaUnsavedGuard` (a Lit `ReactiveController`), constructed with `new UmbrellaUnsavedGuard(host, { isDirty: () => boolean, confirm: () => Promise<boolean> })`.

- [ ] **Step 1: Implement the guard.**
  - **Lifecycle:** `hostConnected` adds `window` listeners `willchangestate` and `beforeunload`; `hostDisconnected` removes them.
  - **`willchangestate` handler:** if a bypass flag is set, clear it and return. If `!isDirty()`, return. Otherwise:
    1. `e.preventDefault()`;
    2. `if (await confirm())`: set the bypass flag, then `history.pushState({}, "", e.detail.url)`.
    3. A second `willchangestate` while a popup is open is ignored (an `#asking` flag), so only one popup shows.
  - **`beforeunload`:** if `isDirty()`, `e.preventDefault(); e.returnValue = "";`.
- [ ] **Step 2: Attach the guard** in `UmbrellaToolGroupsElement`'s constructor with `isDirty: () => this.dirty, confirm: () => this.confirmLeave()`.
- [ ] **Step 3: Dashboard.** `#show(tab)` becomes async: when leaving `tool-groups`, it awaits `toolGroups.confirmLeave()` and returns if that is `false`. `#editPermissions` is unchanged, because `selectUser` already asks.
- [ ] **Step 4: Commit** with the message `feat(dashboard): ask before leaving with unsaved tool permissions`.

---

### Task 7: Verify in the demo site

- [ ] **Step 1:** Build npm (`cd npm && npm run build`), stop any running demo site, then start it with `dotnet run --project demo-site --launch-profile Umbraco.Web.UI`. Sign in as the demo admin, then open Settings → Umbrella → Tool Permissions.
- [ ] **Step 2:** Walk spec section 6's manual list. Check each item and screenshot the ladder, the dirty bar and the popup:
  - **Defaults:** Forms Off, Save. Restart the demo `.mcp.json` server (`node npm/dist/index.js --list-tools` with `npm/.env`). It must list no `forms--` tools. `get-mcp-health` (e2e) must show the note.
  - **Per user:** Customise Forms for one API user, set it to Off and save. The Overview shows `Off` for that user. Then Reset to defaults.
  - **Undo:** tick a group, untick it. The bar disappears.
  - **Leaving while dirty:** the side list, the Overview tab, Edit permissions, the Content section (try both Keep editing and Discard changes) and a browser reload (the browser prompt) each behave as in spec section 3.
  - **Layout:** at a 375px width the list stacks above the cards, with no horizontal scroll.
  - **CMS:** the Off button is disabled, and a PUT with `offModules:["cms"]` via Swagger gives a 400.
- [ ] **Step 3:** Run `bash scripts/check-guards.sh` and `scripts/e2e.sh` (the site must be running with `npm/.env`). Both must pass.
- [ ] **Step 4:** Fix anything found. Commit each fix by itself, with a `fix(dashboard): …` message.

---

### Task 8: Docs

**Files:**
- Modify:
  - `README.md`
  - `src/Umbraco.Mcp/README.md`
  - `docs/architecture.md`
  - `docs/architecture-map.html`
  - `CLAUDE.md`

- [ ] **Step 1: Update each doc.**
  - **Both READMEs:** describe the access ladder and Off. In troubleshooting, add "a product is missing → check whether it is Off in Settings → Umbrella; `get-mcp-health` says so".
  - **`architecture.md` and the map:** the capabilities `off` field, the `Umbraco.Mcp.OffModules` row, the `off` override level, the selection rule (after required, before forced) and the three dashboard files.
  - **`CLAUDE.md`:**
    - the capabilities payload adds `off`;
    - the tool settings bullet adds `offModules` (exclusive with the other two lists, CMS rejected);
    - the per-user bullet adds level `off`;
    - npm startup step 6 adds "not if the site switched it off".
- [ ] **Step 2: Commit** with the message `docs: access ladder and Off level`.
