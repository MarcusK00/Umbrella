# Per-API-User Tool Settings — Design Spec

- **Date:** 13-10-2026
- **Status:** Approved in conversation, spec awaiting review
- **Author:** mkr@umbraco.dk (with Claude)
- **Builds on:** `2026-10-12-backoffice-tool-toggles-design.md` (tool groups, read-only, catalogue), `2026-10-12-no-destructive-level-design.md` (tool levels), `2026-10-12-dashboard-overview-design.md` (Overview tab, connected API users)

## 1. Intent

A team on one site (for example an Umbraco Cloud project) usually gives each developer their own API user. Today Umbrella treats them all as one:

- The tool settings (switched-off groups, read-only, no destructive tools) are site-wide, so every developer's MCP gets the same tools.
- The catalogue is one shared row that the last server to start overwrites per module. With several developers, the Tool groups counts, the "loaded" status and the version warning change depending on who started last. CMS counts also depend on the reporting API user's permissions (`catalogue.ts`, `collection.tools(user)`).

This change keeps today's settings as **defaults for all API users** and lets an admin give any API user **its own settings per product**. Each API user's report is stored separately.

### Decisions made in the conversation

1. **Site defaults + per-user overrides.** A user follows the defaults until an admin overrides something for it.
2. **Override per product, all-or-nothing.** An override for a product holds that product's full settings (switched-off groups and level). Other products keep following the defaults.
3. **Every API user on the site is selectable**, also users that have never connected, so a new developer's user can be set up before its first start.
4. **The Overview gets per-user status** in the "Connected API users" rows. The version warning becomes one warning per user.
5. **Storage in `umbracoKeyValue`**, one row per user, like `KeyValueMcpConnectionStore`. No custom table, no migration.

### Success criteria

- On the Tool groups tab, an admin picks "All API users (defaults)" or a single API user. For a user, each product has a "Use defaults" switch; switched off, the product's groups and level are editable for that user only.
- An API user's MCP server, on its next start, gets that user's overrides for overridden products and the defaults for the rest. No npm change is needed for this: the site resolves the settings for the API user that calls `GET /capabilities`.
- Changing a default reaches every user that has no override for that product, and none that has one. The defaults view names the users that override each product.
- Tool counts on the Tool groups tab come from the selected user's own last start. For a user without a report, they come from the most recent report by any user, with a note saying so.
- The Overview's API user rows show each user's server version, last start, tool count and access per product. A version mismatch warns for that user only and no longer flips with whoever started last.
- Sites that never set an override behave exactly as today, including after the upgrade.

### Out of scope

- Per-setting inheritance (a user following the default groups but with its own level). Overrides are per product.
- Overrides for backoffice (non-API) users. Only users of kind API can be selected.
- Settings for API users that only restrict further than the defaults ("ceiling" mode). An override may loosen or tighten.
- Cleaning up rows of deleted API users. They are ignored (section 2); a user-deleted handler can come later.
- Making these settings an access control. They stay guardrails enforced by the npm server on the developer's machine. The API user's Umbraco permissions remain the real boundary (README, Known limitations).

## 2. Storage and resolution

### Rows

| Key | Holds | Change |
|---|---|---|
| `Umbraco.Mcp.ToolSettings`, `Umbraco.Mcp.ReadOnlyModules`, `Umbraco.Mcp.NoDestructiveModules` | The defaults | Unchanged; now labelled "All API users" |
| `Umbraco.Mcp.UserToolSettings.<userKey>` | One user's overrides | New |
| `Umbraco.Mcp.Catalogue` | The most recent report from any user, merged per module as today | Unchanged; now the fallback |
| `Umbraco.Mcp.UserCatalogue.<userKey>` | One user's last report, replaced on each start | New |

`<userKey>` is the user key in `"D"` format, as in `Umbraco.Mcp.Connection.<userKey>`. Rows are read with `FindByKeyPrefix`. `IKeyValueService` has no delete, so removing a row blanks it, and readers skip blank or invalid values (as `KeyValueMcpConnectionStore` does).

