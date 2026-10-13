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

The docs are written as if both packages are released. Releases are pre-release test versions for now: `"private": true` is gone from `npm/package.json`, and the NuGet package has no `umbraco-marketplace` tag until a Marketplace release (`docs/releasing.md`). The source folders, namespaces and solution keep their `Umbraco.Mcp` names; only the package ids changed. Earlier working names were `Umbraco.Mcp` / `@umbraco/mcp`.

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
- **Capabilities payload:** `{ addonVersion, products: [{ id, displayName, installed, enabled, version, issues, disabledCollections, readOnly, noDestructive, off, settingsScope }] }` in camelCase. It is defined by `McpCapabilities` / `McpProductStatus` in C# and by `CapabilitiesPayload` in `npm/src/core/capabilities.ts`. `disabledCollections` is `null` when the site has no saved list for the product; on the npm side `null`/missing means "no saved list", so the module's `defaultDisabledCollections` apply. `readOnly`, `noDestructive` and `off` missing or null → `false`. `off` means npm does not load the product (`selectModules`, after `required` and before `UMBRACO_MCP_MODULES` forcing); the other settings are still sent as stored. `settingsScope` is `"site"` or `"user"` (the settings in the payload are the defaults or the calling API user's override for that product); missing, null or any other value → `"site"` (`siteSettingsScope()`).
- **Tool settings:** `POST /mcp/catalogue` (API users only) receives `{ umbrellaVersion, modules: [{ id, siteSettingsIgnored, collections: [{ name, toolCount, readOnlyToolCount, nonDestructiveToolCount, disabledByDefault? }] }] }` from `catalogue.ts` on every start, including `--list-tools` (`readOnlyToolCount` and `nonDestructiveToolCount` are null and `disabledByDefault` missing in older reports; the dashboard unticks `disabledByDefault` groups for a product without a saved list). `GET/PUT /mcp/tool-settings` (Settings section) carry `disabledCollections`, `readOnlyModules`, `noDestructiveModules` and `offModules` (a product in more than one level list → 400; `cms` in `offModules` → 400, `McpProducts.RequiredId` must equal the npm module with `required: true`) and back the "Umbrella" dashboard in `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella` (Tool Permissions: `umbrella-tool-groups.js` page with the side list, saved-state snapshot and `confirmLeave()`; `umbrella-product-card.js` per product with the access ladder Off · Read-only · No deletes · Full; `umbrella-unsaved-guard.js` cancels the router's `willchangestate` and `beforeunload` while there are unsaved changes). They are stored in the `umbracoKeyValue` rows `Umbraco.Mcp.ToolSettings`, `Umbraco.Mcp.ReadOnlyModules`, `Umbraco.Mcp.NoDestructiveModules`, `Umbraco.Mcp.OffModules` and `Umbraco.Mcp.Catalogue`: the defaults for all API users, and the most recent report from any user, merged per module. Collection exclusions come from the env (any collection filter for the module), else the site's saved list (`[]` included), else the module's `defaultDisabledCollections` (no module sets it, so every group is on by default; the contract test checks that), but the site's read-only always applies, ORed with `UMBRACO_READONLY` (`buildEffectiveFilterInput`). The no-destructive level works the same way, ORed with `UMBRACO_NO_DESTRUCTIVE`, surviving env collection filters; it removes tools where `isDestructive(tool)` (`npm/src/core/destructive.ts`, `annotations.destructiveHint === true`) holds, and the stored levels are exclusive (off, then read-only first). The contract test `destructive-tools.snapshot.json` fails when a product changes which tools it flags; review the diff and regenerate it.
- **Per-API-user settings:** the defaults above can be overridden per product for one API user: `Umbraco.Mcp.UserToolSettings.<userKey>` holds `{ "<productId>": { disabledCollections, level } }` (`level` is `full`, `noDestructive`, `readOnly` or `off`; present = overridden all-or-nothing, absent = defaults). `GET /mcp/capabilities` resolves the settings for the calling API user (`McpCapabilitiesService.GetCapabilities(Guid? apiUserKey)`) and sets `settingsScope` per product; non-API callers get the defaults, so npm needs no change. `POST /mcp/catalogue` stores the report per caller in `Umbraco.Mcp.UserCatalogue.<userKey>` (replaced on each start) and still merges into the shared `Umbraco.Mcp.Catalogue` row, which is the fallback for a user without a report. `IKeyValueService` has no delete, so removing a row writes `""`, and readers skip blank rows and rows of users that are not API users any more. `GET /mcp/tool-settings` adds `apiUsers` (every API user, via `IMcpApiUserDirectory`), and its `catalogue` is the highest counts per group any existing API user reported (`McpCatalogueFallback.Highest`; the shared row before any user has its own report, and for modules no user reported). `GET /mcp/tool-settings/users/{userKey}` (Settings section) returns that user's `overrides` with the `catalogue` to show and its `catalogueSource` (`user`, `latest` or `none`); `PUT` replaces the overrides (empty map = follow the defaults) and returns only the saved `overrides`; both 404 for an unknown or non-API user, checked before validation. `GET /mcp/overview` API user rows carry `serverVersion`, `lastReportedAt`, `access` (per product: level, scope and `toolCount` after the user's settings, `McpToolCounts.Effective`, 0 when off; an off product raises no missing-section finding) and their summed `toolCount`, and the version-mismatch finding is one per connected user (the shared-row finding when no connected user has its own report). `DELETE /mcp/connections/{userKey}` also clears that user's catalogue and keeps its overrides. `get-mcp-health` notes say "for this API user" for `settingsScope: "user"`.
- **Detection:** `ProductDetectorBase` treats a product as **installed** when an assembly with the given name is loaded. It treats it as **enabled** when some live controller action carries Umbraco's `[MapToApi("<api-name>")]` with that API name. The check uses MVC action descriptors, not Swagger options.
- **npm package:** `McpClientConfig.NpmPackage` (C#) must equal `name` and the `bin` key in `npm/package.json`, and the csproj `<Version>` must equal the npm `version`, because the add-on tells AI tools to run `npx -y umbrella-mcp@<add-on version>`. `NpmPackageContractTests` reads `npm/package.json` and checks all three. At runtime, a server whose version differs from the add-on's (the catalogue's `umbrellaVersion` or the capabilities' `addonVersion`) is flagged by the "MCP client setup" check, the dashboard and a `get-mcp-health` note.
- **No product dependencies:** the add-on must never take a package dependency on any product, because detection is by name only. A concrete detector is only `Id`, `DisplayName`, `AssemblyName`, `ApiName` and an optional `SectionAlias` (the backoffice section the MCP API user needs; the "MCP API user" health check uses it). `McpCapabilitiesService` catches detector exceptions and turns them into issues.

### npm startup (`npm/src/core/server.ts`)

1. `initializeUmbracoFetch` authenticates once.
2. The CMS module loads, and `installClientContext` registers the CMS client as the default.
3. `getUserCurrent()` serves as the credentials check (exit on failure) and supplies the `user` that `collection.tools(user)` needs.
4. The Umbraco version check runs against major 17.
5. `fetchCapabilities()` returns ok, no-addon or unavailable.
6. `selectModules()` loads a module if it is `required` (CMS), forced via `UMBRACO_MCP_MODULES`, or installed + enabled with a matching major, but never one the site switched off (`off`; a `get-mcp-health` note, not an issue).
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

- **Version pin:** `npm/package.json` pins `@umbraco-cms/mcp-server-sdk` to exactly `1.0.0-beta.46`.
- **Overrides:** `"overrides": { "@umbraco-cms/mcp-server-sdk": "$@umbraco-cms/mcp-server-sdk" }` forces every product package onto that version.
- **Verify:** after any install, `npm ls @umbraco-cms/mcp-server-sdk` must show only that version, deduped.
- **Users don't get `overrides`:** npm only applies them in the root project, and under `npx` `umbrella-mcp` is a dependency. For users, single-copy relies on every product package depending on a compatible toolkit version. `scripts/pack-check.sh` installs the packed package that way and fails if a product's tools are missing.
- **If not:** a second copy breaks the shared client provider, and `sdk-instance.ts` skips that module at runtime.

### Product packages

- **CMS:** `@umbraco-cms/mcp-dev` 17.6.10 comes from the registry. `cms.ts` uses `UmbracoManagementClient.getClient()` as its factory.
- **Forms and Automate:** `@umbraco-forms/mcp-dev` 17.6.1-beta.5 and `@umbraco-automate/mcp-dev` 17.4.0-beta.4 come from the registry (`lts-17-beta` tag). Forms 17.6.1-beta.3 and Automate 17.4.0-beta.1 were the first v17 releases whose `./collections` exports `createApiClient` and that depend on toolkit beta.45; earlier v17 releases do not work here. Forms beta.4 adds refusing duplicate explicit field aliases, Automate beta.2 refusing settings keys a step or trigger type doesn't declare. Forms beta.5 and Automate beta.3 move to toolkit beta.46. Automate beta.4 connects an automation's first step to its trigger in `add-automation-step`, as the backoffice canvas does.
- **Engage:** `@umbraco-engage/mcp-dev` 17.0.0-beta.4 comes from the registry (`beta` tag). 17.0.0-beta.3 was the first v17 release whose `./collections` exports `createApiClient` and that depends on toolkit beta.45; until then Umbrella used a locally packed tarball in `devDependencies`, kept `external` in `tsup.config.ts` and dropped in CI. Engage beta.4 moves to toolkit beta.46.
- **Local-only products:** for a product with no usable published release, `docs/adding-a-product.md` describes the tarball route. `checkPackageInstalled` (`sdk-instance.ts`) turns its missing package in the published server into a `get-mcp-health` issue, and `CI_ABSENT_PACKAGES` (`skipped-modules.ts`) lets the contract test skip it in CI. Nothing uses either today.
- **Types:** the product packages ship no types for `./collections`, so `npm/src/types/product-modules.d.ts` declares them.

### Tool names, filters and routing

- **Tool names:** every tool is registered as `<module.toolPrefix><tool.name>` (`cms--`, `forms--`, `automate--`, `engage--`). `get-mcp-health` is the only unprefixed tool.
- **Descriptions:** every description becomes `[<displayName>] <original>` (`routing.ts` `describeTool`).
- **Tool mentions:** product descriptions name sibling tools without the prefix ("use list-forms first"), which clients can't find. `prefixToolReferences` rewrites each mention in the description and in top-level input field descriptions to the registered name: the module's own tool first, otherwise the only loaded product that has it. Ambiguous names (`get-server-info`) and nested field descriptions are left as they are.
- **Routing instructions:** `buildRoutingInstructions` turns each loaded module's `description` + `useWhen` into the server instructions. A test in `npm/src/modules/__tests__/contract.test.ts` keeps the full-module-set text under 2,000 characters. Words that overlap between products (for example "workflow") are disambiguated inside the `useWhen` text, not with extra fields.
- **Filters:** `filter-config.ts` splits the toolkit's filter env vars per module, then feeds each module's slice through the toolkit's `createCollectionConfigLoader` + `shouldIncludeTool`.
  - Unprefixed entries belong to CMS.
  - `forms:<value>` targets a module, and `forms:*` means no restriction for that module.
  - The `*_TOOLS` lists also accept visible names like `forms--list-forms`.
  - Slices and `UMBRACO_READONLY` apply to all modules.
- **Filters run before prefixing:** they match the product's unprefixed tool names.

### Client config (`src/Umbraco.Mcp/Client/`)

- **`McpClientConfig`:** builds the `{ "mcpServers": { "umbraco": … } }` JSON. `McpClientSnippets` uses it.
- **`McpClientSnippets`:** the six snippets for one client id (Claude Code `.mcp.json`, Claude Code command, Claude Desktop, VS Code with `inputs`, Cursor, Other clients). None contains a secret; a loopback site adds `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- **`McpOverviewService`** (`Overview/`): status, findings, products and connected API users, shared by the Overview tab (`umbrella-overview.js`: status line, one `umbrella-user-card.js` per API user, connect steps) and the three health checks (`McpHealthCheckRows` renders short rows; the pointer to Settings → Umbrella is only in the "MCP client setup" description). Endpoints on `McpOverviewController`, Settings section: `GET /mcp/overview`, `DELETE /mcp/connections/{userKey}`, `GET /mcp/client-setup?clientId=` (`{ clientId, configuredClientId, apiUsers, clients }`: the snippets for that client id, default `Umbraco:Mcp:ClientId`, else `umbraco-back-office-mcp`, and the API users with a client id to pick from; 404 for a client id that is neither the configured one nor an API user's).
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

- **Versions:** Umbraco **17 only**: `Umbraco.Cms.Api.Management` 17.0.0 (the package's minimum Umbraco, so sites on any 17.x can install it; the add-on must compile against it), `net10.0`, central NuGet versions in `Directory.Packages.props`. The demo site has its own `Directory.Packages.props` (Umbraco.Cms 17.7.0, Forms 17.6.1, Automate 17.4.0, Engage 17.5.0, Forms.Automate 17.0.3). Don't upgrade dependency versions unprompted.
- **npm:** ESM (`"type": "module"`, NodeNext, `.js` import suffixes in TS), TypeScript strict, Node ≥ 22.
- **Tests:**
  - .NET tests are NUnit 3 with hand-written fakes (`tests/Umbraco.Mcp.Tests/Fakes.cs`) at the `ILoadedAssemblyProvider` / `IRegisteredApiProvider` seams.
  - npm tests use no HTTP mocking. Network edges are injected as functions (for example `fetchCapabilities(request)`), and pure logic is tested directly.
- **Secrets:**
  - `npm/.env` (real client secret), `appsettings.local.json`, `npm/vendor/*.tgz` (local product tarballs), `demo-site/.mcp.json` and `demo-site/umbraco/` (SQLite data, logs, media) are gitignored.
  - `npm/.env.example` holds placeholders only.
  - On boot the demo site may write a generated `Imaging:HMACSecretKey` into `demo-site/appsettings.json`. Don't commit it: the committed value is `""`. Stage files explicitly rather than with `git add -A`.
- **Docs:** dates use DD-MM-YYYY. User docs (`README.md`, `npm/README.md`, `src/Umbraco.Mcp/README.md`) describe the released packages; keep the version in their config examples equal to the package version.
- **Publishing:** never publish to npm or NuGet unless asked; nothing guards against it any more, since `"private": true` is gone. Don't add the `umbraco-marketplace` tag back unless asked.
