# No Destructive Tools Level — Design Spec

- **Date:** 12-10-2026
- **Status:** Approved, not implemented
- **Author:** mkr@umbraco.dk (with Claude)
- **Builds on:** `2026-10-12-backoffice-tool-toggles-design.md` (tool groups, read-only), `2026-10-12-dashboard-overview-design.md` (Overview tab)
- **Part of:** roadmap idea #1 "Fewer tools by default", piece B.

## 1. Intent

Today a product's tools are either all on or read-only. Most sites want something in between: the AI may create and edit, but not delete. Each product gets a third level, **No destructive tools**, which removes every tool the product itself marks `destructiveHint`.

### What "destructive" means

Exactly the tools whose annotations carry `destructiveHint: true`, as the product teams set them. Umbrella keeps no list of its own on top. Measured 12-10-2026 offline from the installed packages (CMS `@umbraco-cms/mcp-dev` 17.6.10, Forms 17.6.1-beta.4, Automate 17.4.0-beta.2, Engage 17.0.0-beta.3), with 693 tools in all:

- 74 tools are flagged: CMS 39, Forms 10, Automate 8, Engage 17 (Appendix A).
- All 68 tools named `delete-…`, `empty-…`, `remove-…`, `terminate-…` or `…-permanently` are flagged.
- Three tools that take something off the live site are not flagged and stay at this level: `cms--unpublish-document`, `automate--unpublish-automation` and `forms--rollback-form-version`.
- Four flagged tools are not deletes: `forms--execute-record-action`, `engage--post-main-switch-turn-off`, `engage--post-permissions-document-type` and `engage--post-permissions-user-group`.
- The 61 tools with no annotations (CMS 53, Automate 8) include no deletes. They are creates, copies, moves, publish/unpublish, restore, upload, import and run control.

### Success criteria

- On the Tool groups tab, each product has a three-way choice: Full access / No destructive tools / Read-only. It replaces the read-only toggle.
- A product set to No destructive tools exposes no tool with `destructiveHint`. Every other tool its group settings allow stays available.
- `UMBRACO_NO_DESTRUCTIVE=true` gives the same result for every product, with or without the add-on.
- The level applies even when env collection filters make the site's group settings ignored.
- `get-mcp-health` names the level and how many tools it removed.
- Sites that never choose a level behave exactly as today (Full access), including after the upgrade.
- A product release that changes which tools are flagged fails CI until the snapshot (Appendix A) is updated on purpose.

### Out of scope

A site-wide switch, an Umbrella list of extra tools, changing the default, and annotating the 61 unannotated tools (that belongs upstream).

## 2. Storage and payload

- **Storage:** a new `umbracoKeyValue` row `Umbraco.Mcp.NoDestructiveModules` holds a JSON list of product ids. It sits next to the existing `Umbraco.Mcp.ReadOnlyModules`.
- **Level:** a product's level comes from the two lists:
  - in the read-only list → Read-only
  - else in the no-destructive list → No destructive tools
  - else → Full access

  No migration is needed.
- **Capabilities payload:** each product gets `noDestructive: boolean` (`McpProductStatus.NoDestructive`, camelCase). On the npm side, a missing or null value means `false`.
  - An older server ignores the field and keeps the destructive tools. The existing version-mismatch warnings flag that pairing.
- **`GET /mcp/tool-settings`:** returns `noDestructiveModules`.
- **`PUT /mcp/tool-settings`:** accepts `noDestructiveModules`.
  - It is validated like `readOnlyModules`: detected product ids only, trimmed, no duplicates, and the same size limit.
  - A missing value means none.
  - A `PUT` that puts the same id in both lists returns 400 and stores nothing.
- **Catalogue (`POST /mcp/catalogue`):** each collection gets `nonDestructiveToolCount: number`, the usable tools that are not destructive. It is clamped to `0..toolCount` like `readOnlyToolCount`, and is null in older reports (`McpCollectionInfo.NonDestructiveToolCount`, `int?`).

## 3. npm server

- **Predicate:** `isDestructive(tool)` in `npm/src/core/` returns `tool.annotations?.destructiveHint === true`. Registration, the catalogue count and the health note all use it.
- **`capabilities.ts`:** add `noDestructive?: boolean | null` to the payload type and its validation. Add `siteNoDestructive(caps, moduleId)` next to `siteReadOnly`.
- **`filter-config.ts`:**
  - `UMBRACO_NO_DESTRUCTIVE`: `true` (trimmed, any case) turns the level on for every module, like `UMBRACO_READONLY`.
  - `buildEffectiveFilterInput` gains a `siteNoDestructive` argument. Its result carries `excludeDestructive`, which is true when the site or the env asks for it, whether or not env collection filters are set.
- **`tool-registrar.ts` `registerModuleTools`:** after `shouldIncludeTool`, skip the tool when `excludeDestructive && isDestructive(tool)`. Read-only plus no-destructive gives the same tools as read-only alone.
- **`catalogue.ts`:** per collection, `nonDestructiveToolCount` = the usable tools for which `isDestructive` is false.
- **`health.ts`:**
  - `ModuleRuntimeState` gets `siteNoDestructive` and `destructiveRemoved`, the number of tools the level removed.
  - The notes read:
    - from the dashboard: `{name}: no destructive tools ({n} removed), as set in the backoffice.`
    - from the env: `UMBRACO_NO_DESTRUCTIVE is set, so destructive tools are removed for every product.`

    The env note appears once.

## 4. Dashboard and add-on

### Tool groups tab (`umbrella-tool-groups.js`)