### Override shape

```json
{
  "forms": { "disabledCollections": ["media", "updates"], "level": "readOnly" },
  "cms":   { "disabledCollections": [], "level": "full" }
}
```

- A product present in the map is overridden; a product absent follows the defaults.
- `disabledCollections` is always a concrete list. `[]` means every group on for that user, not "inherit".
- `level` is `"full"`, `"noDestructive"` or `"readOnly"`. One value per product, so a product cannot be both read-only and no-destructive.
- An empty map, or a blank row, means the user follows the defaults for everything.
- Invalid JSON is logged as a warning and treated as no overrides, like the existing rows.

### Store

`IMcpToolSettingsStore` gains:

- `GetUserOverrides(Guid userKey)` and `SetUserOverrides(Guid userKey, overrides)` (an empty map blanks the row).
- `GetAllUserOverrides()` (by prefix, for the defaults view and the Overview).
- `GetUserCatalogue(Guid userKey)`, `SetUserCatalogue(Guid userKey, report, at)` and `GetAllUserCatalogues()`.
- `ClearUserCatalogue(Guid userKey)`.

`McpToolCatalogue` for a user keeps today's shape, with every module carrying the same `ReportedAt`.

### Resolution in `GET /capabilities`

`McpCapabilitiesService.GetCapabilities` takes the calling user's key (null for non-API callers):

- For each product: if the caller is an API user with an override for it, `disabledCollections`, `readOnly` and `noDestructive` come from the override, and `settingsScope` is `"user"`. Otherwise they come from the defaults exactly as today, and `settingsScope` is `"site"`.
- `level` maps to the existing booleans: `readOnly` → `readOnly: true, noDestructive: false`; `noDestructive` → `readOnly: false, noDestructive: true`; `full` → both false.
- Non-API callers (a backoffice user in Swagger) get the defaults, as today.
- A failure reading overrides is logged as a warning and that caller gets the defaults. It never fails the request.

The payload gains one additive field per product, `settingsScope: "site" | "user"`. Older servers ignore it.

### Catalogue in `POST /catalogue`

The request is unchanged. After validation the site:

1. writes `Umbraco.Mcp.UserCatalogue.<callerKey>` with the report, replacing the previous one, and
2. merges the report into `Umbraco.Mcp.Catalogue` as today.

## 3. Endpoints

All new endpoints are on `McpToolSettingsController`, Settings section (`SectionAccessSettings`), like the existing ones.

### `GET /mcp/tool-settings`

Unchanged fields, plus:

```json
"apiUsers": [
  { "key": "…", "name": "MCP – Anna", "clientIds": ["umbraco-back-office-mcp-anna"],
    "state": "active", "lastReportedAt": "2026-10-13T09:12:00Z", "overriddenProducts": ["forms"] }
]
```

- Every user of kind API on the site, sorted by name. `state` is `"active"`, `"disabled"` or `"lockedOut"`, as in the Overview.
- `lastReportedAt` is null when the user has no report of its own.
- `overriddenProducts` lists the product ids the user overrides.
- API users are listed through a new seam, `IMcpApiUserDirectory` (implemented with `IUserService`, filtered to `UserKind.Api`), so tests use a fake as with `IMcpApiUserProvider`.

### `GET /mcp/tool-settings/users/{userKey}`

```json
{
  "overrides": { "forms": { "disabledCollections": ["media"], "level": "readOnly" } },
  "catalogue": { "umbrellaVersion": "…", "modules": { … } },
  "catalogueSource": { "kind": "user" }
}
```

