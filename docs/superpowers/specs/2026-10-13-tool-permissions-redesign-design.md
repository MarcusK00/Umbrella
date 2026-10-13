# Tool Permissions Redesign and Product Off Switch — Design Spec

- **Date:** 13-10-2026
- **Status:** Approved, not implemented
- **Author:** mkr@umbraco.dk (with Claude)
- **Builds on:** `2026-10-12-backoffice-tool-toggles-design.md`, `2026-10-12-no-destructive-level-design.md`, `2026-10-13-per-api-user-tool-settings-design.md`

## 1. Intent

The Tool Permissions tab (Settings → Umbrella) works but reads as clutter. Each product card shows the following at once:

- a "Use defaults" toggle;
- warnings;
- three level radios;
- a checkbox grid with "4 of 12" counts;
- a header like "3 of 40 tools off · read-only".

How the level and the groups combine is not obvious. Unsaved changes are invisible: nothing on screen says there are any. The only prompt is an inline notice that appears when the API-user dropdown changes. Leaving the tab or the dashboard loses edits silently. There is also no way to switch a whole product off; unticking every group is tedious and still loads the product.

### Success criteria

- Each product has one control, an **access ladder**: **Off · Read-only · No deletes · Full**, with one sentence explaining the chosen step.
- Tool groups are behind a collapsed row per product ("Tool groups: 11 of 14 on").
- **Off** means the MCP server does not load the product at all, for the defaults or for one API user's override. `get-mcp-health` says why.
- CMS cannot be switched off: its Off step is shown disabled, and the API rejects it.
- Whenever the page differs from what is saved, a sticky bar says so and offers Discard and Save.
- Every way of leaving with unsaved changes asks first, in one consistent popup. The browser close/reload gets the browser's own prompt.
- Sites that never use Off behave exactly as before, and an older npm server against a newer add-on (or the reverse) keeps working.

### Out of scope

A site-wide "everything off" switch, bulk-editing several API users at once, and changing which groups are off by default.

## 2. Layout

```
┌ Tool permissions ─────────────────────────────────────────────────────┐
│ ● Unsaved changes                         [Discard]  [Save]           │  sticky, only when dirty
├──────────────────┬────────────────────────────────────────────────────┤
│ ▸ Defaults       │ Umbraco Forms                 Read-only · 38 tools │
│   All API users  │ [ Off │ Read-only │ No deletes │ Full ]            │
│                  │ Only tools that read. Nothing is created or        │
│ API users        │ changed.                                           │
│   Alice   custom │ ▸ Tool groups: 11 of 14 on                         │
│   Bob            │────────────────────────────────────────────────────│
│   CI bot  locked │ Umbraco Automate                               Off │
│                  │ [ Off │ Read-only │ No deletes │ Full ]            │
│                  │ Not loaded. Your AI tool won't see any Automate    │
│                  │ tools.                                             │
└──────────────────┴────────────────────────────────────────────────────┘
```

### Side list (who is being edited)

- It replaces the `uui-select` dropdown. "Defaults (All API users)" comes first, then a heading "API users" with one entry per API user.
- Each entry shows the name and its client ids. Tags:
  - `custom` when the user overrides at least one product (`overriddenProducts`);
  - `disabled` or `locked out` from `state`.
- The selected entry is marked (`aria-current`). The entries are buttons, not a native select, so the confirm popup cannot swallow a keystroke. That is why the inline notice existed.
- With no API users, the list shows only Defaults.
- Below ~48rem width, the list stacks above the cards.

### Product card

- **Header:** the display name, and on the right a summary:
  - `Off`;
  - `<Level> · <n> tools` when counts are available (the same effective count as today);
  - just `<Level>` when counts are not available.
- **Access ladder:** a segmented control (a `uui-button-group` of four buttons; the selected one is `look="primary"`). Labels and the hint shown below it:

  | Step | Stored level | Hint |
  |---|---|---|
  | Off | `off` | Not loaded. Your AI tool won't see any {Product} tools. |
  | Read-only | `readOnly` | Only tools that read. Nothing is created, changed or deleted. |
  | No deletes | `noDestructive` | Can create and change, but no tool that deletes or empties. |
  | Full | `full` | Every tool in the groups that are switched on. |

  For CMS the Off button is disabled, with the hint "CMS is always on: the MCP server signs in through it."
- **Tool groups:** a collapsed disclosure row "Tool groups: X of Y on", hidden when the step is Off. Expanded, it shows the checkbox grid as today: the group name and its count ("12", or "4 of 12" under a level).
  - The expanded/collapsed state is per card and per page visit. It is not saved.
