# Backoffice Tool Group Toggles — Design Spec

- **Date:** 12-10-2026
- **Status:** Approved design, pending spec review
- **Author:** mkr@umbraco.dk (with Claude)
- **Builds on:** `2026-10-11-umbraco-mcp-umbrella-design.md`

## 1. Intent

A site admin can switch tool groups (collections) on or off per product in the Umbraco backoffice. Example: on a site with Forms, Automate and Engage, the admin unticks Forms → `prevalue-source`, and the next time the MCP server starts it no longer exposes the ten `forms--*prevalue-source*` tools.

**Purpose: convenience and focus**, not governance. Fewer tools means less context and better tool choice for the AI. It is **not a security boundary**: anyone with the API client secret can call the Management API directly, and a developer's environment variables override the site setting (§5). The API user's permissions remain the real limit.

### Success criteria

- Backoffice → Settings → "Umbrella" dashboard lists every reported product with one checkbox per collection, including CMS.
- Unticking `prevalue-source` under Umbraco Forms and saving, then restarting the MCP server, removes all Forms prevalue-source tools; ticking it again and restarting brings them back.
- A product with collection filters set in the MCP's environment shows a warning on the dashboard that the site settings are ignored for it.
- `get-mcp-health` shows, per module, which collections are disabled by the site and whether that was ignored.
- Old add-on + new npm server and new add-on + old npm server both keep working (the feature is simply absent).

### Decisions

| Question | Decision |
|---|---|
| Purpose | Convenience/focus. Env vars may override the site. |
| Granularity | Collections only. No per-tool toggles. |
| When changes apply | On the next MCP server start. No polling, no `tools/list_changed`. |
| Which modules | All, including CMS. The CMS module itself always loads; only its collections can be switched off. |
| Source of the collection list | The npm server reports its catalogue to the site at startup (§3). |

### Out of scope (YAGNI)

Per-tool toggles, live updates, search/filter in the dashboard, "all on/off" buttons, per-user or per-API-user settings, a TS/Vite frontend toolchain.

## 2. Data flow

```
npm server start
  1. GET  /umbraco/management/api/v1/mcp/capabilities
       → products[].disabledCollections                        (new field)
  2. load modules; build filters, folding in the site list unless env overrides it (§5)
  3. POST /umbraco/management/api/v1/mcp/catalogue
       ← { umbrellaVersion, modules: [{ id, siteSettingsIgnored, collections: [{ name, toolCount }] }] }
       (unfiltered: disabled collections are listed too, so the dashboard can show them)

Backoffice "Umbrella" dashboard
  GET  /umbraco/management/api/v1/mcp/tool-settings  → { catalogue, disabledCollections }
  PUT  /umbraco/management/api/v1/mcp/tool-settings  ← { disabledCollections: { "forms": ["prevalue-source"] } }
```

The catalogue lists each loaded module's collections with the number of tools whose `enabled(user)` passes for the MCP's API user, before any filter.

## 3. Storage (add-on)

Two rows in Umbraco's key/value table (`IKeyValueService`), following `KeyValueMcpConnectionStore`:

| Key | Value (JSON, camelCase) |
|---|---|
| `Umbraco.Mcp.ToolSettings` | `{ "forms": ["prevalue-source"], "cms": ["log-viewer"] }` |
| `Umbraco.Mcp.Catalogue` | `{ "umbrellaVersion": "…", "modules": { "<id>": { "reportedAt": "<ISO 8601>", "siteSettingsIgnored": false, "collections": [{ "name": "…", "toolCount": 10 }] } } }` |

- Catalogue entries are merged **per module**: a report overwrites the modules it contains and leaves the others. A module that failed to load on one start keeps its last-reported entry, so its checkboxes do not disappear.
- A missing or unreadable row (corrupt JSON) reads as empty: nothing disabled, nothing reported. Read failures are logged as warnings.
- The rows are shared by every server of a load-balanced site and survive restarts.

## 4. Add-on (`src/Umbraco.Mcp/`)