- `catalogueSource.kind` is `"user"` when the catalogue is the user's own, `"latest"` when it is a fallback, or `"none"` when there is no report at all.
- The fallback is the most recent other user's catalogue (`GetAllUserCatalogues`). Only when no user has one yet (just after the upgrade) is it the shared `Umbraco.Mcp.Catalogue` row.
- For `"latest"`, it adds `reportedAt` and `userName`. `userName` is that user's name, or null when the fallback is the shared row, which does not record who reported.
- 404 when the user does not exist or is not an API user.

### `PUT /mcp/tool-settings/users/{userKey}`

Body `{ "overrides": { "<productId>": { "disabledCollections": [...], "level": "..." } } }`. Replaces all of that user's overrides.

- 404 when the user does not exist or is not an API user.
- 400 (`ProblemDetails`, nothing stored) when:
  - `overrides` is missing,
  - a product id is not detected on the site,
  - `level` is missing or not one of the three values,
  - the collection names fail the existing rules (`McpToolSettingsValidation`: trimmed, no duplicates, `MaxCollections`, `MaxNameLength`), or
  - there are more than `MaxModules` products.
- Returns 200 with the normalised overrides.

### `PUT /mcp/tool-settings`

Unchanged. It sets the defaults.

### `POST /mcp/catalogue`

Unchanged request and response; stores per caller as in section 2.

### `DELETE /mcp/connections/{userKey}` (Overview)

Also clears that user's catalogue (`ClearUserCatalogue`), so forgetting a connection removes its stale version warning and its counts. The user's overrides are kept: they are the admin's settings, not something the server reported.

## 4. npm server

No change to how settings are applied. Only the health wording changes:

- `capabilities.ts`: add `settingsScope?: "site" | "user" | null` to the product type and its validation (unknown values → treated as `"site"`). Add `siteSettingsScope(caps, moduleId)` next to `siteReadOnly`.
- `health.ts`: where a note says "as set in the backoffice" or "disabled in the backoffice", a `"user"` scope says "for this API user" instead, for example `Forms: only read-only tools, as set in the backoffice for this API user.` The "settings ignored because the environment sets collection filters" note is unchanged.
- `catalogue.ts`: unchanged.

## 5. The Tool groups tab (`umbrella-tool-groups.js`)

- **Picker** above the products:
  - "All API users (defaults)" first, then each API user as "Name (client id)", with a "disabled" or "locked out" tag where it applies.
  - It is a `uui-select`. It starts on the defaults each time the tab loads; the selection is not remembered.
  - Switching while there are unsaved changes asks whether to discard them.