- **One muted line per card**, with no separate boxes. Only the lines that apply are shown:
  - Defaults view: "2 API users have their own {Product} settings: Alice, Bob."
  - "Your MCP server's environment sets collection filters for {Product}, so the groups are ignored there. The access level still applies." (`siteSettingsIgnored`)
  - "The MCP server that last started is older and still includes destructive tools." (No deletes with no `nonDestructiveToolCount`)
- **Not reported:** a product the site detects but no catalogue lists keeps today's "Not reported yet…" text, but still shows the ladder. Off and the levels don't need the groups.

### User view

- A product without an override is dimmed and not editable. It shows the defaults' step and groups, a `Follows defaults` tag, and a **Customise for {name}** button. Customising copies the current defaults into an override, as the "Use defaults" toggle does today.
- An overridden product shows a `Custom for {name}` tag and a **Reset to defaults** link, which drops the override.
- The notes that sit in the intro box today become one muted line above the cards:
  - "Counts appear after this user's MCP server has started once."
  - the version mismatch warning.
- **Groups for a product the user's server didn't report:** when the user's own catalogue lacks the product (typically because it was Off for that user), the card uses that product's entry from the defaults catalogue (`GET /tool-settings` `catalogue`). Counts are hidden, with "Counts appear after this user's MCP server starts with {Product} on."

### Defaults view

The "Changes apply the next time the MCP server starts" text moves into the save notification, which already says to reconnect. The intro box goes away. The page heading "Tool permissions" sits in the sticky bar.

## 3. Unsaved changes

### Dirty state

- On load and after each save, the page keeps a **snapshot** of the saved state: the defaults, or the selected user's overrides.
- `dirty` is a comparison: the current edits, normalised to the PUT body, against the snapshot. It is not a flag set on edit, so changing something and changing it back is clean.

### Sticky bar

- It sits at the top of the Tool Permissions tab (`position: sticky`). The title "Tool permissions" and the Save button are always visible.
- When dirty:
  - "● Unsaved changes" appears with a **Discard** button;
  - Save is enabled.
- When clean, Save is disabled.
- **Discard** restores the snapshot without asking. The button is the explicit choice.

### One confirm popup

Every route out uses one method, `confirmLeave()`. If clean, it returns `true`. If dirty, it opens Umbraco's confirm modal:

- headline "Discard unsaved changes?";
- body "Your changes to {Defaults | Alice's settings} haven't been saved.";
- confirm button "Discard changes" (danger);
- cancel button "Keep editing".

If the user confirms, it restores the snapshot and returns `true`. The routes:

| Route | Where it is hooked |
|---|---|
| Picking another entry in the side list | the list's click handler awaits `confirmLeave()` |
| Clicking the Overview tab | `umbrella-dashboard.js` `#show` awaits `toolGroups.confirmLeave()` before switching |
| "Edit permissions" on the Overview | the existing `selectUser(key)` awaits `confirmLeave()` |
| Navigating anywhere else in the backoffice | `window` `willchangestate` listener (router-slot). If dirty: `preventDefault()`, `await confirmLeave()`, then `history.pushState({}, "", e.detail.url)` with a one-shot bypass flag. This is the pattern Umbraco 17's own workspaces use (checked in `Umbraco.Cms.StaticAssets` 17.7.0, `packages/core/workspace`). |
| Closing or reloading the browser tab | `beforeunload`: `preventDefault()` and `returnValue = ""` when dirty. The browser shows its own prompt. |

- The `willchangestate` and `beforeunload` listeners are added in `connectedCallback` and removed in `disconnectedCallback`.
- When the dashboard itself is on screen but the Tool Permissions tab is hidden, the page is never dirty, because leaving the tab already asked.
- The confirm modal is `umbConfirmModal` from `@umbraco-cms/backoffice/modal`. Before relying on it, check that it exists in `Umbraco.Cms.Api.Management` 17.0.0's backoffice (the add-on's minimum). If not, use `UMB_MODAL_MANAGER_CONTEXT` with `UMB_CONFIRM_MODAL`.

## 4. The Off level

### Storage

- **Defaults:** a new `umbracoKeyValue` row `Umbraco.Mcp.OffModules` holds a JSON list of product ids, next to `ReadOnlyModules` and `NoDestructiveModules`. Store methods: `GetOffModules` / `SetOffModules`.
- **Per-user overrides:** `McpToolLevel.Off = "off"`, valid in `McpProductOverride.Level`.
- **Precedence:** off, then read-only, then no destructive, then full. The stored lists stay exclusive.
- **No migration:** a missing row means nothing is off.

### API

- **`GET /mcp/tool-settings`:** adds `offModules`.
- **`PUT /mcp/tool-settings`:**
  - accepts `offModules`, validated like `readOnlyModules`;
  - an id in more than one of the three lists returns 400;
  - `"cms"` in `offModules` returns 400 ("CMS cannot be switched off: the MCP server signs in through it.").
