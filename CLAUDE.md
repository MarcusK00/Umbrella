# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Umbrella: "one MCP server per Umbraco site", a personal project (not under the Umbraco organisation). Two halves are designed and released together, with the same version:

- **`src/Umbraco.Mcp`** (NuGet **`Umbraco.Community.Umbrella`**): an add-on installed in the Umbraco 17 site. It detects which Umbraco HQ products are installed, serves `GET /umbraco/management/api/v1/mcp/capabilities`, adds an "MCP" backoffice health check group, and the "Umbrella" dashboard with the client config per API user.
- **`npm/`** (npm **`umbrella-mcp`**): a stdio MCP server that AI tools start with `npx`. It loads the CMS, Forms, Automate and Engage tool collections in one process, but only for the products the site reports, and prefixes every tool `<module-id>--`.

The original design is `docs/superpowers/specs/2026-10-11-umbraco-mcp-umbrella-design.md`. The plan it was built from, including its spec deltas and global constraints, is `docs/superpowers/plans/2026-10-11-umbraco-mcp-umbrella.md`. Specs and plans under `docs/superpowers/` are dated records and are not updated afterwards. That folder is gitignored and exists only in the maintainer's local checkout; a fresh clone does not have it, so the docs below must stand on their own.

Current docs, to keep in sync with the code:
- `README.md`: setup, configuration, troubleshooting and known limitations, for users.
- `docs/architecture.md`: how the code works, for contributors. It overlaps this file; update both.
- `docs/architecture-map.html`: the same in diagrams (hand-written inline SVG). Update it with `docs/architecture.md`.
- `docs/development.md`: setup from a fresh clone, tests, the e2e scripts.
- `docs/adding-a-product.md`, `docs/releasing.md`, `docs/merging.md`.

This repository is public and is Umbrella's public home: issues (the forms in `.github/ISSUE_TEMPLATE`), `SECURITY.md` with private vulnerability reporting, and the user docs in `README.md`. The NuGet `PackageProjectUrl`, the npm `homepage` and `bugs` fields and the READMEs link here; links to docs, `SECURITY.md` and images use `v17/main`, the released branch, because the default branch `v17/dev` can be ahead of the release. The earlier public tracker, MarcusK00/Umbrella-Issues, from when this repository was private, is no longer updated.

Both packages are released; 17.0.0 is the first stable version (the `17.0.0-alpha.N` versions before it were test releases). From 17.0.1 the NuGet package carries the `umbraco-marketplace` tag, so the Umbraco Marketplace lists it, and `umbraco-marketplace.json` in the repository root holds the listing details and `umbraco-marketplace-readme.md` the listing text (`docs/releasing.md`). The source folders, namespaces and solution keep their `Umbraco.Mcp` names; only the package ids changed. Earlier working names were `Umbraco.Mcp` / `@umbraco/mcp`.

## Commands

### .NET add-on (repo root)

```bash
dotnet test Umbraco.Mcp.slnx                                     # all NUnit tests
dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj     # tests only, without building demo-site
dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter McpProductsHealthCheckTests   # one fixture
dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter "FullyQualifiedName~Not_installed_when_assembly_missing"   # one test
```

`Umbraco.Mcp.slnx` includes `demo-site/`, so testing the solution also builds the demo site. If the demo site is running, stop it first or test the `.csproj` directly.

### npm server (`cd npm`)

```bash
npm install
npm run compile        # tsc --noEmit (strict)
npm test               # Jest 30 + ts-jest, ESM, runInBand
npm test -- tool-registrar                    # one test file (path pattern)
npm test -- routing -t "prefixes the product" # one test by name
npm run build          # tsup -> dist/index.js
npm run list-tools     # node --env-file=.env dist/index.js --list-tools
```

Jest runs with `--experimental-vm-modules`, so an `ExperimentalWarning` on every run is expected. When an imported module doesn't exist yet, the failure reads `Could not locate module ../x.js mapped as: $1`.

### Demo site and end-to-end check

```bash
dotnet run --project demo-site --launch-profile Umbraco.Web.UI   # https://localhost:44399 (http :9399)
node scripts/create-api-user.mjs        # creates client "umbraco-back-office-mcp"; prints a generated secret
scripts/e2e.sh                          # needs the site running, npm/.env and a built npm/dist
scripts/pack-check.sh                   # packs umbrella-mcp, installs it with npx in an empty folder, checks it against the site
bash scripts/check-guards.sh            # repo guards CI runs on every PR; see docs/merging.md
```

