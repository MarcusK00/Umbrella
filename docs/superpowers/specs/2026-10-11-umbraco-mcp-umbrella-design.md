# Umbraco MCP Umbrella — Design Spec

- **Date:** 11-10-2026
- **Status:** Approved design, pending spec review
- **Author:** mkr@umbraco.dk (with Claude)
- **Working names:** npm `@umbraco/mcp`, NuGet `Umbraco.Mcp` (final names need product sign-off)

## 1. Intent

Umbraco HQ ships separate MCP servers per product (CMS, Forms, Automate, Engage). Each product MCP spawns its own copy of the CMS MCP as a subprocess and proxies its tools as `cms--*`, so a developer using several products gets the CMS toolset several times, several processes and several logins.

This project delivers **one installable MCP for a whole Umbraco site** that:

1. Detects which HQ products are installed and enabled on the site.
2. Exposes only the tools for those products, in a single process with a single login.
3. Reports product/MCP health both in the Umbraco backoffice and through an MCP tool.
4. Makes adding the next HQ product MCP (Engage, Commerce, Workflow, …) a small, isolated change.

**Audience:** eventually customers and partners (official package). **This iteration is a proof of concept.**

### Success criteria

- `npx @umbraco/mcp` against an Umbraco 17 site with Forms + Automate + `Umbraco.Mcp` exposes `cms--*`, `forms--*`, `automate--*` tools plus `get-mcp-health`.
- Removing Automate from the site removes `automate--*` tools on next start, with no config change.
- Backoffice → Settings → Health Check shows an "MCP" group with one row per product.
- Adding a product requires: one module file + one list entry + one dependency (npm), one detector class (.NET). No core changes.
- Concurrent tool calls across products never use the wrong product's API client (proven by test).
- On connect, the agent receives a short routing table (server `instructions`) naming only the loaded products, their tool prefixes and when to use each. Every tool description starts with its product name.

## 2. Scope

### In scope (v1 POC)

- Products: **CMS, Forms, Automate**.
- Umbraco **17** only.
- **Local stdio** runtime only (`npx`, client-credentials API user).
- NuGet addon: product detection, capabilities endpoint, backoffice health check.
- npm package: module registry, capability-driven loading, per-call client isolation, `get-mcp-health` tool.
- Routing descriptions per module (section 5.6).
- Demo site + end-to-end tests.
- **Local-only** changes in the Forms and Automate MCP repos: export `createApiClient` from `./collections`, consumed as local tarballs. No PRs, nothing pushed, no template changes.

### Out of scope (v1)

- Hosted Cloudflare Worker / OAuth consent flow (and therefore the copied `McpOAuthComposer` files).
- Umbraco 18.
- Engage and other products (designed for, not built).
- Third-party / partner modules (HQ-only contract; may be unstable).
- Backoffice UI beyond the health check.
- Publishing to npm/NuGet feeds (POC uses local builds and `dotnet pack`).
- Pull requests or pushes to any product MCP repo, and changes to the MCP project template.
- On-demand module loading (a `load-module` tool plus `tools/list_changed`). The routing descriptions in 5.6 are designed to be reused if this is added later.

## 3. Background findings (from investigating the existing repos)

| | CMS MCP | Forms MCP | Automate MCP |
|---|---|---|---|
| Package | `@umbraco-cms/mcp-dev` | `@umbraco-forms/mcp-dev` | `@umbraco-automate/mcp-dev` |
| Release line for Umbraco 17 | `@17` | 17.x | 17.x |
| Exports `./collections` | yes | yes | yes |
| Exports API client factory from `./collections` | yes (`UmbracoManagementClient`) | **no** | **no** |
| SDK dependency | `^1.0.0-beta.39` | `1.0.0-beta.41` (exact) | `1.0.0-beta.39` (exact) |

Facts that drive the design:

- `./collections` bundles import `@umbraco-cms/mcp-server-sdk` as an **external** dependency, so all modules share the SDK instance **only if npm dedupes it to a single version**. The exact pins above would currently produce two copies.
- The SDK holds a **process-global** API client provider (`configureApiClient` / `getApiClient`). Its built-in in-process chaining swaps this global around each call with try/finally, which is **not safe under concurrent tool calls**.
- Forms and Automate both define `get-server-info`; Forms and CMS both define `empty-recycle-bin`. Unprefixed merging would collide.
- The SDK already provides: `createCollectionConfigLoader`, `shouldIncludeTool`, `createToolAnnotations`, `handleCliCommands` (`--list-tools` etc.), `checkUmbracoVersion`, `useDraft202012ToolSchemas`, `initializeUmbracoFetch`.

