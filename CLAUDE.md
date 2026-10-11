# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A proof of concept for "one MCP server per Umbraco site". Two halves are designed and versioned together:

- **`src/Umbraco.Mcp`**: a NuGet add-on installed in the Umbraco 17 site. It detects which Umbraco HQ products are installed, serves `GET /umbraco/management/api/v1/mcp/capabilities`, and adds an "MCP" backoffice health check group.
- **`npm/` (`@umbraco/mcp`)**: a stdio MCP server. It loads the CMS, Forms and Automate tool collections in one process, but only for the products the site reports, and prefixes every tool `<module-id>--`.

The authoritative design is `docs/superpowers/specs/2026-10-11-umbraco-mcp-umbrella-design.md`. The plan it was built from, including its spec deltas and global constraints, is `docs/superpowers/plans/2026-10-11-umbraco-mcp-umbrella.md`. `README.md` covers configuration and known limitations.

`@umbraco/mcp` and `Umbraco.Mcp` are working names. Nothing is published to npm or NuGet.

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
npm install            # needs the Forms/Automate tarballs in npm/vendor/ (see below)
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
```

- **Demo admin:** `admin@test.com` / `SecurePass1234` (unattended install, set in `demo-site/appsettings.Development.json`).
- **HTTPS:** the token endpoints reject plain HTTP, so `UMBRACO_BASE_URL` must be https, and local `npm/.env` sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for the self-signed certificate.
- **Automate config:** Automate only boots with `Umbraco:Automate:UseNamedConnectionString=umbracoDbDSN` in the demo site's appsettings.
- **`e2e.sh` greps:** the script uses here-strings (`grep … <<< "$X"`), not `echo | grep -q`. Under `pipefail`, the ~2 MB tool list makes `echo` die with SIGPIPE and the check falsely fails.

## Architecture

### The cross-language contract

- **Ids:** each .NET detector's `Id` (`Detection/Detectors/*Detector.cs`) must equal its npm module's `id` (`npm/src/modules/*.ts`), for example `"forms"`.
- **Capabilities payload:** `{ addonVersion, products: [{ id, displayName, installed, enabled, version, issues }] }` in camelCase. It is defined by `McpCapabilities` / `McpProductStatus` in C# and by `CapabilitiesPayload` in `npm/src/core/capabilities.ts`.
- **Detection:** `ProductDetectorBase` treats a product as **installed** when an assembly with the given name is loaded. It treats it as **enabled** when some live controller action carries Umbraco's `[MapToApi("<api-name>")]` with that API name. The check uses MVC action descriptors, not Swagger options.
- **No product dependencies:** the add-on must never take a package dependency on any product, because detection is by name only. A concrete detector is only `Id`, `DisplayName`, `AssemblyName` and `ApiName`. `McpCapabilitiesService` catches detector exceptions and turns them into issues.

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
- **If not:** a second copy breaks the shared client provider, and `sdk-instance.ts` skips that module at runtime.

### Product packages

- **CMS:** `@umbraco-cms/mcp-dev` 17.6.10 comes from the registry. `cms.ts` uses `UmbracoManagementClient.getClient()` as its factory.
- **Forms and Automate:** `@umbraco-forms/mcp-dev` and `@umbraco-automate/mcp-dev` are `file:vendor/*.tgz` tarballs (gitignored, so `npm install` fails without them).
  - **Origin:** they are packed from local branches `v17/feature/export-create-api-client` in `~/Desktop/Umbraco/Forms.MCP.Developer.Repository/Umbraco-Forms-MCP-Dev` and `~/Desktop/Umbraco/Automate.MCP.Dev.Repository/Umbraco-Automate-MCP-Dev`.
  - **Changes:** those branches add `export { getUmbraco…ManagementAPI as createApiClient }` to `src/collections.ts` and bump the toolkit to beta.45.
  - **Local only:** these changes are never pushed and never opened as PRs. Re-pack with `npm pack --pack-destination <this repo>/npm/vendor`.
- **Types:** the tarballs ship no types for `./collections`, so `npm/src/types/product-modules.d.ts` declares them.

### Tool names, filters and routing

- **Tool names:** every tool is registered as `<module.toolPrefix><tool.name>` (`cms--`, `forms--`, `automate--`). `get-mcp-health` is the only unprefixed tool.
- **Descriptions:** every description becomes `[<displayName>] <original>` (`routing.ts` `describeTool`).
- **Routing instructions:** `buildRoutingInstructions` turns each loaded module's `description` + `useWhen` into the server instructions. A test in `npm/src/modules/__tests__/contract.test.ts` keeps the full-module-set text under 2,000 characters. Words that overlap between products (for example "workflow") are disambiguated inside the `useWhen` text, not with extra fields.
- **Filters:** `filter-config.ts` splits the toolkit's filter env vars per module, then feeds each module's slice through the toolkit's `createCollectionConfigLoader` + `shouldIncludeTool`.
  - Unprefixed entries belong to CMS.
  - `forms:<value>` targets a module, and `forms:*` means no restriction for that module.
  - The `*_TOOLS` lists also accept visible names like `forms--list-forms`.
  - Slices and `UMBRACO_READONLY` apply to all modules.
- **Filters run before prefixing:** they match the product's unprefixed tool names.

### Adding a product

Follow `docs/adding-a-product.md`. In short:
- one `npm/src/modules/<id>.ts`
- one entry in `npm/src/modules/index.ts` (keep CMS first, since it is the default module for unprefixed filters)
- the dependency in `npm/package.json`
- one `<Product>Detector : ProductDetectorBase` registered in `McpComposer`

No changes in `npm/src/core/`. The contract test then covers the new module automatically: id/prefix format, `load()` fields, well-formed tools, unique prefixed names and the routing length budget.

## Constraints and conventions

- **Versions:** Umbraco **17 only**: `Umbraco.Cms.Api.Management` 17.7.0, `net10.0`, central NuGet versions in `Directory.Packages.props`. The demo site has its own `Directory.Packages.props` (Umbraco.Cms 17.7.0, Forms 17.6.1, Automate 17.4.0). Don't upgrade dependency versions unprompted.
- **npm:** ESM (`"type": "module"`, NodeNext, `.js` import suffixes in TS), TypeScript strict, Node ≥ 22.
- **Tests:**
  - .NET tests are NUnit 3 with hand-written fakes (`tests/Umbraco.Mcp.Tests/Fakes.cs`) at the `ILoadedAssemblyProvider` / `IRegisteredApiProvider` seams.
  - npm tests use no HTTP mocking. Network edges are injected as functions (for example `fetchCapabilities(request)`), and pure logic is tested directly.
- **Secrets:**
  - `npm/.env` (real client secret), `appsettings.local.json`, `npm/vendor/*.tgz` and `demo-site/umbraco/` (SQLite data, logs, media) are gitignored.
  - `npm/.env.example` holds placeholders only.
  - On boot the demo site may write a generated `Imaging:HMACSecretKey` into `demo-site/appsettings.json`. Don't commit it: the committed value is `""`. Stage files explicitly rather than with `git add -A`.
- **Docs:** dates use DD-MM-YYYY.