- **Demo admin:** `admin@test.com` / `SecurePass1234` (unattended install, set in `demo-site/appsettings.Development.json`).
- **HTTPS:** the token endpoints reject plain HTTP, so `UMBRACO_BASE_URL` must be https, and local `npm/.env` sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for the self-signed certificate.
- **Automate config:** Automate only boots with `Umbraco:Automate:UseNamedConnectionString=umbracoDbDSN` in the demo site's appsettings.
- **`e2e.sh` greps:** the script uses here-strings (`grep … <<< "$X"`), not `echo | grep -q`. Under `pipefail`, the ~2 MB tool list makes `echo` die with SIGPIPE and the check falsely fails.

## Architecture

### The cross-language contract

- **Ids:** each .NET detector's `Id` (`Detection/Detectors/*Detector.cs`) must equal its npm module's `id` (`npm/src/modules/*.ts`), for example `"forms"`.
- **Capabilities payload:** `{ addonVersion, products: [{ id, displayName, installed, enabled, version, issues, disabledCollections, disabledTools, readOnly, noDestructive, off, noSectionAccess, settingsScope }] }` in camelCase. It is defined by `McpCapabilities` / `McpProductStatus` in C# and by `CapabilitiesPayload` in `npm/src/core/capabilities.ts`. `disabledTools` is a `string[]` of unprefixed tool names switched off in the backoffice (missing/null → none; `registerModuleTools` skips them after the filters and the no-destructive check, `siteDisabledTools()`). `disabledCollections` is `null` when the site has no saved list for the product; on the npm side `null`/missing means "no saved list", so the module's `defaultDisabledCollections` apply. `readOnly`, `noDestructive`, `off` and `noSectionAccess` missing or null → `false`. `off` means npm does not load the product (`selectModules`, after `required` and before `UMBRACO_MCP_MODULES` forcing); the other settings are still sent as stored. `noSectionAccess` is set only for an API caller whose user groups don't grant the product's `SectionAlias` (the controller passes the caller's section names to `GetCapabilities(apiUserKey, allowedSections)`); npm then skips the product too, right after `off`, as its API would refuse every tool. `settingsScope` is `"site"` or `"user"` (the settings in the payload are the defaults or the calling API user's override for that product); missing, null or any other value → `"site"` (`siteSettingsScope()`).
- **Tool settings:** `POST /mcp/catalogue` (API users only) receives `{ umbrellaVersion, modules: [{ id, collections: [{ name, toolCount, readOnlyToolCount, nonDestructiveToolCount, disabledByDefault?, tools? }] }] }` from `catalogue.ts` on every start, including `--list-tools` (`tools` is `[{ name, description, readOnly, destructive }]`, null/missing from older servers, and when present the add-on derives the counts from it: names trimmed and unique, at most 300 tools per collection, names 100 characters, descriptions cut to 200; `readOnlyToolCount` and `nonDestructiveToolCount` are null and `disabledByDefault` missing in older reports; the dashboard unticks `disabledByDefault` groups for a product without a saved list). `GET/PUT /mcp/tool-settings` (Settings section) carry `disabledCollections`, `disabledTools` (`{ productId: [tool names] }`, unprefixed; at most 500 names of 100 characters per product; missing = none), `readOnlyModules`, `noDestructiveModules` and `offModules` (a product in more than one level list → 400; `cms` in `offModules` → 400, `McpProducts.RequiredId` must equal the npm module with `required: true`) and back the "Umbrella" dashboard in `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella` (Tool Permissions: `umbrella-tool-groups.js` page with the side list, saved-state snapshot and `confirmLeave()`; `umbrella-product-card.js` per product with the access ladder Off · Read-only · No deletes · Full, the tools-left bar and filterable tool groups; `umbrella-unsaved-guard.js` cancels the router's `willchangestate` and `beforeunload` while there are unsaved changes). They are stored in the `umbracoKeyValue` rows `Umbraco.Mcp.ToolSettings`, `Umbraco.Mcp.DisabledTools`, `Umbraco.Mcp.ReadOnlyModules`, `Umbraco.Mcp.NoDestructiveModules`, `Umbraco.Mcp.OffModules` and `Umbraco.Mcp.Catalogue`: the defaults for all API users, and the most recent report from any user, merged per module. Collection exclusions come from the site's saved list (`[]` included), else the module's `defaultDisabledCollections` (no module sets it, so every group is on by default; the contract test checks that), but the site's read-only always applies, ORed with `UMBRACO_READONLY` (`buildEffectiveFilterInput`). The no-destructive level works the same way, ORed with `UMBRACO_NO_DESTRUCTIVE`; it removes tools where `isDestructive(tool)` (`npm/src/core/destructive.ts`, `annotations.destructiveHint === true`) holds, and the stored levels are exclusive (off, then read-only first). `UMBRACO_INCLUDE_TOOL_COLLECTIONS` and `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` were removed in 17.1.0: `buildEffectiveFilterInput` no longer reads them, and `removedCollectionEnvVars` makes `get-mcp-health` note any that are still set. Kept tools: the stored `disabledTools` are never changed by a level or a group switch (a tool the level removes counts as off for the level, not as switched off), and the dashboard prunes unknown names on save only against the site-wide catalogue, and only when it lists tools for every group of the product. The contract test `destructive-tools.snapshot.json` fails when a product changes which tools it flags; review the diff and regenerate it.
- **Per-API-user settings:** the defaults above can be overridden per product for one API user: `Umbraco.Mcp.UserToolSettings.<userKey>` holds `{ "<productId>": { disabledCollections, level, disabledTools? } }` (`level` is `full`, `noDestructive`, `readOnly` or `off`; present = overridden all-or-nothing, absent = defaults). `GET /mcp/capabilities` resolves the settings for the calling API user (`McpCapabilitiesService.GetCapabilities(Guid? apiUserKey)`) and sets `settingsScope` and `disabledTools` per product; non-API callers get the defaults, so npm needs no change. `POST /mcp/catalogue` stores the report per caller in `Umbraco.Mcp.UserCatalogue.<userKey>` (replaced on each start) and still merges into the shared `Umbraco.Mcp.Catalogue` row, which is the fallback for a user without a report. `IKeyValueService` has no delete, so removing a row writes `""`, and readers skip blank rows and rows of users that are not API users any more. `GET /mcp/tool-settings` adds `apiUsers` (every API user, via `IMcpApiUserDirectory`), and its `catalogue` is the highest counts per group any existing API user reported (`McpCatalogueFallback.Highest`; the shared row before any user has its own report, and for modules no user reported). `GET /mcp/tool-settings/users/{userKey}` (Settings section) returns that user's `overrides` with the `catalogue` to show, its `catalogueSource` (`user`, `latest` or `none`) and `noSectionAccess` (product ids its groups lack the section for, via `McpApiUserInfo.AllowedSections`; Tool Permissions leaves them out of that user's view); `PUT` replaces the overrides (empty map = follow the defaults) and returns only the saved `overrides`; both 404 for an unknown or non-API user, checked before validation. `GET /mcp/overview` lists the connected API users, then the ones the New connection flow created that have not connected yet (`connected: false`, `lastConnected: null`; from the `Umbraco.Mcp.CreatedApiUser.<userKey>` rows written by `POST /mcp/created-users/{userKey}`, Users section; never in findings or health checks, `McpHealthCheckRows` filters on `Connected`), and carries `canManageUsers` (the caller has the Users section, set by the controller) and per product `sectionAlias`. API user rows carry `groups` (its user group names, sorted), `sections`, `serverVersion`, `lastReportedAt`, `access` (per product: level, scope, `sectionAccess` and `toolCount` after the user's settings, `McpToolCounts.Effective`, the one rule for kept tools: group on, level (`KeptTools`), not in `disabledTools`; per-group counts for groups reported without tools; 0 when off or without section access; an off product raises no missing-section finding, and a missing section is an info finding, not a warning, shown as "No access" in the access table) and their summed `toolCount`, and the version-mismatch finding is an info note, one per older version naming its connected users (the shared-row note when no connected user has its own report). An installed, enabled product missing from the own report of a connected user it is on for (with the section) is a products warning naming those users (`NotLoadedBy`); a connected user whose own report has the module without per-tool lists (an older server) while switched-off tools apply to it is a second products warning that the server still offers them (`IgnoringDisabledTools`); the Overview has no separate products list. `DELETE /mcp/connections/{userKey}` also clears that user's catalogue and its created-user row, and keeps its overrides (404 only when there was neither a connection nor a created row). `get-mcp-health` notes say "for this API user" for `settingsScope: "user"`, and the report starts with `access`: the API user's name and a one-line summary of what it can use (each product also has an `access` value).
- **Detection:** `ProductDetectorBase` treats a product as **installed** when an assembly with the given name is loaded. It treats it as **enabled** when some live controller action carries Umbraco's `[MapToApi("<api-name>")]` with that API name. The check uses MVC action descriptors, not Swagger options.
- **npm package:** `McpClientConfig.NpmPackage` (C#) must equal `name` and the `bin` key in `npm/package.json`, and the csproj `<Version>` must equal the npm `version`, because the add-on tells AI tools to run `npx -y umbrella-mcp@<add-on version>`. `NpmPackageContractTests` reads `npm/package.json` and checks all three. The Claude Code plugin follows the same version: `ClaudePluginContractTests` checks that `plugins/umbrella/.claude-plugin/plugin.json` `version` equals the add-on's, that `plugins/umbrella/.mcp.json` runs `McpClientConfig.NpxArgs(<add-on version>)` as server `umbraco`, and that the marketplace and plugin names equal `McpClientSnippets.PluginMarketplace` / `PluginName`. At runtime, a server whose version differs from the add-on's (the catalogue's `umbrellaVersion` or the capabilities' `addonVersion`) is flagged by the "MCP client setup" check, the dashboard and a `get-mcp-health` note.
- **No product dependencies:** the add-on must never take a package dependency on any product, because detection is by name only. A concrete detector is only `Id`, `DisplayName`, `AssemblyName`, `ApiName` and an optional `SectionAlias` (the backoffice section the MCP API user needs; the "MCP API user" health check uses it). `McpCapabilitiesService` catches detector exceptions and turns them into issues.

### npm startup (`npm/src/core/server.ts`)

1. `initializeUmbracoFetch` authenticates once.
2. The CMS module loads, and `installClientContext` registers the CMS client as the default.
3. `getUserCurrent()` serves as the credentials check (exit on failure) and supplies the `user` that `collection.tools(user)` needs. `describeStartupError` (`startup-error.ts`) words the exit message by cause: site not reachable, certificate not accepted, token request refused, or the general message with the raw error.
4. The site's Umbraco version is passed to CMS (`setUmbracoVersion`), then the version check runs against major 17.
5. `fetchCapabilities()` returns ok, no-addon or unavailable.
6. `selectModules()` loads a module if it is `required` (CMS), forced via `UMBRACO_MCP_MODULES`, or installed + enabled with a matching major, but never one the site switched off (`off`) or whose section the API user lacks (`noSectionAccess`); both are `get-mcp-health` notes, not issues.
7. **Phase 1** loads the selected modules. A module whose package is missing (`checkPackageInstalled`) or has its own nested toolkit copy (`checkSingleSdk`) is skipped with an issue. A load failure becomes a health issue rather than a crash.
8. Only then is the `McpServer` constructed. Its `instructions` are fixed at construction, so they must contain only the modules that actually loaded.
9. **Phase 2** registers tools per module via `registerModuleTools`.
10. When the add-on answered, `reportCatalogue` posts the catalogue (a failure becomes a `get-mcp-health` note).
11. `get-mcp-health` is registered, then `useDraft202012ToolSchemas(server)`, which must come last.

Invariants:
- **CMS:** it always loads, and a CMS registration failure or a `DuplicateToolNameError` stops startup.
- **Product modules:** they fail in isolation, and every failure must be visible in `get-mcp-health` (`health.ts`).

### Per-call client isolation

The toolkit (`@umbraco-cms/mcp-server-sdk`) keeps **one process-global** API client provider (`configureApiClient`/`getApiClient`). `client-context.ts` installs a provider that reads the current product's client factory from an `AsyncLocalStorage`, and `tool-registrar.ts` wraps every handler in `bindClient(loaded.createApiClient, handler)`.

This only works because product tool handlers call `getApiClient()` lazily inside the call. Rules that follow from it:
- Never call `configureApiClient` elsewhere.
- Never use the toolkit's `clientFactory` proxy path. It would overwrite the provider.
- The concurrency tests in `client-context.test.ts` and `tool-registrar.test.ts` guard this. Keep them going through the real registration path.

### Exactly one toolkit copy

- **Version pin:** `npm/package.json` pins `@umbraco-cms/mcp-server-sdk` to exactly `1.0.0-beta.48`.
- **Overrides:** `"overrides": { "@umbraco-cms/mcp-server-sdk": "$@umbraco-cms/mcp-server-sdk" }` forces every product package onto that version.
- **Verify:** after any install, `npm ls @umbraco-cms/mcp-server-sdk` must show only that version, deduped.
- **Users don't get `overrides`:** npm only applies them in the root project, and under `npx` `umbrella-mcp` is a dependency. For users, single-copy relies on every product package depending on a compatible toolkit version. `scripts/pack-check.sh` installs the packed package that way and fails if a product's tools are missing.
- **If not:** a second copy breaks the shared client provider, and `sdk-instance.ts` skips that module at runtime.

### Product packages

- **CMS:** `@umbraco-cms/mcp-dev` 17.6.13 comes from the registry (`lts-17` tag). `cms.ts` uses `UmbracoManagementClient.getClient()` as its factory. 17.6.12 is the first release whose `./collections` exports `setUmbracoVersion` and `setAllowFilePathUploads`: `cms.ts` calls `setAllowFilePathUploads(true)` on load (Umbrella runs locally, like the package's own stdio entry point) and returns `setUmbracoVersion` as the optional `LoadedModule.setUmbracoVersion`, which `server.ts` calls with the site's version before any tools are listed, so tools gated on Umbraco 17.4/17.6 are offered. 17.6.12 moved to toolkit beta.47, 17.6.13 to beta.48.
- **Forms, Automate and Engage:** `@umbraco-forms/mcp` 17.7.0, `@umbraco-automate/mcp` 17.6.0 and `@umbraco-engage/mcp` 17.5.0 come from the registry (`lts-17` tag). They are the first stable releases, renamed from `@umbraco-<product>/mcp-dev` (whose last v17 releases were Forms 17.6.1-beta.6, Automate 17.4.0-beta.5 and Engage 17.0.0-beta.5), built on toolkit beta.48 and tested against Forms 17.7.0, Automate 17.6.0 and Engage 17.5.0. Their `./collections` exports `createApiClient`, which the `-dev` packages first did in Forms 17.6.1-beta.3, Automate 17.4.0-beta.1 and Engage 17.0.0-beta.3 (toolkit beta.45); earlier v17 releases do not work here. Engage 17.5.0 dropped `get-ab-test-preview-url` and `delete-segments-delete-segment-content`.
- **Node:** the products and the toolkit declare `node: ^22.23.4 || ^24.22.1 || >=26.12.1` (patched for a Brotli CVE) in `engines` but don't check it at runtime, so an older Node only gets an `EBADENGINE` warning on install. `umbrella-mcp` declares the same range.
- **Local-only products:** for a product with no usable published release, `docs/adding-a-product.md` describes the tarball route. `checkPackageInstalled` (`sdk-instance.ts`) turns its missing package in the published server into a `get-mcp-health` issue, and `CI_ABSENT_PACKAGES` (`skipped-modules.ts`) lets the contract test skip it in CI. Nothing uses either today.
- **Types:** the product packages ship no types for `./collections`, so `npm/src/types/product-modules.d.ts` declares them.

### Tool names, filters and routing

- **Tool names:** every tool is registered as `<module.toolPrefix><tool.name>` (`cms--`, `forms--`, `automate--`, `engage--`). `get-mcp-health` is the only unprefixed tool.
- **Descriptions:** every description becomes `[<displayName>] <original>` (`routing.ts` `describeTool`).
- **Output schemas:** tools are registered with `getRegisteredOutputSchema(tool)`, not `tool.outputSchema`. From toolkit beta.48 `UMBRACO_DRY_RUN` turns dry-run on without `getServerConfig`, and a dry-run preview from a mutation tool would fail its `outputSchema`, so the toolkit leaves the schema out for those tools while dry-run is on.
- **Tool mentions:** product descriptions name sibling tools without the prefix ("use list-forms first"), which clients can't find. `prefixToolReferences` rewrites each mention in the description and in top-level input field descriptions to the registered name: the module's own tool first, otherwise the only loaded product that has it. Ambiguous names (`get-server-info`) and nested field descriptions are left as they are.
- **Routing instructions:** `buildRoutingInstructions` turns each loaded module's `description` + `useWhen` into the server instructions. A test in `npm/src/modules/__tests__/contract.test.ts` keeps the full-module-set text under 2,200 characters. The text also carries one fixed rule telling agents to read a tool's input schema before calling it and never to probe with empty arguments. Words that overlap between products (for example "workflow") are disambiguated inside the `useWhen` text, not with extra fields.
- **Filters:** `filter-config.ts` splits the toolkit's filter env vars per module, then feeds each module's slice through the toolkit's `createCollectionConfigLoader` + `shouldIncludeTool`.
  - Unprefixed entries belong to CMS.
  - `forms:<value>` targets a module, and `forms:*` means no restriction for that module.
  - The `*_TOOLS` lists also accept visible names like `forms--list-forms`.
  - Slices and `UMBRACO_READONLY` apply to all modules.
- **Filters run before prefixing:** they match the product's unprefixed tool names.

### Client config (`src/Umbraco.Mcp/Client/`)

- **`McpClientConfig`:** builds the `{ "mcpServers": { "umbraco": … } }` JSON. `McpClientSnippets` uses it.
- **`McpClientSnippets`:** the seven snippets for one client id (Claude Code `.mcp.json`, Claude Code command, Claude Code plugin, Claude Desktop, VS Code with `inputs`, Cursor, Other clients). None contains a secret; a loopback site adds `NODE_TLS_REJECT_UNAUTHORIZED=0` (the plugin commands: `--config tls_reject_unauthorized=0`).
- **Claude Code plugin:** the repository root is a plugin marketplace (`.claude-plugin/marketplace.json`, name `umbrella`) with one plugin, `plugins/umbrella`: `plugin.json` asks for `base_url`, `client_id`, `client_secret` (`sensitive`, so it goes to the system's credential store) and `tls_reject_unauthorized` (default `1`), and `.mcp.json` passes them to `npx -y umbrella-mcp@<version>` through `${user_config.<key>}`. The dashboard's commands add the marketplace from `MarcusK00/Umbrella#v17/main` (`McpClientSnippets.PluginMarketplaceSource`), the released branch. `skills/health` is `/umbrella:health`. Check both with `claude plugin validate .` and `claude plugin validate ./plugins/umbrella`.
- **`McpOverviewService`** (`Overview/`): status, findings, products and API users, shared by the Overview tab (`umbrella-overview.js`: status banner, `umbrella-access-table.js` with a column per product headed with its version, a defaults row and one row per API user, its "…" menu with Info, New secret, Disable/Enable API user and Forget connection, connect steps in `umbrella-client-setup.js`; `umbrella-access.js` holds the level ladder, the level glyph and formatting shared with Tool Permissions) and the three health checks (`McpHealthCheckRows` renders short rows; the pointer to Settings → Umbrella is only in the "MCP client setup" description). Endpoints on `McpOverviewController`, Settings section: `GET /mcp/overview`, `DELETE /mcp/connections/{userKey}`, `GET /mcp/client-setup?clientId=` (`{ clientId, configuredClientId, apiUsers, clients }`: the snippets for that client id, default `Umbraco:Mcp:ClientId`, else `umbraco-back-office-mcp`, and the API users with a client id to pick from; 404 for a client id that is neither the configured one nor an API user's).
- **New connection and API user actions** (dashboard only): `umbrella-new-connection-modal.js` (Details, Access with a Defaults step per product, Review, then the secret once, the AI tool picker and a 5-second `GET overview` poll until connected), `umbrella-api-user-info-modal.js` and `umbrella-new-secret-modal.js` are sidebar modals (tokens in `umbrella-modals.js`, `"type": "modal"` entries in `umbraco-package.json`). Users, client credentials and disable/enable go through Umbraco's own Management API from the browser (`umbrella-users-api.js`, `managementRequest` in `umbrella-management-api.js`), so Umbraco enforces who may create users and grant which groups; the add-on only records the created user. The secret is made in the browser and never sent to `/mcp/*`. The flow's rules are in `umbrella-connection-logic.js` (no backoffice imports, checkable with plain `node`). API users get email and username `<client id>@umbrella.invalid`.
- **Dashboard caching:** `Dashboard/McpDashboardCacheStartupFilter` sends `Cache-Control: no-cache` for `/App_Plugins/Umbrella/*`. The modules are imported without a version in their address, so a browser could otherwise keep an old module next to newer ones after an upgrade; a missing export then leaves the dashboard blank. Don't remove it. It doesn't help a browser that cached a file before the header existed, so the second rule: never remove or rename an export of a released dashboard module, and put a new export a newer module needs in a new file (as `umbrella-management-api.js` does for `managementRequest`, not `umbrella-api.js`). The `dashboard-imports` guard (`scripts/check-dashboard-imports.mjs`) checks this against `origin/v<major>/main`.
- **No files written:** the add-on used to write `.mcp.json` in Development; that was removed, because it pinned one client id (a team sharing it signed in as one API user) and did nothing for hosted sites or editors without the source. Don't add it back.
- **Demo site:** `demo-site/.mcp.json` (gitignored) is written by hand to run the local build (`node ../npm/dist/index.js`); `docs/development.md` has the content.

### Adding a product

Follow `docs/adding-a-product.md`. In short:
- one `npm/src/modules/<id>.ts`
- the product's package in `npm/package.json`: `dependencies` if a published release exports `createApiClient`, otherwise a local tarball in `devDependencies` plus `external` in `tsup.config.ts`
- one entry in `npm/src/modules/index.ts` (keep CMS first, since it is the default module for unprefixed filters)
- one `<Product>Detector : ProductDetectorBase` registered in `McpComposer`

No changes in `npm/src/core/`. The contract test then covers the new module automatically: id/prefix format, `load()` fields, well-formed tools, unique prefixed names and the routing length budget.

## Constraints and conventions

- **Versions:** Umbraco **17 only**: `Umbraco.Cms.Api.Management` `[17.0.0, 18.0.0)` (the NuGet dependency range: minimum 17.0.0, so sites on any 17.x can install it and the add-on must compile against it; below 18, which the Marketplace shows as the supported versions), `net10.0`, central NuGet versions in `Directory.Packages.props`. The demo site has its own `Directory.Packages.props` (Umbraco.Cms 17.7.0, Forms 17.6.1, Automate 17.4.0, Engage 17.5.0, Forms.Automate 17.0.3). Don't upgrade dependency versions unprompted.
- **npm:** ESM (`"type": "module"`, NodeNext, `.js` import suffixes in TS), TypeScript strict, Node `^22.23.4 || ^24.22.1 || >=26.12.1` (`engines`, the products' range).
- **Tests:**
  - .NET tests are NUnit 3 with hand-written fakes (`tests/Umbraco.Mcp.Tests/Fakes.cs`) at the `ILoadedAssemblyProvider` / `IRegisteredApiProvider` seams.
  - npm tests use no HTTP mocking. Network edges are injected as functions (for example `fetchCapabilities(request)`), and pure logic is tested directly.
- **Secrets:**
  - `npm/.env` (real client secret), `appsettings.local.json`, `npm/vendor/*.tgz` (local product tarballs), `demo-site/.mcp.json` and `demo-site/umbraco/` (SQLite data, logs, media) are gitignored.
  - `npm/.env.example` holds placeholders only.
  - On boot Umbraco writes a generated `Imaging:HMACSecretKey` into `demo-site/appsettings.json` unless one is configured. Keep the key in the gitignored `demo-site/appsettings.Local.json` (loaded in Debug builds) so the tracked file stays at `""`. Stage files explicitly rather than with `git add -A`.
- **Docs:** dates use DD-MM-YYYY. User docs (`README.md`, `npm/README.md`, `src/Umbraco.Mcp/README.md`) describe the released packages; keep the version in their config examples equal to the package version.
- **Publishing:** never publish to npm or NuGet unless asked; nothing guards against it any more, since `"private": true` is gone. `.github/workflows/release.yml` publishes both (trusted publishing, no stored keys) when a push to `v17/main` carries a version the registries don't have, so merging a version bump into `v17/main` is a release (`docs/releasing.md`). Keep the `umbraco-marketplace` tag and the `[17.0.0, 18.0.0)` Umbraco range: the Marketplace lists the package and its supported versions from them.