## 4. Architecture

One new repo, two packages released together.

```
Umbraco.MCP/
├─ src/Umbraco.Mcp/                         NuGet addon (installed in the Umbraco site)
│  ├─ Detection/IMcpProductDetector.cs
│  ├─ Detection/ProductDetectorBase.cs
│  ├─ Detection/McpProductStatus.cs
│  ├─ Detection/Detectors/CmsDetector.cs
│  ├─ Detection/Detectors/FormsDetector.cs
│  ├─ Detection/Detectors/AutomateDetector.cs
│  ├─ Api/McpCapabilitiesController.cs      GET /umbraco/management/api/v1/mcp/capabilities
│  ├─ HealthChecks/McpProductsHealthCheck.cs
│  └─ McpComposer.cs
├─ tests/Umbraco.Mcp.Tests/                 NUnit
├─ npm/                                     @umbraco/mcp
│  ├─ src/core/module-contract.ts
│  ├─ src/core/module-registry.ts
│  ├─ src/core/capabilities-client.ts
│  ├─ src/core/client-context.ts
│  ├─ src/core/filter-config.ts
│  ├─ src/core/health-tool.ts
│  ├─ src/core/server.ts
│  ├─ src/modules/cms.ts
│  ├─ src/modules/forms.ts
│  ├─ src/modules/automate.ts
│  ├─ src/modules/index.ts                  ← the only list to edit when adding a product
│  └─ src/index.ts                          stdio entry point
├─ demo-site/                               Umbraco 17 + Forms + Automate + project ref to Umbraco.Mcp
└─ docs/adding-a-product.md
```

### 4.1 npm module contract

```ts
// src/core/module-contract.ts
import type { ToolCollection } from "@umbraco-cms/mcp-server-sdk";

export interface LoadedModule {
  collections: ToolCollection[];
  allModes: unknown;          // the product's mode registry, passed to createCollectionConfigLoader
  allModeNames: string[];
  allSliceNames: string[];
  createApiClient: () => unknown;   // the product's Orval client factory
}

export interface McpProductModule {
  /** Matches the .NET detector Id. Lowercase, stable. e.g. "forms" */
  id: string;
  displayName: string;
  /** Prefix applied to every tool name, e.g. "forms--" */
  toolPrefix: string;
  /** Required modules load even without capabilities (CMS only). */
  required?: boolean;
  /** Expected product major for this release line, e.g. "17". */
  expectedMajor: string;
  /** npm package providing `./collections`. */
  packageName: string;
  /** One sentence: what this product is. Used for routing (5.6). */
  description: string;
  /** Short phrases for the requests this product's tools handle. Disambiguate overlapping words here. */
  useWhen: string[];
  /** Dynamic import so absent products are never loaded. */
  load(): Promise<LoadedModule>;
}
```

Example module:

```ts
// src/modules/forms.ts
import type { McpProductModule } from "../core/module-contract.js";

export const formsModule: McpProductModule = {
  id: "forms",
  displayName: "Umbraco Forms",
  toolPrefix: "forms--",
  expectedMajor: "17",
  packageName: "@umbraco-forms/mcp-dev",
  description: "Umbraco Forms: forms, their fields and the entries people submit.",
  useWhen: [
    "forms, form fields, pages, conditions, themes and form templates",
    "form submissions (entries/records), searching and exporting them",
    "form workflows (actions that run after a form is submitted), data sources and prevalue sources",
  ],
  load: async () => {
    const m = await import("@umbraco-forms/mcp-dev/collections");
    return {
      collections: m.collections,
      allModes: m.allModes,
      allModeNames: m.allModeNames,
      allSliceNames: m.allSliceNames,
      createApiClient: m.createApiClient,
    };
  },
};
```

```ts
// src/modules/index.ts
export const modules = [cmsModule, formsModule, automateModule];
```

### 4.2 .NET detector contract

```csharp
public interface IMcpProductDetector
{
    string Id { get; }            // matches npm module id, e.g. "forms"
    string DisplayName { get; }
    McpProductStatus Detect();
}

public sealed record McpProductStatus(
    string Id, string DisplayName,
    bool Installed, bool Enabled, string? Version,
    IReadOnlyList<string> Issues);
```

