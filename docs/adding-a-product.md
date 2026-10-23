# Adding an Umbraco HQ product

A product is one npm module file and one .NET detector. Nothing in `npm/src/core/` or the add-on's core changes. Umbraco Engage was added this way, so its files are the working example used below: `npm/src/modules/engage.ts` and `src/Umbraco.Mcp/Detection/Detectors/EngageDetector.cs`.

## What you need from the product

| Value | Engage | Where to find it |
|---|---|---|
| id | `engage` | Choose it: lowercase, used as the tool prefix `engage--` |
| MCP package | `@umbraco-engage/mcp-dev` | The product's MCP repository |
| Assembly name | `Umbraco.Engage.Core` | An assembly that is always loaded when the product is installed |
| Management API name | `engage-management` | The `[MapToApi("…")]` attribute on the product's Management API controllers |
| Backoffice section | `Umb.Section.Engage` | The product's section alias, if it has one; it is what the API user needs |

## 1. The product's MCP package

The package (`@umbraco-<product>/mcp-dev`) must export its API client factory as `createApiClient` from `./collections`, next to the existing exports in `src/collections.ts`. For Engage:

```ts
export { getUmbracoEngageManagementAPI as createApiClient } from "./umbraco-api/api/generated/umbracoEngageManagementApi.js";
```

It must also depend on the same `@umbraco-cms/mcp-server-sdk` version as `npm/package.json` (today `1.0.0-beta.47`). Otherwise users end up with a second toolkit copy and the server skips the product.

Then add it to `npm/package.json`:

- **A published release has both:** add it to `dependencies` with an exact registry version, as CMS, Forms, Automate and Engage are. The product ships in the next `umbrella-mcp` release.
- **Not published yet:** pack it locally with `npm pack --pack-destination <this repo>/npm/vendor`, add it to `devDependencies` as `file:vendor/<tarball>.tgz`, and add `external: ["<package>"]` to the config in `npm/tsup.config.ts` (devDependencies are bundled otherwise). It then loads in local builds, while the published `umbrella-mcp` reports in `get-mcp-health` that the product's tools are not available. CI cannot install the tarball: in `.github/workflows/ci.yml`, delete the devDependency before installing (with `npm install` instead of `npm ci`) and list the package in `CI_ABSENT_PACKAGES` so the contract test skips it. Move it to `dependencies` once the release is published, and undo all of that.

After `npm install`, `npm ls @umbraco-cms/mcp-server-sdk` must show a single `1.0.0-beta.47`, deduped.

## 2. npm module (`npm/src/modules/<id>.ts`)

```ts
import type { LoadedModule, McpProductModule } from "../core/module-contract.js";

export const engageModule: McpProductModule = {
  id: "engage",
  displayName: "Umbraco Engage",
  toolPrefix: "engage--",
  packageName: "@umbraco-engage/mcp-dev",
  expectedMajor: "17",
  description: "Umbraco Engage: personalisation, A/B tests and visitor analytics.",
  useWhen: [
    "A/B tests, their projects and variants",
    "personalisation: personas, customer journeys, Engage segments and content scoring",
    "visitor profiles, goals, campaigns, referral groups, heatmaps and annotations",
    "website visitor analytics and reports (not form submission analytics)",
    "the Engage main switch, traffic filters, data cleanup and Engage permissions",
  ],
  load: async (): Promise<LoadedModule> => {
    const m = await import("@umbraco-engage/mcp-dev/collections");
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

- **`description`:** one sentence starting with `<displayName>: `. The contract test checks this.
- **`useWhen`:** short, concrete phrases for the requests this product handles. They become the routing instructions, which must stay under 2,000 characters for all modules together. If a word overlaps another product ("workflow", "analytics", "segments"), say in the phrase which meaning belongs here, as Engage does with "not form submission analytics".
- **`defaultDisabledCollections`:** leave it out. Every tool group is on until the site saves a list, and the contract test checks that no module sets it.
- **`load()`:** keep the dynamic `import()`, so the package is only loaded when the site has the product.

Then:

- Add the module to `npm/src/modules/index.ts`, after CMS (CMS must stay first).
- If the package ships no types for `./collections`, add `declare module "@umbraco-<product>/mcp-dev/collections";` to `npm/src/types/product-modules.d.ts`.

## 3. .NET detector (`src/Umbraco.Mcp/Detection/Detectors/<Product>Detector.cs`)

```csharp
namespace Umbraco.Mcp.Detection.Detectors;

public sealed class EngageDetector(ILoadedAssemblyProvider assemblies, IRegisteredApiProvider apis)
    : ProductDetectorBase(assemblies, apis)
{
    public override string Id => "engage";
    public override string DisplayName => "Umbraco Engage";
    protected override string AssemblyName => "Umbraco.Engage.Core";
    protected override string ApiName => "engage-management";
    public override string? SectionAlias => "Umb.Section.Engage";   // null if the product has no section
}
```

`Id` must equal the npm module's `id`. Register the detector in `McpComposer`; the order there is the order products appear in capabilities, health checks and the dashboard:

```csharp
builder.Services.AddSingleton<IMcpProductDetector, EngageDetector>();
```

The add-on must not take a package dependency on the product: detection is by name only.

## 4. Demo site and end-to-end checks

- Add the product's NuGet package to `demo-site/Directory.Packages.props` (`PackageVersion`) and `demo-site/DemoSite.csproj` (`PackageReference`), plus any configuration it needs in `demo-site/appsettings.Development.json`.
- Add the product to `scripts/e2e.sh`: its id to the capabilities loop and the `get-mcp-health` loaded check, and its prefix to the tool list loop.
- Add its prefix to `scripts/pack-check.sh` once it ships from the registry. While it is a local tarball, assert there that its tools are absent instead.

## 5. Verify

```bash
cd npm && npm run compile && npm test   # the contract test covers the new module automatically
dotnet test Umbraco.Mcp.slnx
scripts/e2e.sh                          # with the demo site running; get-mcp-health shows the product loaded
scripts/pack-check.sh                   # registry dependencies only
```

The contract test checks the id and prefix format, the `load()` fields, that tools are well-formed, that prefixed names are unique across modules, and the routing length budget.

It also compares the tools flagged `destructiveHint` with `npm/src/modules/__tests__/destructive-tools.snapshot.json`. A new product with destructive tools fails it until you review the `<id>--…` names it reports as added and add them to the snapshot, sorted.

## 6. Docs

- `README.md`: the package table, Compatibility and Known limitations.
- `npm/README.md` and `src/Umbraco.Mcp/README.md`: the list of supported products.
- `docs/architecture.md` (the module list) and `docs/architecture-map.html` (the product boxes and prefixes).
- The `<Description>` in `src/Umbraco.Mcp/Umbraco.Mcp.csproj` (shown on NuGet).
- `CLAUDE.md`, "Product packages".
