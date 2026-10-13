# Per-API-User Tool Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today's tool settings become defaults for all API users, and an admin can override them per product for any single API user. Each API user's catalogue (last report) is stored separately, and the Overview shows status per API user.

**Architecture:**
- **Add-on:** new `umbracoKeyValue` rows per user for overrides and catalogues. `GET /capabilities` resolves the settings for the calling API user, so the npm server applies them unchanged. New tool-settings endpoints for one user; the Overview reads per-user catalogues.
- **npm server:** only reads the new `settingsScope` field, for `get-mcp-health` wording.
- **Dashboard:** an API-user picker and "Use defaults" switches on the Tool groups tab; per-user details in the Overview's API user rows.

**Tech Stack:** .NET 10 / Umbraco 17.0.0 Management API, NUnit 3 with hand-written fakes; TypeScript ESM, Jest 30; Lit + UUI (no build step).

**Spec:** `docs/superpowers/specs/2026-10-13-per-api-user-tool-settings-design.md`

## Global Constraints

- **Rows:** `Umbraco.Mcp.UserToolSettings.<userKey>` (overrides) and `Umbraco.Mcp.UserCatalogue.<userKey>` (catalogue), with `<userKey>` as `Guid.ToString("D")`. The existing rows `Umbraco.Mcp.ToolSettings`, `Umbraco.Mcp.ReadOnlyModules`, `Umbraco.Mcp.NoDestructiveModules` and `Umbraco.Mcp.Catalogue` keep their keys and meaning (defaults; most recent report, merged).
- **No delete:** `IKeyValueService` has none. Removing a row writes `""`, and every reader skips blank or invalid values.
- **Override shape:** `{ "<productId>": { "disabledCollections": [...], "level": "full" | "noDestructive" | "readOnly" } }`. Present = overridden all-or-nothing; absent = defaults. `disabledCollections: []` means all groups on.
- **Level mapping:** `readOnly` → `ReadOnly = true, NoDestructive = false`; `noDestructive` → `false, true`; `full` → `false, false`.
- **`settingsScope`:** `"site"` or `"user"` on each capabilities product. npm treats missing, null or any other value as `"site"`.
- **Only users of kind API** are listed, resolved or accepted by the user endpoints. Rows of users that no longer exist, or are no longer API users, are ignored everywhere (listing, fallback catalogue, counts).
- **Failures never break the MCP server:** a failing per-user read falls back to the defaults or to no per-user data, with a logged warning.
- **Dates:** DD-MM-YYYY in UI and messages (`formatDate` in `umbrella-api.js`; `dd-MM-yyyy HH:mm` in C#).
- **Copy, word for word:**
  - Health notes (scope `"user"`): `{name}: tool groups disabled in the backoffice for this API user: {list}.`, `{name}: only read-only tools, as set in the backoffice for this API user.`, `{name}: no destructive tools ({n} removed), as set in the backoffice for this API user.`
  - Version finding per user: `"{name}" last started umbrella-mcp {v} on {dd-MM-yyyy HH:mm} UTC, but the add-on is {addon}. The two are released together: set umbrella-mcp@{addon} in your AI tool's MCP configuration. A .mcp.json the site wrote and nobody edited is upgraded when the site next starts in Development.`
  - Picker: first option `All API users (defaults)`; users as `{name} ({clientIds joined with ", "})`, plus ` – disabled` or ` – locked out`.
  - Switch: `Use defaults`.
  - Defaults view: `1 API user has its own {product} settings and doesn't follow these defaults: {names}.` / `{n} API users have their own {product} settings and don't follow these defaults: {names}.`
  - Fallback counts: `Counts are from {userName}'s last start on {date} and may differ for this user.` / `Counts are from the most recent start on this site ({date}) and may differ for this user.`
  - Save for a user: headline `Tool settings saved`, message `{name}'s MCP server picks this up on its next start.`
  - Discard prompt: headline `Discard changes?`, content `You have unsaved changes. Discard them?`, confirm label `Discard`.
  - Overview row: `umbrella-mcp {v} · last start {date} · {n} tools`; access as `{product}: {Full access | No destructive tools | Read-only} ({own settings | defaults})`, joined with ` · `.
  - Products table suffix: ` (1 API user differs)` / ` ({n} API users differ)`.
- **No changes:** no dependency upgrades; `@umbraco-cms/mcp-server-sdk` stays pinned at `1.0.0-beta.46`; no npm payload or catalogue changes beyond `settingsScope`.
- **Build target:** the add-on compiles against `Umbraco.Cms.Api.Management` 17.0.0.
- **Staging:** stage files by path. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A default changes after a user overrides that product:** the user keeps its override; products it doesn't override follow the new default. Test: Task 2 `Default_change_does_not_reach_an_overridden_product`.
2. **An override for a product the site no longer detects** (product uninstalled): capabilities ignore it without error and the other products resolve normally. Test: Task 2 `Override_for_an_undetected_product_is_ignored`.
3. **A deleted or demoted API user's rows linger:** it is not in `apiUsers`, its catalogue is never the fallback, and it doesn't count in "N API users differ". Tests: Task 3 `Fallback_skips_catalogues_of_users_that_are_not_api_users`, Task 4 `Products_count_only_existing_api_users_that_differ`.
4. **A user whose connection was forgotten** (its catalogue blanked): the user GET falls back to the latest other user's catalogue, and the overrides are kept. Tests: Task 3 `Forgotten_user_gets_the_fallback_catalogue`, Task 4 `Forget_clears_the_user_catalogue_and_keeps_overrides`.
5. **A PUT with an empty `overrides` map:** the row is blanked and the user follows the defaults everywhere. Test: Task 3 `Put_with_empty_overrides_makes_the_user_follow_defaults`.

---

### Task 1: Per-user storage

**Files:**
- Create: `src/Umbraco.Mcp/ToolSettings/McpProductOverride.cs`
- Modify: `src/Umbraco.Mcp/ToolSettings/IMcpToolSettingsStore.cs`, `KeyValueMcpToolSettingsStore.cs`; `tests/Umbraco.Mcp.Tests/Fakes.cs` (`FakeToolSettingsStore`)
- Test: `tests/Umbraco.Mcp.Tests/KeyValueMcpToolSettingsStoreTests.cs`

**Interfaces:**
- Produces:
  - `public static class McpToolLevel { public const string Full = "full", NoDestructive = "noDestructive", ReadOnly = "readOnly"; public static bool IsValid(string? level); }`
  - `public sealed record McpProductOverride(IReadOnlyList<string> DisabledCollections, string Level);`
  - On `IMcpToolSettingsStore`:
    - `IReadOnlyDictionary<string, McpProductOverride> GetUserOverrides(Guid userKey)`: empty when none, blank or invalid.
    - `void SetUserOverrides(Guid userKey, IReadOnlyDictionary<string, McpProductOverride> overrides)`: an empty map writes `""`.
    - `IReadOnlyDictionary<Guid, IReadOnlyDictionary<string, McpProductOverride>> GetAllUserOverrides()`: leaves out blank, invalid and empty entries.
    - `McpToolCatalogue? GetUserCatalogue(Guid userKey)`: null when none, blank or invalid.
    - `void SetUserCatalogue(Guid userKey, McpCatalogueReport report, DateTimeOffset at)`: replaces; every module gets `ReportedAt = at`.
    - `IReadOnlyDictionary<Guid, McpToolCatalogue> GetAllUserCatalogues()`
    - `void ClearUserCatalogue(Guid userKey)`
  - Key constants on `KeyValueMcpToolSettingsStore`: `internal const string UserOverridesKeyPrefix = "Umbraco.Mcp.UserToolSettings."` and `UserCatalogueKeyPrefix = "Umbraco.Mcp.UserCatalogue."`.
  - `FakeToolSettingsStore` gets `Dictionary<Guid, IReadOnlyDictionary<string, McpProductOverride>> UserOverrides`, `Dictionary<Guid, McpToolCatalogue> UserCatalogues` and `List<Guid> ClearedCatalogues`; its getters honour `Throws` like the existing ones.

- [ ] **Step 1: Write the failing tests** in `KeyValueMcpToolSettingsStoreTests`:
  - `User_overrides_round_trip`: two products, one `readOnly` with `["media"]`, one `full` with `[]`; read back equal, including the empty list.
  - `Empty_user_overrides_blank_the_row`: the value under `UserOverridesKeyPrefix + key` is `""` and `GetUserOverrides` is empty.
  - `Get_all_user_overrides_skips_blank_invalid_and_non_guid_rows`: rows `""`, `"{not json"`, and key suffix `not-a-guid` are left out; one valid row is returned.
  - `User_catalogue_is_replaced_not_merged`: set a report with `forms` then one with `cms` only; `GetUserCatalogue` has only `cms`, with `ReportedAt` equal to the second `at` and the second report's `UmbrellaVersion`.
  - `Clear_user_catalogue_blanks_it`: afterwards `GetUserCatalogue` is null and `GetAllUserCatalogues` doesn't contain the key.
  - `User_rows_do_not_touch_the_shared_rows`: after setting both user rows, `GetCatalogue()` is `McpToolCatalogue.Empty` and `GetDisabledCollections()` is empty.
- [ ] **Step 2: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter KeyValueMcpToolSettingsStoreTests`. Expected: build fails, the members don't exist.
- [ ] **Step 3: Implement** in `KeyValueMcpToolSettingsStore`, reusing its `Read<T>` (JSON web defaults, warning on invalid JSON) and the `FindByKeyPrefix` + `Guid.TryParse(key[prefix.Length..])` pattern of `KeyValueMcpConnectionStore.GetAll`. Update `FakeToolSettingsStore`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run the whole test project: PASS.
- [ ] **Step 5: Commit** `feat(add-on): store tool overrides and catalogues per API user`.

### Task 2: Capabilities resolved for the calling API user

**Files:**
- Modify: `src/Umbraco.Mcp/Detection/McpProductStatus.cs`, `src/Umbraco.Mcp/Capabilities/IMcpCapabilitiesService.cs`, `McpCapabilitiesService.cs`, `src/Umbraco.Mcp/Api/McpCapabilitiesController.cs`
- Test: `tests/Umbraco.Mcp.Tests/McpCapabilitiesServiceTests.cs`, `McpCapabilitiesControllerTests.cs`

**Interfaces:**
- Consumes: Task 1's `GetUserOverrides`, `McpProductOverride`, `McpToolLevel`.
- Produces:
  - `McpProductStatus.SettingsScope { get; init; }` of type `string`, default `"site"`, serialised as `settingsScope`.
  - `McpCapabilities IMcpCapabilitiesService.GetCapabilities(Guid? apiUserKey = null)`. Existing callers (Overview, tool-settings controller) keep calling it without an argument and get the defaults.

- [ ] **Step 1: Write the failing tests:**
  - Service:
    - `Api_user_override_applies_to_that_product_only`: user overrides `forms` with `readOnly` + `["media"]`; `forms` has `ReadOnly == true`, `NoDestructive == false`, `DisabledCollections == ["media"]`, `SettingsScope == "user"`; `cms` follows the defaults with `SettingsScope == "site"`.
    - `Each_level_maps_to_the_flags` (test cases for the three levels).
    - `Override_with_no_disabled_collections_gives_an_empty_list_not_null`.
    - `Null_user_key_gets_the_defaults`.
    - `Default_change_does_not_reach_an_overridden_product`: change the defaults' `forms` read-only and `cms` disabled list after the override is set; `forms` keeps the override, `cms` shows the new default.
    - `Override_for_an_undetected_product_is_ignored`: override for `"gone"`; result has only the detected products, no exception.
    - `Override_read_failure_falls_back_to_the_defaults`: a store whose `GetUserOverrides` throws; every product has `SettingsScope == "site"` and the default values.
  - Controller:
    - `Api_caller_key_reaches_the_service` and `Backoffice_caller_gets_the_defaults` (with a recording fake `IMcpCapabilitiesService`, or the real service over `FakeToolSettingsStore`, whichever the existing fixture uses).
- [ ] **Step 2: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter "McpCapabilitiesServiceTests|McpCapabilitiesControllerTests"`. Expected: build fails.
- [ ] **Step 3: Implement.**
  - Read the overrides through a new `SafeUserOverrides(Guid?)` in the style of the other `Safe…` reads (warning: `Could not read the MCP tool settings for API user {Key}. The defaults apply.`).
  - In the controller, pass `CurrentUser.Key` only when `CurrentUser.Kind == UserKind.Api`. Reuse the user it already reads in `RecordConnection`.
- [ ] **Step 4: Run** the same filter, then the whole project. Expected: PASS.
- [ ] **Step 5: Commit** `feat(add-on): resolve tool settings for the calling API user`.

### Task 3: API user directory and tool-settings endpoints per user

**Files:**
- Create: `src/Umbraco.Mcp/ApiUser/IMcpApiUserDirectory.cs`, `UserServiceMcpApiUserDirectory.cs`, `McpUserStates.cs`; `src/Umbraco.Mcp/ToolSettings/McpCatalogueFallback.cs`
- Modify: `src/Umbraco.Mcp/Api/McpToolSettingsController.cs`, `src/Umbraco.Mcp/ToolSettings/McpToolSettingsValidation.cs`, `src/Umbraco.Mcp/McpComposer.cs`, `src/Umbraco.Mcp/Overview/McpOverviewService.cs` (use `McpUserStates`); `tests/Umbraco.Mcp.Tests/Fakes.cs` (`FakeApiUserDirectory`)
- Test: `tests/Umbraco.Mcp.Tests/McpToolSettingsControllerTests.cs`, new `McpCatalogueFallbackTests.cs`

**Interfaces:**
- Consumes: Task 1 store members.
- Produces:
  - `public sealed record McpApiUserInfo(Guid Key, string Name, UserState State, IReadOnlyList<string> ClientIds);`
  - `IMcpApiUserDirectory`: `Task<IReadOnlyList<McpApiUserInfo>> GetAllAsync()` (sorted by name, ordinal ignore-case) and `Task<McpApiUserInfo?> GetAsync(Guid key)` (null when missing or not `UserKind.Api`). Implement it with `IUserService.GetAll(pageIndex, pageSize, out total, "Name", Direction.Ascending, …)` paged through, filtered to `UserKind.Api`, with `GetClientIdsAsync`. Register it scoped, like `IMcpApiUserProvider`.
  - `internal static class McpUserStates { public static string Name(UserState state); }`: `"disabled"`, `"lockedOut"`, else `"active"`. `McpOverviewService.BuildUser` switches to it.
  - Records in `McpToolSettingsController.cs`:
    - `McpToolSettingsApiUser(Guid Key, string Name, IReadOnlyList<string> ClientIds, string State, DateTimeOffset? LastReportedAt, IReadOnlyList<string> OverriddenProducts)`
    - `McpToolSettingsResponse` gains `IReadOnlyList<McpToolSettingsApiUser> ApiUsers` as its last parameter.
    - `McpCatalogueSource(string Kind, DateTimeOffset? ReportedAt = null, string? UserName = null)`, where `Kind` is `"user"`, `"latest"` or `"none"`.
    - `McpUserToolSettingsResponse(IReadOnlyDictionary<string, McpProductOverride> Overrides, McpToolCatalogue Catalogue, McpCatalogueSource CatalogueSource)`
    - `McpProductOverrideRequest(IReadOnlyList<string?>? DisabledCollections, string? Level)` and `McpUserToolSettingsRequest(IReadOnlyDictionary<string, McpProductOverrideRequest?>? Overrides)`
  - `McpToolSettingsValidation.TryNormalizeOverrides(IReadOnlyDictionary<string, McpProductOverrideRequest?>? input, ISet<string> knownModuleIds, out Dictionary<string, McpProductOverride> result)`, returning `string?`. Errors:
    - `overrides is required.`
    - the existing `MaxModules` and unknown-product messages
    - `{id}: an override needs disabledCollections and level.` (null entry or null list)
    - `{id}: level must be "full", "noDestructive" or "readOnly".`
    - the `TryNormalizeNames` messages, prefixed `{id}: `
  - `internal static (McpToolCatalogue Catalogue, McpCatalogueSource Source) McpCatalogueFallback.Resolve(Guid userKey, IReadOnlyDictionary<Guid, McpToolCatalogue> userCatalogues, McpToolCatalogue shared, IReadOnlyDictionary<Guid, string> apiUserNames)`. Rules:
    - The user's own non-empty catalogue → `"user"`.
    - Else the other existing API user's non-empty catalogue with the latest `max(ReportedAt)` → `"latest"`, with that time and that user's name.
    - Else a shared catalogue with modules → `"latest"`, with its latest time and no name.
    - Else `McpToolCatalogue.Empty` → `"none"`.
  - Endpoints, all `SectionAccessSettings`:
    - `GET tool-settings/users/{userKey:guid}` and `PUT tool-settings/users/{userKey:guid}`. The PUT returns 200 with `{ overrides }`.
    - Both return 404 when `GetAsync` returns null. The PUT checks 404 before validation.

- [ ] **Step 1: Write the failing tests:**
  - `McpCatalogueFallbackTests`:
    - `Own_catalogue_wins`
    - `Latest_other_user_is_named`
    - `Fallback_skips_catalogues_of_users_that_are_not_api_users` (catalogue key missing from `apiUserNames`)
    - `Shared_row_when_no_user_has_reported` (`UserName == null`)
    - `None_when_nothing_was_reported`
  - Controller:
    - `Get_lists_every_api_user_with_last_report_and_overridden_products`: one user with catalogue + `forms` override, one without either. Check the order, `State`, `LastReportedAt` (null for the second) and `OverriddenProducts`.
    - `Get_user_returns_overrides_and_catalogue_source`
    - `Forgotten_user_gets_the_fallback_catalogue`
    - `Get_user_404_for_unknown_or_non_api_user`
    - `Put_user_stores_normalised_overrides`: trims names, drops duplicates
    - `Put_with_empty_overrides_makes_the_user_follow_defaults`: the store holds an empty map, and a following GET returns `{}`
    - `Put_user_404_before_validation`: invalid body + unknown user → 404
    - `Put_user_rejects` (test cases for each error message above), with nothing stored
    - `Post_catalogue_stores_the_report_for_the_caller_and_merges_the_shared_row`
    - The existing non-API POST test also asserts that `UserCatalogues` stays empty.
- [ ] **Step 2: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter "McpToolSettingsControllerTests|McpCatalogueFallbackTests"`. Expected: build fails.
- [ ] **Step 3: Implement** the directory, validation, fallback and endpoints. `GET tool-settings` builds `ApiUsers` from `GetAllAsync()`, `GetAllUserCatalogues()` and `GetAllUserOverrides()`.
- [ ] **Step 4: Run** the same filter, then the whole project. Expected: PASS.
- [ ] **Step 5: Commit** `feat(add-on): tool settings and catalogue endpoints per API user`.

### Task 4: Overview per API user

**Files:**
- Modify: `src/Umbraco.Mcp/Overview/McpOverview.cs`, `McpOverviewService.cs`, `src/Umbraco.Mcp/Api/McpOverviewController.cs`
- Test: `tests/Umbraco.Mcp.Tests/McpOverviewServiceTests.cs`, `McpOverviewControllerTests.cs`, `TestOverview.cs` (helper defaults for the new fields)

**Interfaces:**
- Consumes:
  - Task 1: `GetAllUserCatalogues`, `GetAllUserOverrides`, `ClearUserCatalogue`
  - Task 2: `GetCapabilities(Guid?)`
  - Task 3: `IMcpApiUserDirectory.GetAllAsync`
- Produces:
  - `public sealed record McpOverviewAccess(string ProductId, string DisplayName, string Level, string Scope);`
  - `McpOverviewApiUser` gains, as its last parameters: `string? ServerVersion`, `DateTimeOffset? LastReportedAt`, `int? ToolCount` and `IReadOnlyList<McpOverviewAccess> Access`.
  - `McpOverviewProduct` gains `int UsersWithOwnSettings` as its last parameter.
  - `McpOverviewService` takes `IMcpApiUserDirectory` as a new constructor parameter, and `McpOverviewController` takes `IMcpToolSettingsStore`.

- [ ] **Step 1: Write the failing tests:**
  - `User_row_shows_its_own_report_and_access`:
    - `ServerVersion`, `LastReportedAt`, and `ToolCount` (sum of all collections' `ToolCount`)
    - `Access` for installed and enabled products only, with `Scope` `"user"` for the overridden one
  - `User_without_own_report_has_null_report_fields`.
  - `Version_warning_per_user`: two connected users, one on an old version. Exactly one Server warning, with the copy above naming that user.
  - `Shared_row_finding_when_no_user_has_its_own_report`: today's wording and test still pass.
  - `Loaded_when_any_connected_user_loaded_it`: user A reported `forms`, user B (later) didn't. `forms.Loaded == true`; `ToolCount` comes from A's catalogue.
  - `Products_count_only_existing_api_users_that_differ`: overrides for an API user and for a key not in the directory → `UsersWithOwnSettings == 1`.
  - `Overview_survives_a_failing_per_user_read`: the store throws on `GetAllUserCatalogues`. The overview still builds, with null report fields and the shared-row rules.
  - Controller: `Forget_clears_the_user_catalogue_and_keeps_overrides`.
- [ ] **Step 2: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter "McpOverview"`. Expected: build fails.
- [ ] **Step 3: Implement.**
  - Get each user's `Access` from `GetCapabilities(user.Key)`, so resolution stays in one place.
  - Fall back to today's shared-row rules for `Loaded`, `ToolCount` and the Server finding when no connected user has its own catalogue.
  - Health check rows need no change. Run their tests to confirm.
- [ ] **Step 4: Run** the whole test project. Expected: PASS.
- [ ] **Step 5: Commit** `feat(add-on): overview status per API user`.

### Task 5: npm health wording for per-user settings

**Files:**
- Modify: `npm/src/core/capabilities.ts`, `npm/src/core/health.ts`, `npm/src/core/server.ts`
- Test: `npm/src/core/__tests__/capabilities.test.ts`, `health.test.ts`

**Interfaces:**
- Produces:
  - `ProductCapability.settingsScope?: string | null`; `isProduct` accepts undefined, null or any string.
  - `siteSettingsScope(caps: CapabilitiesResult, moduleId: string): "site" | "user"`: `"user"` only when `=== "user"`.
  - `ModuleRuntimeState.siteSettingsScope?: "site" | "user"`, set in `server.ts` next to `siteNoDestructive`.

- [ ] **Step 1: Write the failing tests:**
  - capabilities: `settingsScope "user" is read`; `missing, null or unknown scope is "site"`; `a non-string scope is rejected like other bad fields`. Number → `unavailable`, matching how `readOnly` rejects wrong types.
  - health: the three user-scope notes, with the exact copy in Global Constraints; the site-scope notes unchanged; and the "settings are ignored because the environment sets collection filters" note unchanged under user scope.
- [ ] **Step 2: Run** `cd npm && npm test -- capabilities health`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run compile && npm test`. Expected: PASS (an `ExperimentalWarning` is expected).
- [ ] **Step 5: Commit** `feat(npm): say when tool settings are set for this API user`.

### Task 6: Tool groups tab — picker and overrides

**Files:**
- Modify: `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-tool-groups.js`

**Interfaces:**
- Consumes:
  - `GET tool-settings`, now with `apiUsers`
  - `GET` / `PUT tool-settings/users/{key}` (Task 3)
- Produces: nothing other tasks use.

- [ ] **Step 1: Implement:**
  - **Picker:** a `uui-select` above the products, with the copy above. Selecting a user loads `tool-settings/users/{key}`.
  - **Defaults view:** today's view, plus the "API users have their own … settings" line per product, built from `apiUsers[].overriddenProducts`.
  - **User view:**
    - Each card gets a `uui-toggle` labelled `Use defaults`.
    - On: the default groups and level are shown with the inputs disabled.
    - Off: editable, initialised from a copy of the current defaults (`_disabled` / `_levels` as `#load` computes them today).
    - Counts and the per-collection labels use the user's catalogue, with the fallback note for `catalogueSource.kind === "latest"`, and today's "not reported" box for `"none"`.
  - **Save:** in the user view it sends `PUT tool-settings/users/{key}` with every product whose switch is off, limited to reported collection names as `#save` does today. Use the user save copy.
  - **Dirty state:** track it. Switching the picker while dirty asks with `umbConfirmModal` from `@umbraco-cms/backoffice/modal`, using the copy above. Cancel keeps the selection.
  - **Version warning:** in the user view, the add-on/server version warning uses the user's own catalogue only.
- [ ] **Step 2: Verify on the demo site** (`dotnet run --project demo-site --launch-profile Umbraco.Web.UI`, Settings → Umbrella → Tool groups):
  1. In the backoffice (Users → Create → API user), create "MCP – Editor" in the Editors group and add client credentials with client id `umbraco-back-office-mcp-editor`. (`scripts/create-api-user.mjs` only creates the fixed client id `umbraco-back-office-mcp`.)
  2. Override Forms to Read-only for that user and save. The defaults view names the user under Forms.
  3. Switch users with unsaved changes: the prompt appears. Cancel keeps the edits.
  4. A user that has never started shows the fallback note.
  5. The browser console is free of errors.
- [ ] **Step 3: Commit** `feat(dashboard): set tool groups per API user`.

### Task 7: Overview tab — per-user rows

**Files:**
- Modify: `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-overview.js`

**Interfaces:**
- Consumes: the Task 4 fields on `apiUsers[]` and `products[]`.

- [ ] **Step 1: Implement** in `#renderServerAndUsers`:
  - Each row shows the report line, only when `serverVersion` is set.
  - Each row shows the access line, with the copy above.
  - In `#renderProducts`, the access cell gets the "API users differ" suffix when `usersWithOwnSettings > 0`.
- [ ] **Step 2: Verify on the demo site:**
  1. Start the MCP server as each of the two API users (`npm run build`, then the server with each client id/secret).
  2. Both rows show their own version, time and tool count.
  3. The Forms access shows `Read-only (own settings)` for the overridden user.
  4. Forgetting a user removes its row.
  5. The browser console is free of errors.
- [ ] **Step 3: Commit** `feat(dashboard): show report and access per API user`.

### Task 8: End-to-end check and docs

**Files:**
- Modify: `CLAUDE.md`, `docs/architecture.md`, `docs/architecture-map.html`, `README.md`

- [ ] **Step 1: Check end to end by hand** with the second API user from Task 6:
  1. Its `--list-tools` has no destructive or write `forms--` tools (read-only).
  2. The first user's server still has them.
  3. `get-mcp-health` for the second user says `Forms: only read-only tools, as set in the backoffice for this API user.`
  4. Run `scripts/e2e.sh`: it passes unchanged, because it edits only the defaults.
- [ ] **Step 2: Update the docs:**
  - **`CLAUDE.md` "The cross-language contract":**
    - `settingsScope` in the capabilities payload
    - per-caller resolution in `GET /capabilities`
    - the two new row prefixes
    - the user endpoints
    - `POST /mcp/catalogue` also storing per caller
  - **`docs/architecture.md`:** the same, in its endpoint and row tables.
  - **`docs/architecture-map.html`:** the settings flow (defaults + per-user overrides resolved per caller) and the catalogue flow (per-user row + shared row).
  - **`README.md`:**
    - In the Tool groups section, the picker, defaults vs. "Use defaults", and that changes apply on the MCP server's next start.
    - In Known limitations, a line saying tool settings are guardrails applied by the MCP server on each machine, not access control; the API user's Umbraco permissions are the boundary.
- [ ] **Step 3: Run** `bash scripts/check-guards.sh`, `dotnet test Umbraco.Mcp.slnx` (stop the demo site first) and `cd npm && npm test`. Expected: all pass.
- [ ] **Step 4: Commit** `docs: per-API-user tool settings`.
