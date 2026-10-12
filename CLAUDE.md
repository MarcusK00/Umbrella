# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Umbrella: "one MCP server per Umbraco site", a personal project (not under the Umbraco organisation). Two halves are designed and released together, with the same version:

- **`src/Umbraco.Mcp`** (NuGet **`Umbraco.Community.Umbrella`**): an add-on installed in the Umbraco 17 site. It detects which Umbraco HQ products are installed, serves `GET /umbraco/management/api/v1/mcp/capabilities`, adds an "MCP" backoffice health check group, and in Development writes a `.mcp.json` next to the site.
- **`npm/`** (npm **`umbrella-mcp`**): a stdio MCP server that AI tools start with `npx`. It loads the CMS, Forms, Automate and Engage tool collections in one process, but only for the products the site reports, and prefixes every tool `<module-id>--`.

The authoritative design is `docs/superpowers/specs/2026-10-11-umbraco-mcp-umbrella-design.md`. The plan it was built from, including its spec deltas and global constraints, is `docs/superpowers/plans/2026-10-11-umbraco-mcp-umbrella.md`. `README.md` covers configuration and known limitations.

The docs are written as if both packages are released, but nothing is published yet: `npm/package.json` keeps `"private": true` until the first release (`docs/releasing.md`). The source folders, namespaces and solution keep their `Umbraco.Mcp` names; only the package ids changed. Earlier working names were `Umbraco.Mcp` / `@umbraco/mcp`.

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
npm install            # needs the Engage tarball in npm/vendor/ (a devDependency, see below)
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
```

- **Demo admin:** `admin@test.com` / `SecurePass1234` (unattended install, set in `demo-site/appsettings.Development.json`).
- **HTTPS:** the token endpoints reject plain HTTP, so `UMBRACO_BASE_URL` must be https, and local `npm/.env` sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for the self-signed certificate.
- **Automate config:** Automate only boots with `Umbraco:Automate:UseNamedConnectionString=umbracoDbDSN` in the demo site's appsettings.
- **`e2e.sh` greps:** the script uses here-strings (`grep … <<< "$X"`), not `echo | grep -q`. Under `pipefail`, the ~2 MB tool list makes `echo` die with SIGPIPE and the check falsely fails.

## Architecture

### The cross-language contract

- **Ids:** each .NET detector's `Id` (`Detection/Detectors/*Detector.cs`) must equal its npm module's `id` (`npm/src/modules/*.ts`), for example `"forms"`.
- **Capabilities payload:** `{ addonVersion, products: [{ id, displayName, installed, enabled, version, issues, disabledCollections }] }` in camelCase. It is defined by `McpCapabilities` / `McpProductStatus` in C# and by `CapabilitiesPayload` in `npm/src/core/capabilities.ts`. `disabledCollections` is optional on the npm side (`null`/missing → `[]`).
- **Tool settings:** `POST /mcp/catalogue` (API users only) receives `{ umbrellaVersion, modules: [{ id, siteSettingsIgnored, collections: [{ name, toolCount }] }] }` from `catalogue.ts` on every start, including `--list-tools`. `GET/PUT /mcp/tool-settings` (Settings section) back the "Umbrella" dashboard in `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella`. Both are stored in the `umbracoKeyValue` rows `Umbraco.Mcp.ToolSettings` and `Umbraco.Mcp.Catalogue`. Env collection filters for a module override the site list (`buildEffectiveFilterInput`).
- **Detection:** `ProductDetectorBase` treats a product as **installed** when an assembly with the given name is loaded. It treats it as **enabled** when some live controller action carries Umbraco's `[MapToApi("<api-name>")]` with that API name. The check uses MVC action descriptors, not Swagger options.
- **npm package:** `McpClientConfig.NpmPackage` (C#) must equal `name` and the `bin` key in `npm/package.json`, and the csproj `<Version>` must equal the npm `version`, because the add-on tells AI tools to run `npx -y umbrella-mcp@<add-on version>`. `NpmPackageContractTests` reads `npm/package.json` and checks all three.
- **No product dependencies:** the add-on must never take a package dependency on any product, because detection is by name only. A concrete detector is only `Id`, `DisplayName`, `AssemblyName`, `ApiName` and an optional `SectionAlias` (the backoffice section the MCP API user needs; the "MCP API user" health check uses it). `McpCapabilitiesService` catches detector exceptions and turns them into issues.

### npm startup (`npm/src/core/server.ts`)

1. `initializeUmbracoFetch` authenticates once.
2. The CMS module loads, and `installClientContext` registers the CMS client as the default.
3. `getUserCurrent()` serves as the credentials check (exit on failure) and supplies the `user` that `collection.tools(user)` needs.
4. The Umbraco version check runs against major 17.
5. `fetchCapabilities()` returns ok, no-addon or unavailable.
6. `selectModules()` loads a module if it is `required` (CMS), forced via `UMBRACO_MCP_MODULES`, or installed + enabled with a matching major.
7. **Phase 1** loads the selected modules. A module whose package has its own nested toolkit copy is skipped by `checkSingleSdk`. A load failure becomes a health issue rather than a crash.
8. Only then is the `McpServer` constructed. Its `instructions` are fixed at construction, so they must contain only the modules that actually loaded.
9. **Phase 2** registers tools per module via `registerModuleTools`, then `get-mcp-health`, then `useDraft202012ToolSchemas(server)`, which must come last.

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

- **Version pin:** `npm/package.json` pins `@umbraco-cms/mcp-server-sdk` to exactly `1.0.0-beta.45`.
- **Overrides:** `"overrides": { "@umbraco-cms/mcp-server-sdk": "$@umbraco-cms/mcp-server-sdk" }` forces every product package onto that version.
- **Verify:** after any install, `npm ls @umbraco-cms/mcp-server-sdk` must show only that version, deduped.
- **Users don't get `overrides`:** npm only applies them in the root project, and under `npx` `umbrella-mcp` is a dependency. For users, single-copy relies on every product package depending on a compatible toolkit version. `scripts/pack-check.sh` installs the packed package that way and fails if a product's tools are missing.
- **If not:** a second copy breaks the shared client provider, and `sdk-instance.ts` skips that module at runtime.

### Product packages

- **CMS:** `@umbraco-cms/mcp-dev` 17.6.10 comes from the registry. `cms.ts` uses `UmbracoManagementClient.getClient()` as its factory.
- **Forms and Automate:** `@umbraco-forms/mcp-dev` 17.6.1-beta.3 and `@umbraco-automate/mcp-dev` 17.4.0-beta.1 come from the registry (`lts-17-beta` tag). These are the first v17 releases whose `./collections` exports `createApiClient` and that depend on toolkit beta.45; earlier v17 releases do not work here.
- **Engage:** `@umbraco-engage/mcp-dev` is a `file:vendor/*.tgz` tarball in **`devDependencies`** (gitignored, so `npm install` fails without it), because the published `17.0.0-beta.2` lacks the `createApiClient` export.
  - **Not shipped:** it is `external` in `tsup.config.ts`, so local builds load it from `node_modules` while the published package doesn't have it. `checkPackageInstalled` (`sdk-instance.ts`) then turns the missing package into a `get-mcp-health` issue instead of a load failure.
  - **Origin:** it is packed from the local branch `v17/feature/export-create-api-client` in `~/Desktop/Umbraco/MCPS/Engage.MCP.Developer.Repository/Umbraco-Engage-MCP-Dev` (branched from `dev`).
  - **Changes:** that branch adds `export { getUmbracoEngageManagementAPI as createApiClient }` to `src/collections.ts` and bumps the toolkit to beta.45.
  - **Local only:** this change is not pushed. Re-pack with `npm pack --pack-destination <this repo>/npm/vendor`. Once a v17 Engage release with the export is published, move it to `dependencies` from the registry like Forms and Automate, and remove it from `external`.
- **Types:** the tarballs ship no types for `./collections`, so `npm/src/types/product-modules.d.ts` declares them.

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

- **`McpClientConfig`:** builds the `{ "mcpServers": { "umbraco": … } }` JSON. Both the "MCP client setup" health check and the writer use it.
- **`McpJsonWriter`:** a hosted service. In Development, once the server has started, it writes `.mcp.json` into the content root (or `Umbraco:Mcp:McpJson:Path`). Rules:
  - It never overwrites an existing file and never creates folders.
  - It never writes a secret: the file reads `${UMBRELLA_CLIENT_SECRET}`.
  - It uses the first HTTPS server address, since the token endpoint rejects HTTP. If there is none, it writes nothing.
  - It adds `NODE_TLS_REJECT_UNAUTHORIZED=0` only for loopback sites.
  - Failures are logged and never stop the site.
- **Demo site:** `appsettings.Development.json` overrides `Command`/`Args` to `node ../npm/dist/index.js`, so `demo-site/.mcp.json` (gitignored) runs the local build.

### Adding a product

Follow `docs/adding-a-product.md`. In short:
- one `npm/src/modules/<id>.ts`
- the product's package in `npm/package.json`: `dependencies` if a published release exports `createApiClient`, otherwise a local tarball in `devDependencies` plus `external` in `tsup.config.ts`
- one entry in `npm/src/modules/index.ts` (keep CMS first, since it is the default module for unprefixed filters)
- one `<Product>Detector : ProductDetectorBase` registered in `McpComposer`

No changes in `npm/src/core/`. The contract test then covers the new module automatically: id/prefix format, `load()` fields, well-formed tools, unique prefixed names and the routing length budget.

## Constraints and conventions

- **Versions:** Umbraco **17 only**: `Umbraco.Cms.Api.Management` 17.7.0, `net10.0`, central NuGet versions in `Directory.Packages.props`. The demo site has its own `Directory.Packages.props` (Umbraco.Cms 17.7.0, Forms 17.6.1, Automate 17.4.0, Engage 17.5.0, Forms.Automate 17.0.3). Don't upgrade dependency versions unprompted.
- **npm:** ESM (`"type": "module"`, NodeNext, `.js` import suffixes in TS), TypeScript strict, Node ≥ 22.
- **Tests:**
  - .NET tests are NUnit 3 with hand-written fakes (`tests/Umbraco.Mcp.Tests/Fakes.cs`) at the `ILoadedAssemblyProvider` / `IRegisteredApiProvider` seams.
  - npm tests use no HTTP mocking. Network edges are injected as functions (for example `fetchCapabilities(request)`), and pure logic is tested directly.
- **Secrets:**
  - `npm/.env` (real client secret), `appsettings.local.json`, `npm/vendor/*.tgz`, `demo-site/.mcp.json` and `demo-site/umbraco/` (SQLite data, logs, media) are gitignored.
  - `npm/.env.example` holds placeholders only.
  - On boot the demo site may write a generated `Imaging:HMACSecretKey` into `demo-site/appsettings.json`. Don't commit it: the committed value is `""`. Stage files explicitly rather than with `git add -A`.
- **Docs:** dates use DD-MM-YYYY. User docs (`README.md`, `npm/README.md`, `src/Umbraco.Mcp/README.md`) describe the released packages; keep the version in their config examples equal to the package version.
- **Publishing:** never publish to npm or NuGet unless asked. Keep `"private": true` in `npm/package.json` until then.