`ProductDetectorBase(id, displayName, assemblyName, apiDocumentName)`:

- **installed** = an assembly named `assemblyName` is loaded; version = its `AssemblyInformationalVersionAttribute` (build metadata after `+` stripped).
- **enabled** = the product's Management API OpenAPI document named `apiDocumentName` is registered (read from the Swagger generator options registered in DI).
- `protected virtual IEnumerable<string> GetIssues()`, empty by default; extension point for product-specific checks (e.g. Engage main switch, Forms licence). Not used in v1.

The addon takes **no NuGet dependency** on any product package. Detection is by name only, so installing `Umbraco.Mcp` never pulls in Forms or Automate.

Detectors are registered in `McpComposer` as `IMcpProductDetector` and resolved as `IEnumerable<IMcpProductDetector>`. `CmsDetector` always returns installed + enabled with the version from `IUmbracoVersion`.

**Must verify during implementation (Umbraco 17):** the exact assembly names and OpenAPI document names for Forms and Automate. The Forms MCP orval config uses `/umbraco/swagger/<document>/swagger.json`, and the Engage config shows `engage-management`, which suggests `forms-management` / `automate-management`. Confirm from the demo site's swagger UI before hard-coding.

## 5. Data flow

### 5.1 Startup

Inputs: `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID`, `UMBRACO_CLIENT_SECRET` (same as existing MCPs), plus optional `UMBRACO_MCP_MODULES` and filter env vars.

1. **Auth once:** `initializeUmbracoFetch({ baseUrl, clientId, clientSecret })`. A 401 here stops startup with a clear message.
2. **Version check once:** `checkUmbracoVersion` against major `17` via CMS server information; `configureVersionCheckHook()` and fold `getVersionCheckMessage()` into server `instructions`.
3. **Fetch capabilities:** `GET /umbraco/management/api/v1/mcp/capabilities`.
4. **Select modules:** load a module if `required`, OR its product is `installed && enabled` with a major matching `expectedMajor`, OR it is listed in `UMBRACO_MCP_MODULES`.
5. **Load and register:** for each selected module, call `load()`, build its filter config, then register each included tool with name `toolPrefix + tool.name`, full input/output schemas and annotations, with its handler wrapped by the client context (5.2). Register `get-mcp-health`.
6. **Collision check:** if any final tool name is registered twice, stop startup with an error naming both modules.
7. Apply `useDraft202012ToolSchemas(server)` after all registrations, then connect stdio transport.
8. `handleCliCommands` (`--list-tools`, `--describe-tool`) works over the merged, prefixed tool set.

### 5.2 Per-call client isolation

```ts
// src/core/client-context.ts
import { AsyncLocalStorage } from "node:async_hooks";
export const clientContext = new AsyncLocalStorage<() => unknown>();

// at startup, once:
configureApiClient(() => (clientContext.getStore() ?? cmsModule.createApiClient)());

// per tool:
const wrapped = (args, extra) =>
  clientContext.run(loaded.createApiClient, () => tool.handler(args, extra));
```

`getApiClient()` is called lazily inside handlers and `AsyncLocalStorage` propagates across awaits, so concurrent calls each resolve their own product's client. No SDK change required.

### 5.3 Single SDK instance

`npm/package.json` pins one exact `@umbraco-cms/mcp-server-sdk` version and uses `overrides` to force all product packages onto it. At startup, `server.ts` asserts (via `createRequire(<product package path>).resolve("@umbraco-cms/mcp-server-sdk")`) that every loaded product package resolves the SDK to the same path as the umbrella. On mismatch, that module is skipped with an issue ("SDK version mismatch") rather than silently misbehaving.

### 5.4 Capabilities endpoint

`GET /umbraco/management/api/v1/mcp/capabilities`, a Management API controller requiring an authenticated backoffice user (no extra section permission; it reveals only product names and versions).

```json
{
  "addonVersion": "17.0.0",
  "products": [
    { "id": "cms",      "displayName": "Umbraco CMS",      "installed": true,  "enabled": true,  "version": "17.7.0", "issues": [] },
    { "id": "forms",    "displayName": "Umbraco Forms",    "installed": true,  "enabled": true,  "version": "17.6.1", "issues": [] },
    { "id": "automate", "displayName": "Umbraco Automate", "installed": false, "enabled": false, "version": null,     "issues": [] }
  ]
}
```