- **The choice:** a `uui-radio-group` with three `uui-radio` options replaces the read-only `uui-toggle`. Labels: `Full access`, `No destructive tools`, `Read-only`.
- **Box header:** `{off} of {n} groups off`, followed by ` · no destructive tools` or ` · read-only` when that level is chosen.
- **Group labels:** `{name} ({nonDestructiveToolCount} of {toolCount})` at the new level when the count is a number, as read-only already does. Otherwise just the count.
- **Save:** sends `readOnlyModules` and `noDestructiveModules`, both for every detected product, as read-only does today.
- **Older server:** when the product is set to No destructive tools and none of its reported collections has a numeric `nonDestructiveToolCount`, the box shows this in warning style:

  > The MCP server that last started is older and still includes destructive tools. Update umbrella-mcp to apply this level.

### Overview tab (`umbrella-overview.js`)

The products table gets an `Access` column, between `MCP server` and `Tools available`. It shows `Full access`, `No destructive tools` or `Read-only`, from `McpOverviewProduct.Access` (`"full" | "noDestructive" | "readOnly"`).

### Add-on (C#)

- `IMcpToolSettingsStore` and `KeyValueMcpToolSettingsStore`: `GetNoDestructiveModules()` / `SetNoDestructiveModules(...)`.
- `McpCapabilitiesService` sets `NoDestructive`. A store failure is handled like the read-only list: the value falls back to false and is logged.
- `McpToolSettingsValidation`:
  - normalise the new list
  - reject overlap between the two lists
  - clamp `NonDestructiveToolCount`
- `McpToolSettingsController`: GET and PUT carry the new list.
- `McpOverviewService`: sets `Access` on each product.

## 5. Testing

- **NUnit:**
  - payload `noDestructive` from the store
  - the store's read and write
  - PUT normalising, PUT rejecting an overlap with nothing stored, and PUT without the field clearing it
  - catalogue clamping and null for older reports
  - `Access` for all three levels
- **Jest:**
  - `tool-registrar`: the level drops exactly the flagged tools; read-only + no-destructive equals read-only.
  - `filter-config`: env alone, site alone, and the level surviving env collection filters.
  - `capabilities`: missing or null means false.
  - `catalogue`: the new count.
  - `health`: both notes, with the count.
  - **Contract snapshot:** the set of `<prefix><name>` tools with `destructiveHint` across the installed packages equals a committed list (`npm/src/modules/__tests__/destructive-tools.snapshot.json`, contents as Appendix A). The failure message says to review the new or removed tools and update the file.
- **`scripts/e2e.sh`:**
  1. PUT `noDestructiveModules: ["forms"]`.
  2. Run `--list-tools`: no `forms--delete-form`, but `forms--list-forms` is still there.
  3. Restore the settings.
- **By hand on the demo site:** the radio group saves and reloads, the header and counts are right, the older-server warning shows, and the Overview's Access column is filled.

## 6. Docs

- `README.md`: the three levels (Configuration and the tool groups text), `UMBRACO_NO_DESTRUCTIVE` in the env table, and what "destructive" means (the products' flag: deletes, emptying recycle bins, terminating runs, a few Engage switches; unpublish is not included).
- `npm/README.md`: the env var.
- `src/Umbraco.Mcp/README.md`: the levels.
- `docs/architecture.md` and `CLAUDE.md`: the contract lines (`noDestructive`, `noDestructiveModules`, `nonDestructiveToolCount`, the `Umbraco.Mcp.NoDestructiveModules` row, `isDestructive`, the snapshot test).

## Appendix A — tools flagged destructive (12-10-2026)

- **cms** (39): `delete-data-type-folder`, `delete-data-type`, `delete-dictionary-item`, `delete-document-block`, `delete-document-blueprint-folder`, `delete-document-blueprint`, `delete-document-public-access`, `delete-document-recycle-bin-item`, `delete-document-type-folder`, `delete-document-type`, `delete-document`, `delete-from-recycle-bin`, `delete-language`, `delete-log-viewer-saved-search-by-name`, `delete-media-from-recycle-bin`, `delete-media-recycle-bin-item`, `delete-media-type-folder`, `delete-media-type`, `delete-media`, `delete-member-group`, `delete-member-type`, `delete-member`, `delete-partial-view-folder`, `delete-partial-view`, `delete-redirect`, `delete-script-folder`, `delete-script`, `delete-stylesheet-folder`, `delete-stylesheet`, `delete-template`, `delete-temporary-file`, `delete-user-avatar-by-id`, `delete-user-current-avatar`, `delete-user-data`, `delete-user-group`, `delete-user-groups`, `delete-webhook`, `empty-media-recycle-bin`, `empty-recycle-bin`
- **forms** (10): `delete-data-source`, `delete-folder-permanently`, `delete-folder`, `delete-form-field`, `delete-form-permanently`, `delete-form`, `delete-prevalue-source`, `delete-record`, `empty-recycle-bin`, `execute-record-action`
- **automate** (8): `delete-automation`, `delete-connection`, `delete-workspace-group`, `delete-workspace`, `disconnect-automation-steps`, `remove-automation-step`, `rollback-version-history`, `terminate-run`
- **engage** (17): `delete-ab-test-project`, `delete-ab-test-variant`, `delete-ab-test`, `delete-annotations`, `delete-applied-personalization`, `delete-campaign-group`, `delete-content-scoring-journey`, `delete-content-scoring-persona`, `delete-customer-journey`, `delete-persona`, `delete-referral-group`, `delete-segments-delete-segment-content`, `delete-segments`, `delete-traffic-filter`, `post-main-switch-turn-off`, `post-permissions-document-type`, `post-permissions-user-group`
