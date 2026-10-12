# Default-off Tool Groups — Design Spec

- **Date:** 12-10-2026
- **Status:** Approved, not implemented
- **Author:** mkr@umbraco.dk (with Claude)
- **Builds on:** `2026-10-12-backoffice-tool-toggles-design.md`
- **Part of:** roadmap idea #1 "Fewer tools by default", piece A of four (A defaults, B no-destructive level, C dashboard presets, D output-schema stripping). B–D get their own specs.

## 1. Intent

Some tool groups add nothing on a site that runs several products, and a smaller tool list helps every AI client: less context, better tool choice, and staying under clients that cap the number of tools. A module can now name groups that are **off by default**. They stay off until someone switches them on in the Umbrella dashboard or overrides them with environment variables.

### What is off by default

| Module | Collection | Tools | Why |
|---|---|---|---|
| Forms | `umbraco-server` | `get-server-info` | Same "Umbraco server information" tool as Automate's; CMS `get-server-information` covers it. |
| Forms | `acceptance-tests` | `get-acceptance-tests-system-info` | Host OS and database engine, a test aid. |
| Automate | `umbraco-server` | `get-server-info` | As Forms. |

Measured 12-10-2026 against Forms 17.6.1-beta.4 and Automate 17.4.0-beta.2: 3 tools. `empty-recycle-bin` also exists in CMS and Forms, but they are different tools and stay on.

### Success criteria

- On a site that never saved tool settings, and with no collection env vars, `--list-tools` and `tools/list` contain no `forms--get-server-info`, `automate--get-server-info` or `forms--get-acceptance-tests-system-info`.
- The same holds with no add-on installed.
- The dashboard shows those three groups unticked for a product without saved settings; ticking one, saving and restarting the MCP server brings its tool back.
- `UMBRACO_INCLUDE_TOOL_COLLECTIONS=forms:*` (or any other collection filter for the module) brings them back too.
- `get-mcp-health` says which groups are off by default and where to switch them on.
- A default that names a collection the package does not have fails the contract test.

### Decisions

| Question | Decision |
|---|---|
| How hard | Off by default, can be switched on. Not removed. |
| Where defaults live | In the npm module definition. The add-on stays product-agnostic. |
| When defaults apply | Only when the site has no saved list for that module and the env sets no collection filter for it. |
| Once saved | The saved list wins, including over defaults added in later releases. |
| Settings format | Unchanged. `PUT /mcp/tool-settings` and the stored rows keep their shape. |

## 2. Precedence

Per module, in `buildEffectiveFilterInput` (`npm/src/core/filter-config.ts`):

1. **Env:** the env sets a collection filter for the module (`envSetsCollectionFilter`, including `module:*`). The site's list and the defaults are both ignored. This extends today's `siteSettingsIgnored` rule.
2. **Saved list:** the site reports an array for the module. It becomes `excludeToolCollections` as it is, `[]` included.
3. **Defaults:** otherwise the module's `defaultDisabledCollections` become `excludeToolCollections`. This covers "never saved", "no add-on" and "capabilities unavailable".

Read-only and the other env lists are unaffected.

Consequence, documented in the README: an env collection filter replaces the defaults too, so `UMBRACO_EXCLUDE_TOOL_COLLECTIONS=forms:folder` also brings back the default-off Forms groups.

## 3. Contract changes

### 3.1 Module contract (npm)

`McpProductModule` gets:

```ts
/** Collections that stay off until the site or the env switches them on. Must exist in the package. */
defaultDisabledCollections?: string[];
```

Set in `forms.ts` (`["umbraco-server", "acceptance-tests"]`) and `automate.ts` (`["umbraco-server"]`).

### 3.2 Capabilities payload

`products[].disabledCollections` is **`null` when the site has no saved list for that product**, and an array (possibly empty) when it has one. Today it is always an array.

- **C#:** `McpProductStatus.DisabledCollections` becomes `IReadOnlyList<string>?`. `McpCapabilitiesService` sets it from `GetDisabledCollections().GetValueOrDefault(id)`, with no `?? []`. A failing store still yields `null` per product, so defaults apply then too.
- **npm:** `capabilities.ts` already accepts `null`/missing. `siteDisabledCollections` returns `string[] | null` and stops collapsing `null` to `[]`. Missing means `null`.

### 3.3 Catalogue report

`POST /mcp/catalogue` collections get an optional `disabledByDefault: boolean` (`true` only where it applies; omitted or `false` otherwise).

- **npm:** `buildCatalogue` sets it from the module's `defaultDisabledCollections`.
- **C#:** `McpCollectionInfo` gets `bool DisabledByDefault = false`; `TryNormalizeReport` keeps it; it is stored with the catalogue and returned by `GET /mcp/tool-settings`.

## 4. Add-on and dashboard

- **Dashboard** (`umbrella-dashboard.js`): when loading, a product with no key in `disabledCollections` starts with its catalogue's `disabledByDefault` groups unticked. A product with a key uses the saved list as today. Saving is unchanged: it writes a list for every visible reported product, after which that list wins.
- No new endpoint, store key or health check.

## 5. Health

`get-mcp-health` (`health.ts`): when defaults applied to a module and removed at least one collection, it adds:

> `Umbraco Forms: tool groups off by default: umbraco-server, acceptance-tests. Switch them on in the Umbrella dashboard.`

Without the add-on, the sentence ends "…set UMBRACO_INCLUDE_TOOL_COLLECTIONS." instead. The existing "disabled in the backoffice" note keeps covering saved lists; the two never appear together for one module.

## 6. Compatibility

| Add-on | Server | Result |
|---|---|---|
| new | new | As designed. |
| old | new | The old add-on always sends `[]`, so defaults never apply; same tools as today. The drift warnings already flag the mismatch. |
| new | old | The old server treats `null` as `[]`; same tools as today. It ignores `disabledByDefault`. |
| none | new | Defaults apply. |

## 7. Testing (TDD)

**npm**
- `filter-config`: env filter beats saved list and defaults; saved `[]` beats defaults; `null` applies defaults; no defaults and `null` excludes nothing; `module:*` ignores defaults.
- `capabilities`: `siteDisabledCollections` returns `null` for `null`, missing product and unavailable/no-addon, and the array otherwise.
- `catalogue`: `disabledByDefault` set only on default collections.
- `health`: the default-off note with and without the add-on; no note when a saved list exists or when the env overrode.
- `contract.test.ts`: every `defaultDisabledCollections` entry names a collection in the module's loaded package (skipped modules excepted, as for the other load tests).

**.NET**
- `McpCapabilitiesService`: `null` with no stored entry, `[]` for a stored empty list, `null` when the store throws.
- `McpToolSettingsValidation.TryNormalizeReport` keeps `DisabledByDefault`; the store round-trips it.

**End to end**
- `scripts/e2e.sh`: when `get-mcp-health` reports Forms groups off by default, the tool list must lack `forms--get-server-info`. When it doesn't (the demo site already has saved Forms settings), the check prints a note and skips rather than fails.

## 8. Docs

- `README.md`: configuration section, the default-off groups and the precedence in §2.
- `docs/architecture.md` and `CLAUDE.md`: capabilities `null` semantics, catalogue `disabledByDefault`, the module field.
- `docs/adding-a-product.md`: the optional `defaultDisabledCollections` field and when to use it (duplicates of CMS tools, test aids).

## 9. Out of scope

- The no-destructive level, dashboard presets and output-schema stripping (pieces B–D).
- Changing the store format to keep defaults apart from user choices (rejected: later defaults would reach saved sites, but `PUT` and the stored rows would change shape).
- Removing tools permanently.