### 5.5 Tool filtering

Reuse the SDK's existing env vars (`UMBRACO_TOOL_MODES`, `UMBRACO_INCLUDE_SLICES` / `UMBRACO_EXCLUDE_SLICES`, `UMBRACO_INCLUDE_TOOL_COLLECTIONS` / `UMBRACO_EXCLUDE_TOOL_COLLECTIONS`, `UMBRACO_INCLUDE_TOOLS` / `UMBRACO_EXCLUDE_TOOLS`; verified in `@umbraco-cms/mcp-server-sdk` beta.41), extended with an optional `module:` prefix per entry. Example: `UMBRACO_TOOL_MODES=content,forms:*`.

- `content` → applies to CMS (unprefixed entries default to CMS, so existing CMS configs keep working).
- `forms:forms`, `automate:*` → apply to that module.
- Slice names (e.g. `read`) apply to **all** modules.

`filter-config.ts` splits the env values per module and feeds each module's slice through `createCollectionConfigLoader({ modeRegistry, allModeNames, allSliceNames })` and `shouldIncludeTool`. With no filter vars set, all tools of loaded modules are registered.

### 5.6 Routing descriptions

Goal: an agent picks the right product **before** looking through tools, instead of scanning every tool of every product.

Each module declares `description` and `useWhen` (4.1). They are used in three places, always only for modules that actually loaded:

1. **Server `instructions`** (sent on `initialize`; most clients fold it into the system prompt). `buildRoutingInstructions(loadedModules)` produces a short routing table:

   ```text
   This server exposes tools for several Umbraco products on one site. Every tool name starts with its product prefix.
   Pick the product from the user's request first, then only use tools with that prefix:

   - `cms--` Umbraco CMS: the site's content, structure, media, members and settings. Use for: content/documents and publishing; document types, data types, templates…
   - `forms--` Umbraco Forms: forms, their fields and the entries people submit. Use for: …; form workflows (actions that run after a form is submitted)…
   - `automate--` Umbraco Automate: automations that react to triggers and run steps. Use for: …; general automations not tied to a form submission…

   If the request does not clearly match one product, or product tools seem missing, call get-mcp-health.
   ```

   The version-check warning, if any, is appended. The whole text must stay under 2,000 characters for the full module set (enforced by test), so it doesn't bloat the agent's context.
2. **Tool descriptions** are prefixed with the product: `[Umbraco Forms] Lists all forms…`. This helps clients that search tools by keyword (e.g. deferred tool search).
3. **`get-mcp-health`** includes each product's `description`.

Overlapping vocabulary is resolved inside `useWhen` text, not with extra fields. Example: Forms says "form workflows (actions that run after a form is submitted)", and Automate says "general automations not tied to a form submission".

Because `instructions` is fixed at server construction, startup loads the selected modules first, builds the instructions from the ones that loaded, then creates the server and registers tools.

## 6. Health

### 6.1 Backoffice health check

`McpProductsHealthCheck` in group **"MCP"**, one status per detector:

| Condition | Status |
|---|---|
| installed and enabled, no issues | Success: "Umbraco Forms 17.6.1 is installed and its API is available." |
| installed, but not enabled or has issues | Warning, listing issues |
| not installed | Info: "Not installed." |

Plus one Info row with the addon version. No actions in v1.

### 6.2 `get-mcp-health` MCP tool

Read-only (`readOnlyHint: true`), no inputs. Returns:

```json
{
  "addon": { "installed": true, "version": "17.0.0" },
  "umbraco": { "version": "17.7.0", "versionCheck": "ok" },
  "forcedModules": [],
  "products": [
    { "id": "forms", "description": "Umbraco Forms: forms, their fields and the entries people submit.",
      "installed": true, "enabled": true, "version": "17.6.1",
      "hasModule": true, "loaded": true, "toolCount": 118, "issues": [] }
  ],
  "notes": ["Umbraco Engage is installed, but this MCP has no Engage module yet."]
}
```

It reports gaps in both directions: a product detected with no module, and a module whose product is absent.

## 7. Error handling