- **Defaults view** is today's view. Under a product overridden by any user it adds: "2 API users have their own Forms settings and don't follow these defaults: Anna, Bo."
- **User view:**
  - Each product card has a "Use defaults" switch, on for products the user does not override.
  - On: the card shows the default groups and level, dimmed and not editable.
  - Off: the card becomes editable, starting from a copy of the current defaults (the saved default list, or the module's `disabledByDefault` groups when there is no saved list, as the defaults view computes it today).
  - Counts come from `GET /mcp/tool-settings/users/{key}`. For `catalogueSource` `"latest"`: "Counts are from Bo's last start on 13-10-2026 09:12 and may differ for this user." Without a `userName`: "Counts are from the most recent start on this site (13-10-2026 09:12) and may differ for this user." For `"none"`: the existing "the MCP server has not reported yet" state.
  - Save sends `PUT /mcp/tool-settings/users/{key}` with every product whose switch is off. The notification says: "Saved. Anna's MCP server picks this up on its next start."
- Dates in the UI use DD-MM-YYYY.

## 6. Overview and health checks

### API user rows

`McpOverviewApiUser` gains:

- `ServerVersion` (string?) and `LastReportedAt` (DateTimeOffset?): from the user's own catalogue; null without one.
- `ToolCount` (int?): the sum of the `ToolCount` of every collection in the user's last report, the same sum today's product count uses (before tool settings); null without a report.
- `Access`: per installed and enabled product, `{ productId, displayName, level, scope }` with `level` as in section 2 and `scope` `"site"` or `"user"`.

The Overview tab shows these in each row, for example "umbrella-mcp 17.0.0-alpha.2 · last start 13-10-2026 09:12 · 412 tools" and "Forms: read-only (own settings) · CMS: full access (defaults)".

### Products table

- `Loaded`: true when the product is in at least one connected user's own catalogue. When no user has a catalogue of its own yet (just after the upgrade), today's rule on the shared row applies.
- `ToolCount`: from the most recent user catalogue that includes the product, else today's rule.
- `Access`: the default level, as today. A product overridden by any user adds "(N API users differ)".

### Findings ("MCP client setup")

- For each connected user with its own catalogue whose `UmbrellaVersion` differs from the add-on: a warning naming the user, for example `"MCP – Anna" last started umbrella-mcp 17.0.0-alpha.1 on 13-10-2026 09:12 UTC, but the add-on is 17.0.0-alpha.2. …` (rest of today's wording).
- When no connected user has its own catalogue: today's single finding from the shared row, unchanged.
- `McpServerReport` (`Server`) stays: the most recent report from any user.

The "MCP API user" and "MCP products" checks are unchanged apart from the data they read.

## 7. Error handling

- Every new read in the capabilities, overview and tool-settings paths is wrapped like the existing `Safe…` reads: a failure is logged and falls back (defaults, no per-user data). The MCP server always gets an answer.
- A user deleted after it was given overrides or reported: its rows are ignored because only existing API users are listed or resolved.
- A user turned from API into a normal user: same; it is not listed and `GET /capabilities` gives it the defaults.

## 8. Testing

.NET (NUnit 3, existing fakes in `Fakes.cs`, `FakeKeyValueService`):

- `KeyValueMcpToolSettingsStoreTests`: overrides and user catalogues round-trip; empty map blanks the row; blank and invalid rows are skipped by the `GetAll…` reads; `SetUserCatalogue` replaces rather than merges.
- `McpCapabilitiesServiceTests`: API caller with an override for one product gets it there and the defaults elsewhere, with the right `settingsScope`; each `level` maps to the booleans; non-API caller gets the defaults; a throwing override read falls back to the defaults.
- `McpCapabilitiesControllerTests`: the caller's key reaches the service.
- `McpToolSettingsControllerTests`: `apiUsers` list; user GET/PUT including 404 for unknown and non-API users and each 400 case; `POST /catalogue` writes both the user row and the shared row.
- `McpOverviewServiceTests`: per-user version warnings; fallback to today's finding when there are no user catalogues; `Loaded` and `ToolCount` across users; access per user.
- `McpOverviewControllerTests`: forgetting a connection clears the user catalogue and keeps the overrides.

npm (Jest, no HTTP mocking):

- `capabilities.test.ts`: `settingsScope` parsing, including missing and unknown values.
- `health.test.ts`: the "for this API user" wording for each note.

Manual end-to-end on the demo site: two API users (`scripts/create-api-user.mjs` with a second client id), Forms read-only for one; start the server as each and check `forms--` tools and `get-mcp-health`; check the Tool groups picker and the Overview rows.

## 9. Docs

- `CLAUDE.md` and `docs/architecture.md`: the capabilities payload (`settingsScope`), the new endpoints, the new rows, resolution per caller.
- `docs/architecture-map.html`: the settings and catalogue flows.
- `README.md`: Tool groups section (picker, defaults and overrides) and a note in Known limitations that these settings are guardrails, not access control.

## 10. Compatibility

- **Upgrade:** no data changes. Existing settings become the defaults, every user follows them, and the shared catalogue keeps working until users report again.
- **Older npm servers** against this add-on: they read the same capabilities fields, so they get per-user settings too; they only lack the "for this API user" wording. The existing version-mismatch warning flags the pairing.
- **Newer npm servers against an older add-on:** `settingsScope` is missing → `"site"`, today's behaviour.