- **`PUT /mcp/tool-settings/users/{key}`:** level `off` is accepted. `"cms"` with level `off` returns 400.
- **Required product:** the add-on knows CMS is required through a constant `McpProducts.RequiredId = "cms"`, which must equal the npm module with `required: true`. A contract test checks it.

### Capabilities payload

- Each product gets `off: boolean` (`McpProductStatus.Off`), resolved for the calling API user like the other settings.
- When `off` is true, `disabledCollections`, `readOnly` and `noDestructive` are still sent as stored. npm ignores them for that product.
- An older npm server ignores `off` and loads the product. The existing version-mismatch warnings cover that pairing.

### npm server

- **Payload:** `capabilities.ts` adds `off?: boolean | null` to the type and its validation, and `siteOff(caps, moduleId)` next to `siteReadOnly`. A missing or null value means `false`.
- **`selectModules`:** after `required` and before `UMBRACO_MCP_MODULES` forcing, a product with `off` is not loaded. The reason:
  - "Switched off in the backoffice (Settings → Umbrella)." for the defaults;
  - "Switched off for this API user in the backoffice (Settings → Umbrella)." when `settingsScope` is `user`.

  The backoffice wins over forcing, as the read-only level already wins over env filters.
- **`get-mcp-health`:** shows the reason through the existing not-loaded path. It is a note, not an issue, because Off is not a failure.
- **Catalogue:** an off product is not loaded, so its server does not report it. `POST /mcp/catalogue` is unchanged.

### Add-on side effects

- **Tool counts:** `McpToolCounts.Effective` returns 0 for an off product. `McpOverviewService.AccessLevel` returns `"off"` first.
- **Overview and health checks:** they show the level "Off". An off product must not produce a finding, such as "detected but not reported".
- **Defaults catalogue:** `McpCatalogueFallback.Highest` fills any module that no API user reported from the shared row. The defaults view can then still show the groups of a product every user has off.

## 5. Component structure

`umbrella-tool-groups.js` is 530 lines today and would grow. It is split:

- **`umbrella-tool-groups.js`:** the page. It owns loading, the snapshot and dirty comparison, the side list, the sticky bar, saving and `confirmLeave()`.
- **`umbrella-product-card.js`:** one product card. Its properties:
  - `product` and `module` (the catalogue entry or null);
  - `level`, `disabled` (a Set), `editable`, `showCounts`;
  - `mode` (`defaults` | `follows` | `custom`);
  - `notes`, `isRequired`.

  It emits `level-change`, `group-change`, `customise` and `reset`. It has no requests and no state beyond its expanded flag.
- **`umbrella-unsaved-guard.js`:** a small controller (a Lit `ReactiveController`). It adds and removes the `willchangestate` and `beforeunload` listeners and calls back into `confirmLeave()`.

`umbrella-dashboard.js` changes only in `#show`, which awaits the guard.

## 6. Testing

### .NET (NUnit)

- **Store:** round-trips `OffModules`.
- **`PUT /tool-settings`:**
  - an id in two of the lists returns 400;
  - `cms` in `offModules` returns 400;
  - a valid list saves.
- **User `PUT`:** `off` is accepted, and `cms` with `off` returns 400.
- **Capabilities:** `off` comes from the defaults and from a user override.
- **Counts:** `McpToolCounts.Effective` is 0 when off.
- **Overview:** the access level is `off`, with no finding for an off product.
- **Fallback:** `Highest` fills missing modules from the shared row.
- **Contract:** `McpProducts.RequiredId` equals the npm module whose `required` is true.

### npm (Jest)

- **Payload:** `interpretCapabilitiesResponse` accepts `off` true, false, null and missing, and rejects a non-boolean.
- **`selectModules`:**
  - an off product is not loaded, even when forced;
  - the reason depends on the scope;
  - CMS loads even if a broken payload says `off`.
- **Health:** shows the off note as a note, not an issue.

### Manual, in the demo site

- **Ladder:** switch Forms Off in the defaults, then confirm `get-mcp-health` and the tool list.
- **Overrides:** override for one API user, then reset.
- **Groups:** expand and collapse a card's groups.
- **Dirty state:** edit and undo, so the bar disappears.
- **Every leave route from section 3:** the side list, the Overview tab, Edit permissions, another backoffice section, and a browser reload.
- **Narrow width.**

## 7. Docs

Update the following to describe the ladder, Off, `offModules`, the payload `off` field and the selection rule:

- `README.md` (tool permissions and troubleshooting);
- `src/Umbraco.Mcp/README.md`;
- `docs/architecture.md` and `docs/architecture-map.html`;
- `CLAUDE.md` (the capabilities payload, tool settings and npm startup bullets).