| Situation | Behaviour |
|---|---|
| 401 at startup | Stop with a clear credentials message |
| Capabilities 404 (addon not installed) | Load CMS only; health explains how to install `Umbraco.Mcp` |
| Capabilities timeout / 5xx | Load CMS only; record issue in health |
| Module `load()` throws / missing export | Skip module, record issue, continue |
| Product major ≠ `expectedMajor` | Skip module with issue (unless forced via `UMBRACO_MCP_MODULES`) |
| SDK instance mismatch | Skip module with issue |
| Duplicate final tool name | Stop at startup (programming error; contract tests should catch it first) |

**Invariant:** CMS tools always load; product modules fail in isolation; every failure is visible in `get-mcp-health`.

## 8. Testing

Follow existing repo conventions: Jest + msw (npm), NUnit (.NET).

**npm unit**

- Module selection: table-driven over capabilities payloads (installed/enabled/major combinations, forced modules, 404/5xx/401).
- `UMBRACO_MCP_MODULES` and prefixed-filter parsing.
- Prefixing and duplicate-name detection.
- **Client isolation:** two fake modules whose handlers `await` a delay then call `getApiClient()`; run them concurrently, interleaved; assert each sees its own client.
- `get-mcp-health` output for representative states (snapshot).

**Module contract test** (auto-runs over every entry in `src/modules/index.ts`)

- `load()` resolves with all `LoadedModule` fields.
- Every tool has `name`, `description`, `handler`; prefixed names are unique across all modules.
- `id` matches `/^[a-z][a-z0-9-]*$/` and `toolPrefix === id + "--"`.

**.NET unit**

- `ProductDetectorBase` with injected fakes for loaded-assembly lookup and registered OpenAPI documents.
- Health check status mapping.
- Capabilities controller serialises all detectors.

**End-to-end** (demo site)

- With Forms + Automate: `--list-tools` includes `cms--`, `forms--`, `automate--` tools and `get-mcp-health`.
- Without Automate: no `automate--` tools.
- Smoke calls: `forms--list-forms`, `automate--list-automations`, `get-mcp-health`.
- Product tools themselves are not re-tested here; product repos own that.

## 9. Extending: adding a product (e.g. Engage)

Documented in `docs/adding-a-product.md`:

1. **Product repo (local only):** `./collections` exports `createApiClient`. Make the change on a local branch, `npm pack` it into `npm/vendor/`; no PR.
2. **npm:** add `src/modules/engage.ts` (~25 lines, including `description` and `useWhen`), one entry in `src/modules/index.ts`, and the product dependency in `npm/package.json` (on the matching major line, SDK aligned via `overrides`). Check that `useWhen` doesn't overlap existing modules; disambiguate shared words in the text.
3. **.NET:** add `EngageDetector : ProductDetectorBase` (~5 lines) and register it in `McpComposer`.
4. Contract tests and `get-mcp-health` cover it automatically. No core changes.

## 10. Delivery phases

- **Phase 0, local product changes:** on local branches of the Forms and Automate MCP repos (v17 lines), add `export { getUmbraco…ManagementAPI as createApiClient }` to `src/collections.ts` and align both on one SDK version. `npm pack` them into `npm/vendor/`; the umbrella depends on those tarballs via `file:`. No PRs and no pushes.
- **Phase 1, NuGet addon:** detectors, capabilities endpoint, health check, unit tests.
- **Phase 2, npm core and modules:** contract, registry, client context, filtering, health tool, three modules, unit and contract tests.
- **Phase 3, demo site and E2E:** Umbraco 17 demo site with Forms + Automate + project reference; E2E scripts.

## 11. Risks

- **SDK version alignment:** product teams release independently; a module on a different SDK version is skipped. Mitigation: `overrides` + startup assertion + a compatibility table in the README.
- **Tool count:** CMS + Forms + Automate is several hundred tools. Mitigation: capability-driven loading and the existing modes/slices filters; document recommended filter presets.
- **Tool renaming:** prefixed names differ from standalone CMS MCP names, which affects users' existing prompts/permission allowlists. Accepted for the POC; called out in docs.
- **Local product builds drift:** the vendored Forms/Automate tarballs come from local branches. When those repos move on, re-apply the one-line export and re-pack. Anything beyond the POC would need the export upstream through the product teams and Umbraco's contribution process.
- **Routing quality:** `useWhen` phrases are hand-written; vague or overlapping phrases send agents to the wrong product. Keep them short and concrete, and review them whenever a module is added.
- **Global client provider:** relies on handlers calling `getApiClient()` lazily inside the call. The isolation test guards this; if a product captures the client eagerly at import time, its contract test will fail.