### 4.1 Contract change

`McpProductStatus` gains `IReadOnlyList<string> DisabledCollections` (JSON `disabledCollections`). `McpCapabilitiesService` fills it from the settings store. A throwing store gives `[]` and a logged warning; capabilities never fail because of it.

### 4.2 New `ToolSettings/` folder

- `IMcpToolSettingsStore` / `KeyValueMcpToolSettingsStore`: get/set the disabled lists; get the catalogue; merge a reported catalogue.
- Records: `McpToolCatalogue`, `McpModuleCatalogue`, `McpCollectionInfo`, `McpToolSettings`.

### 4.3 New `McpToolSettingsController`

Same `[VersionedApiBackOfficeRoute("mcp")]`, `GroupName = "MCP"` as `McpCapabilitiesController`.

| Endpoint | Authorization | Notes |
|---|---|---|
| `GET tool-settings` | `AuthorizationPolicies.SectionAccessSettings` | Catalogue + disabled lists. |
| `PUT tool-settings` | `AuthorizationPolicies.SectionAccessSettings` | Replaces the disabled lists. |
| `POST catalogue` | `AuthorizationPolicies.BackOfficeAccess`, and the action requires `CurrentUser.Kind == UserKind.Api` (403 otherwise) | Same rule as `RecordConnection`: normal backoffice users (e.g. via Swagger) cannot overwrite the catalogue. |

**Validation**

- `PUT`: module ids must equal a registered detector's `Id` (400 otherwise). Collection names are trimmed; empty names dropped; duplicates removed. Names are not checked against the catalogue (the dashboard only offers reported names; a name the MCP no longer reports is harmless and is dropped on the next dashboard save).
- Both writes are size-capped: at most 50 modules, 200 collections per module, 100 characters per name or id (400 otherwise), so a stray client cannot bloat the key/value table.

Registered in `McpComposer` next to the connection store.

### 4.4 Backoffice dashboard

- The project becomes a Razor class library (`Microsoft.NET.Sdk.Razor`, `StaticWebAssetBasePath` `/`) so `wwwroot/App_Plugins/Umbrella/` ships in the NuGet package.
- `umbraco-package.json` registers one `dashboard` extension, label "Umbrella", conditioned on section `Umb.Section.Settings`.
- One plain ES module (no build step) imports Lit and UUI from the backoffice import map (`@umbraco-cms/backoffice/...`), calls the endpoints with the backoffice auth context, and shows save results through the notification context.

Layout:

```
Umbrella – MCP tool groups
Last reported by umbrella-mcp 17.0.0-alpha.1 · 12-10-2026 14:03
ⓘ Changes apply the next time the MCP server starts. Reconnect it in your AI tool.

┌ Umbraco Forms ─────────────────── 1 of 25 groups off ┐
│ ☑ form (33)   ☐ prevalue-source (10)   ☑ record (11) …│
│ ⚠ Your MCP's environment sets collection filters for  │
│   this product, so these settings are ignored there.  │
└──────────────────────────────────────────────────────┘
┌ Umbraco Engage ─ not reported yet: start the MCP once ┐
                                          [ Save ]
```

- Ticked = enabled. Labels show the reported tool count.
- Products appear in capabilities order. A product the site reports as installed but with no catalogue entry shows "not reported yet". If nothing has ever been reported, the dashboard shows an empty state explaining that the MCP server must start once.
- The env warning comes from the module's `siteSettingsIgnored` flag.
- Save writes exactly what is shown and confirms with a notification. Dates shown as DD-MM-YYYY HH:mm.

## 5. npm server (`npm/src/core/`)

### 5.1 Precedence (env wins)

For each module:

1. If the environment sets **any collection filter for that module**—an entry in `UMBRACO_INCLUDE_TOOL_COLLECTIONS` or `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` that belongs to it (`forms:x`, `forms:*`, or unprefixed for CMS)—the site's list for that module is ignored and `siteSettingsIgnored` is `true`.
2. Otherwise the site's list becomes the module's `excludeToolCollections`.

