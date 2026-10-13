# Architecture

How Umbrella works inside. For setup and configuration, see the [README](../README.md). The original design and its reasoning are in [`docs/superpowers/specs/`](superpowers/specs/); this page describes the code as it is now. For the same in diagrams, open [`architecture-map.html`](architecture-map.html) in a browser.

## Two halves, one version

| | Add-on | Server |
|---|---|---|
| Package | NuGet `Umbraco.Community.Umbrella` | npm `umbrella-mcp` |
| Source | `src/Umbraco.Mcp/` (C#, `net10.0`) | `npm/` (TypeScript, ESM, Node 22+) |
| Runs | inside the Umbraco site | on the developer's machine, started by the AI tool over stdio |
| Job | detect products, store tool settings, health checks, write `.mcp.json` | load product tool collections into one MCP server |

The add-on tells AI tools to run `npx -y umbrella-mcp@<add-on version>`, so both packages always ship with the same version. The source folders and namespaces keep their working name `Umbraco.Mcp`; only the package ids are "Umbrella".

```
src/Umbraco.Mcp/
  Detection/        product detectors (one per product) and the seams they use
  Capabilities/     builds the capabilities payload
  Api/              Management API controllers (capabilities, tool settings, catalogue, overview)
  Overview/         McpOverviewService: status, findings and snippets for the dashboard and the health checks
  ToolSettings/     dashboard settings (defaults and per-API-user overrides) and the reported catalogues, in umbracoKeyValue
  Connections/      which API users the MCP server connected as
  ApiUser/          resolves those users for the health check, and lists every API user for the dashboard
  HealthChecks/     the three checks in the "MCP" group (short rows over the overview's findings)
  Client/           MCP client config, per-client snippets and the .mcp.json file logic
  wwwroot/App_Plugins/Umbrella/   the "Umbrella" backoffice dashboard (plain JS, no build step)
npm/src/
  core/             server startup, selection, filters, registration, routing, health
  modules/          one file per product: cms.ts, forms.ts, automate.ts, engage.ts
tests/Umbraco.Mcp.Tests/   NUnit tests for the add-on
demo-site/          Umbraco 17 with Forms, Automate and Engage, referencing the add-on project
scripts/            API user setup, end-to-end check, pack check
```

## The add-on

### Product detection

Each product has a detector in `Detection/Detectors/`. Apart from CMS (always installed, version from `IUmbracoVersion`), every detector derives from `ProductDetectorBase` and only declares values:

| Member | Example (Forms) | Used for |
|---|---|---|
| `Id` | `forms` | Must equal the npm module's `id` |
| `DisplayName` | `Umbraco Forms` | Health checks and the dashboard |
| `AssemblyName` | `Umbraco.Forms.Core` | **Installed** = an assembly with this name is loaded |
| `ApiName` | `forms-management` | **Enabled** = a live controller carries `[MapToApi("forms-management")]` |
| `SectionAlias` | `Umb.Section.Forms` | The section the API user needs ("MCP API user" check); optional |

Detection goes through two seams, `ILoadedAssemblyProvider` (the AppDomain) and `IRegisteredApiProvider` (MVC action descriptors, not Swagger options), so tests can fake both. The version comes from the assembly's informational version, without the `+commit` suffix.

The add-on takes **no package dependency** on any product: detection is by name only. `McpCapabilitiesService` catches detector exceptions and turns them into a product issue, so one broken detector never breaks the endpoint. Detectors are registered in `McpComposer`; their order there is the order products appear everywhere else.

### Endpoints

All under `/umbraco/management/api/v1/mcp/`, in the Management API's "MCP" Swagger group.

| Endpoint | Who may call it | What it does |
|---|---|---|
| `GET capabilities` | any backoffice user | Returns `{ addonVersion, products: [{ id, displayName, installed, enabled, version, issues, disabledCollections, readOnly, noDestructive, settingsScope }] }`. `disabledCollections` is `null` for a product without a saved list. For an API caller the settings are resolved per product: that user's override if it has one (`settingsScope: "user"`), else the defaults (`"site"`). Non-API callers get the defaults. When the caller is an API user, records the connection for the "MCP API user" check |
| `POST catalogue` | API users only (403 otherwise) | The server reports every tool group it loaded: `{ umbrellaVersion, modules: [{ id, siteSettingsIgnored, collections: [{ name, toolCount, readOnlyToolCount, nonDestructiveToolCount, disabledByDefault? }] }] }`. Stored per caller (replacing that user's previous report) and merged per module into the shared catalogue |
| `GET overview` | Settings section | What the Overview tab and the health checks show (`McpOverviewService`): findings, products, connected API users, the `.mcp.json` status and the client snippets. Each API user row has its server version, last start and access per product (full access, no destructive tools or read-only, with `scope` `site` or `user`, and `toolCount`: the tools its last start got with those settings, `McpToolCounts.Effective`; 0 for a product it did not load, null without a report or when its environment sets its own collection filters), plus their sum. The dashboard shows only the warnings, and the API users as "MCP Users" |
| `DELETE connections/{userKey}` | Settings section | Forgets an API user's stored connection and its stored catalogue (404 if unknown); its tool overrides are kept. The connection returns the next time the server signs in |
| `POST mcp-json` | Settings section | Writes or upgrades `.mcp.json` through `McpJsonFile`; returns `{ outcome, path, message }`. 404 when the site is not in Development or writing is off, 500 on an I/O failure |
| `GET tool-settings` | Settings section | What the dashboard shows: the add-on version, products, the catalogue for the defaults view (per group the highest counts any existing API user reported, `McpCatalogueFallback.Highest`; the shared catalogue before any user has its own report), and the defaults for all API users (disabled groups, read-only products, no-destructive products), plus `apiUsers: [{ key, name, clientIds, state, lastReportedAt, overriddenProducts }]` for every API user (`IMcpApiUserDirectory`) |
| `PUT tool-settings` | Settings section | Replaces the defaults: `disabledCollections` (module id → group names), `readOnlyModules` and `noDestructiveModules`. Unknown product ids are refused, and a product in both level lists is a 400 (nothing stored) |
| `GET tool-settings/users/{userKey}` | Settings section | One API user's `overrides`, its `catalogue` and `catalogueSource` (`{ kind: "user" or "latest" or "none", reportedAt, userName }`). Without a report of its own, the catalogue is the most recent other user's, else the shared one; the dashboard then shows the groups without counts. 404 for an unknown or non-API user |
| `PUT tool-settings/users/{userKey}` | Settings section | Replaces that user's overrides, `{ overrides: { <productId>: { disabledCollections, level } } }` with `level` `full`, `noDestructive` or `readOnly`. An empty map makes the user follow the defaults. 404 for an unknown or non-API user (checked first); 400 (nothing stored) for an unknown product id, a missing or invalid level, or names failing the rules below |

The store has no delete (`IKeyValueService` has none), so removing a row blanks it, and every reader skips blank or invalid values. Rows of users that no longer exist or are no longer API users are ignored everywhere: not listed, never the fallback catalogue, not counted.

Input is trimmed, de-duplicated and capped (`McpToolSettingsValidation`: 50 modules, 200 groups per module, 100 characters per name), so a stray client cannot bloat the database.

### Storage

Everything is kept in Umbraco's `umbracoKeyValue` table, so it survives restarts and is shared by every server of a load-balanced site:

| Key | Content |
|---|---|
| `Umbraco.Mcp.ToolSettings` | Default disabled tool groups per module, for all API users |
| `Umbraco.Mcp.ReadOnlyModules` | Default products limited to read-only tools |
| `Umbraco.Mcp.NoDestructiveModules` | Default products whose destructive tools are left out |
| `Umbraco.Mcp.UserToolSettings.<user key>` | One API user's overrides, `{ "<productId>": { disabledCollections, level } }`. A product present is overridden in full; absent means it follows the defaults |
| `Umbraco.Mcp.Catalogue` | The most recent report from any user, merged per module, with when it was reported. The fallback for a user without a report |
| `Umbraco.Mcp.UserCatalogue.<user key>` | That API user's last report, replaced on each start |
| `Umbraco.Mcp.Connection.<user key>` | When that API user last fetched capabilities |

### Settings per API user

A team can give each developer an API user, and the settings can differ per user without any change in the server:

- **Defaults and overrides.** The three default rows apply to every API user. An override is per product and all-or-nothing: it holds that product's groups and level, so a product the user does not override keeps following the defaults, including later changes to them.
- **Resolved per caller.** `McpCapabilitiesService.GetCapabilities(apiUserKey)` takes the key of the API user that called `GET capabilities`, and fills `disabledCollections`, `readOnly` and `noDestructive` for each product from that user's override (the level maps to the two booleans), with `settingsScope` `"user"`, or from the defaults with `"site"`. An override for a product the site no longer detects is ignored. A failing read of the overrides is logged and the caller gets the defaults.
- **Catalogue per caller.** The report of every start is kept per user, so the dashboard's counts and the version warning no longer depend on who started last. Tool Permissions shows a user's counts only from its own report; the defaults show the highest counts any API user reported. The shared row stays for sites where no user has reported yet.
- **Overview.** The version-mismatch finding is one per connected user that has its own report, and the shared-row finding applies only when none has.
- **Dashboard.** Tool Permissions has a picker ("All API users (defaults)" first, then each API user). For a user, each product has a "Use defaults" switch; switched off, that product's groups and level are that user's override.

### Client config and `.mcp.json`

`McpClientConfig` builds the `{ "mcpServers": { "umbraco": … } }` JSON. `McpClientSnippets` and `McpJsonFile.BuildJson` use it. `McpClientSnippets` builds the five snippets on the Overview tab (Claude Code `.mcp.json`, the `claude mcp add` command, VS Code with `inputs`, Cursor with `${env:...}`, other clients). None contains a secret.

`McpOverviewService` (`Overview/`) gathers the status, findings, products, API users and snippets once. The three health checks render the same findings through `McpHealthCheckRows` as short rows, and the dashboard renders them in full. The pointer to Settings → Umbrella (`McpHealthCheckRows.DashboardPointer`) is only in the "MCP client setup" description, so it shows once when the group runs.

`McpJsonFile` holds the `.mcp.json` rules. `McpJsonWriter` is a hosted service that calls it at startup, and `POST mcp-json` calls it on request. In Development, once the server has started (only then are its addresses known), it writes `.mcp.json` to the content root or `Umbraco:Mcp:McpJson:Path`. It:

- uses the first HTTPS address, with wildcard hosts (`*`, `+`, `0.0.0.0`, `[::]`) turned into `localhost`, and writes nothing if there is none;
- writes `${UMBRELLA_CLIENT_SECRET}` instead of a secret;
- adds `NODE_TLS_REJECT_UNAUTHORIZED=0` only when the address is loopback;
- never overwrites a file someone edited (a new file is opened with `FileMode.CreateNew`) and never creates folders;
- upgrades a file it wrote itself (`TryUpgrade`): when the file equals what it would write for the `umbrella-mcp@<version>` it pins, and the add-on's version is newer by `Umbraco.Cms.Core.Semver`, it rewrites the file for the add-on's version. A changed port or client id, an `Args` override or any edit leaves the file alone, and an older add-on never downgrades it;
- logs failures and never stops the site.

## The server

### Startup

`npm/src/core/server.ts`, in this order:

1. **Sign in.** `initializeUmbracoFetch` with the three `UMBRACO_*` variables (missing → exit).
2. **Load CMS** and install the client context with the CMS client as the default.
3. **Credentials check.** `getUserCurrent()` fails fast on bad credentials (exit), and its result is the `user` that `collection.tools(user)` needs.
4. **Version check** against Umbraco major 17 (the toolkit's `checkUmbracoVersion`). A mismatch does not stop startup: its message goes into the server instructions and `get-mcp-health`.
5. **Capabilities.** `fetchCapabilities()` returns `ok`, `no-addon` (HTTP 404) or `unavailable`.
6. **Select modules** (below).
7. **Phase 1: load** each selected product module. A product package that isn't installed, or that has its own nested toolkit copy, is skipped with an issue. A load failure becomes an issue, never a crash.
8. **Create the `McpServer`.** Its `instructions` are fixed at construction, so they can only be built once phase 1 knows which modules loaded.
9. **Phase 2: register** each module's tools through its filters (below).
10. **Report the catalogue** to the site (only when the add-on answered). A failure becomes a note in `get-mcp-health`.
11. Register `get-mcp-health`, then `useDraft202012ToolSchemas(server)`, which must run after every `registerTool`.

With `--list-tools`, the process prints the sorted tool names after startup and exits instead of connecting to stdio. It still reports the catalogue.

Failure rules: CMS always loads, and a CMS registration failure or a duplicate tool name stops startup. Product modules fail in isolation, and every failure shows in `get-mcp-health`.

### Module selection

`selectModules()` decides per module, first match wins:

1. `required` (CMS) → load.
2. Listed in `UMBRACO_MCP_MODULES` → load.
3. No add-on, or capabilities unavailable → skip.
4. Not installed, not enabled, unknown version, or a major other than the module's `expectedMajor` → skip.
5. Otherwise → load.

The reason is kept and shown in `get-mcp-health`.

### Product modules

A module (`npm/src/modules/<id>.ts`) is data plus a dynamic import:

```ts
{ id, displayName, toolPrefix: `${id}--`, packageName, expectedMajor, description, useWhen, required?, load() }
```

`load()` imports the product package's `./collections` entry point and returns its `collections`, `allModes`, `allModeNames`, `allSliceNames` and `createApiClient`. Absent products are never imported. `npm/src/modules/index.ts` lists the modules, CMS first, because it is the default module for unprefixed filter entries.

### Per-call client isolation

The toolkit (`@umbraco-cms/mcp-server-sdk`) keeps **one process-wide** API client provider (`configureApiClient` / `getApiClient`), but each product needs its own generated client. `client-context.ts` installs a provider once that reads the current product's client factory from an `AsyncLocalStorage`, and `tool-registrar.ts` wraps every handler in `bindClient(loaded.createApiClient, handler)`. Concurrent calls to different products therefore each get their own client.

This only works because product handlers call `getApiClient()` lazily, inside the call. Nothing else may call `configureApiClient`, and the toolkit's `clientFactory` proxy path must not be used: either would replace the provider. The concurrency tests in `client-context.test.ts` and `tool-registrar.test.ts` guard this through the real registration path.

### Exactly one toolkit copy

The shared provider only exists once if every product uses the same toolkit copy. `npm/package.json` pins `@umbraco-cms/mcp-server-sdk` to `1.0.0-beta.46` and forces it on every product with `overrides`. npm only applies `overrides` in the root project, though, and under `npx` `umbrella-mcp` is a dependency. For users, single-copy relies on every product package depending on a compatible toolkit version. `scripts/pack-check.sh` installs the packed package that way to catch a mismatch, and at runtime `checkSingleSdk` skips a product that has its own nested copy rather than letting it break the provider.

### Tool names, descriptions and routing

- **Names:** every tool is registered as `<toolPrefix><tool name>` (`forms--list-forms`). `get-mcp-health` is the only unprefixed tool. Two modules registering the same final name stops startup (`DuplicateToolNameError`).
- **Descriptions** start with the product: `[Umbraco Forms] …` (`describeTool`), so keyword-based tool search finds the right product.
- **Tool mentions:** product descriptions mention sibling tools by their unprefixed names ("use list-forms first"). `prefixToolReferences` rewrites each mention, in the description and in top-level input field descriptions, to the registered name: the module's own tool first, otherwise the only loaded product that has it. Ambiguous names (`get-server-info`) and nested field descriptions stay as they are.
- **Routing instructions:** `buildRoutingInstructions` turns each loaded module's `description` and `useWhen` phrases into the server `instructions`, which most clients fold into the system prompt. Words shared between products (for example "workflow") are disambiguated inside the `useWhen` text. A contract test keeps the text for all modules under 2,000 characters.

### Filters and backoffice settings

`filter-config.ts` splits the toolkit's filter variables per module, then each module's slice goes through the toolkit's `createCollectionConfigLoader` and `shouldIncludeTool`. Filters match the product's unprefixed tool names.

| Input | Scope |
|---|---|
| `UMBRACO_TOOL_MODES`, `UMBRACO_INCLUDE_/EXCLUDE_TOOL_COLLECTIONS`, `UMBRACO_INCLUDE_/EXCLUDE_TOOLS` | Per module: unprefixed entries → CMS, `forms:<value>` → Forms, `forms:*` → no restriction. The `*_TOOLS` lists also accept `forms--list-forms` |
| `UMBRACO_INCLUDE_SLICES`, `UMBRACO_EXCLUDE_SLICES`, `UMBRACO_READONLY`, `UMBRACO_NO_DESTRUCTIVE` | Every module |
| Dashboard: disabled groups (`disabledCollections`) | Become `excludeToolCollections` for that module, **unless** the environment sets any collection filter for it; then the site list is ignored (`siteSettingsIgnored`). A saved `[]` means nothing is off |
| Module: `defaultDisabledCollections` | Become `excludeToolCollections` only when the site has no saved list for the module (`disabledCollections` is `null` or missing, no add-on, or capabilities unavailable) and the environment sets no collection filter for it. `get-mcp-health` then names them |
| Dashboard: read-only (`readOnly`) | Always applied, ORed with `UMBRACO_READONLY`, since it can only remove tools |
| Dashboard: no destructive tools (`noDestructive`) | Always applied, ORed with `UMBRACO_NO_DESTRUCTIVE`, and it survives env collection filters. Removes tools where `isDestructive(tool)` (`npm/src/core/destructive.ts`: `annotations.destructiveHint === true`) holds. Read-only is the stricter level and wins in the stored levels. Umbrella keeps no list of its own |

`buildEffectiveFilterInput` combines these: environment, then the saved site list, then the module's defaults. The catalogue sent back to the site is built before filters, so the dashboard can also show groups that are switched off; it marks default-off groups with `disabledByDefault: true`, and the dashboard starts a product without a saved list from them.

### Health

`get-mcp-health` (`health.ts`) reports the add-on status, the Umbraco version check, and for each module whether it was detected, installed, enabled, loaded, its tool count and its issues, plus notes: products the site has but the server has no module for, unknown ids in `UMBRACO_MCP_MODULES`, ignored or applied dashboard settings (worded "for this API user" when `settingsScope` is `"user"`), default-off tool groups, a failed catalogue report, and a server version that differs from the add-on's. The report's `server.version` is the running umbrella-mcp. On the site, the "MCP client setup" check and the dashboard compare each connected API user's last reported `umbrellaVersion` with the add-on's version in the same way.

## The cross-language contract

These must match on both sides:

| What | C# | npm |
|---|---|---|
| Product ids | detector `Id` | module `id` |
| Capabilities payload (camelCase) | `McpCapabilities`, `McpProductStatus` | `CapabilitiesPayload` (`disabledCollections`, `readOnly`, `noDestructive` and `settingsScope` optional, for older add-ons; a missing or unknown `settingsScope` is `"site"`) |
| Catalogue payload | `McpCatalogueReport` (accepts a null `readOnlyToolCount` and `nonDestructiveToolCount` and a missing `disabledByDefault` from older servers) | `CataloguePayload` |
| npm package name and bin | `McpClientConfig.NpmPackage` | `name`, `bin` |
| Version | csproj `<Version>` | `version` |

`NpmPackageContractTests` reads `npm/package.json` and checks the name, bin and version. Each side's unit tests cover its own half of the payloads; only `scripts/e2e.sh` checks the ids and payloads across both, against a running site.

## Tests

- **.NET:** NUnit 3 with hand-written fakes (`tests/Umbraco.Mcp.Tests/Fakes.cs`) at the detection seams. No Umbraco host is started.
- **npm:** Jest with no HTTP mocking. Network edges are injected as functions (for example `fetchCapabilities(request)`), and pure logic is tested directly. `npm/src/modules/__tests__/contract.test.ts` checks every module automatically: id and prefix format, `load()` fields, well-formed tools, unique prefixed names and the routing length budget.
- **End to end:** `scripts/e2e.sh` (local build against the demo site) and `scripts/pack-check.sh` (the packed package installed with `npx`). See [development.md](development.md).