Tool-level env lists need no special handling: the toolkit's `shouldIncludeTool` evaluates `UMBRACO_INCLUDE_TOOLS` before collection exclusions, so an env tool allow-list already wins. Slices, modes and `UMBRACO_READONLY` keep applying on top.

### 5.2 Changes

- `capabilities.ts`: `ProductCapability.disabledCollections?: string[]`. `isProduct` accepts a missing field and rejects a present field that is not an array of strings; a helper normalises to `[]`. `no-addon` / `unavailable` mean `[]` for every module.
- `filter-config.ts`: `buildModuleFilterInput(env, moduleId, isDefaultModule, siteDisabled)` returns `{ config, siteSettingsIgnored }`. `entriesFor` distinguishes "module not mentioned" from `forms:*`, which today both return `undefined`.
- New `catalogue.ts`: `buildCatalogue(ready, user, version)` (pure) and `reportCatalogue(payload, request = default)` using the same injected-request pattern as `fetchCapabilities`. It never throws; it returns `{ ok: true }` or `{ ok: false, reason }`.
- `server.ts`: after Phase 2, report the catalogue once and await it. A failure becomes a health issue; startup continues. `--list-tools` does not report.
- `health.ts`: per module, "Disabled in the backoffice: prevalue-source" or "… ignored because the environment sets collection filters for this module"; a top-level issue when the catalogue report failed.

## 6. Error handling

| Situation | Behaviour |
|---|---|
| Settings row missing / corrupt | Nothing disabled; warning logged on the site. |
| Store throws while building capabilities | `disabledCollections: []`; warning logged; capabilities still 200. |
| Catalogue POST fails (network, 403, old add-on → 404) | Startup continues; `get-mcp-health` reports the issue. |
| Site disables a collection the module does not have | No effect (the toolkit's exclusion simply matches nothing). |
| Old add-on (no field) | npm treats it as `[]`. |
| Old npm (ignores field, never POSTs) | Dashboard shows "not reported yet". |

## 7. Testing

**.NET (NUnit, hand-written fakes in `Fakes.cs`, existing `FakeKeyValueService`)**

- Store: round trip of both rows; per-module catalogue merge; corrupt JSON reads as empty.
- `McpCapabilitiesService`: `DisabledCollections` filled per product; a throwing store gives `[]`.
- Controller: `POST catalogue` is 403 for a non-API user and stores for an API user; `PUT` rejects unknown module ids and oversized payloads, trims and de-duplicates names.
- JSON shape: `disabledCollections` serialises camelCase.

**npm (Jest, no HTTP mocking)**

- `filter-config`: precedence table: site only; env exclude for the module; `forms:*`; env for another module only; unprefixed CMS entries; `UMBRACO_INCLUDE_TOOLS` still winning through `shouldIncludeTool`.
- `capabilities`: missing field → `[]`; malformed field rejected.
- `catalogue`: counts honour `enabled(user)`; failed request returns `{ ok: false }` without throwing.
- `health`: disabled list, ignored flag, report issue.

**End to end (`scripts/e2e.sh`)**

`PUT` Forms `prevalue-source` off → `--list-tools` shows no `forms--*prevalue-source*` tool → a normal start reported the catalogue (`GET tool-settings` lists Forms) → restore the original settings. The demo API user is in the Administrators group, so it has Settings access.

**Dashboard**

No unit tests (plain JS, no toolchain). Verified manually on the demo site in the browser: render, toggle, save, notification, empty state, "not reported yet", env warning.

## 8. Docs

- `README.md` and `src/Umbraco.Mcp/README.md`: "Turning tool groups off" section covering restart semantics, env precedence, and that this is focus, not security.
- `npm/README.md`: note that site settings apply unless the env sets collection filters for a module.
- `CLAUDE.md`: cross-language contract gains `disabledCollections`, the catalogue/tool-settings endpoints and the two key/value rows.
