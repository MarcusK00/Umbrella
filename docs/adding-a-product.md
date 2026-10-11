# Adding an Umbraco HQ product

Example: Umbraco Engage. Nothing in `npm/src/core/` or the addon's core changes.

## 1. Product MCP package

The product's MCP package (`@umbraco-<product>/mcp-dev`) must export the API client factory from `src/collections.ts`, next to the existing exports:

```ts
export { getUmbracoEngageManagementAPI as createApiClient } from "./umbraco-api/api/generated/umbracoEngageManagementApi.js";
```

and depend on the same `@umbraco-cms/mcp-server-sdk` version as `npm/package.json`.

- **Published release has both:** add it to `dependencies` from the registry, as CMS, Forms and Automate are. The product ships in the next `umbrella-mcp` release.
- **Not published yet:** build it locally with `npm pack --pack-destination <path-to>/Umbraco.MCP/npm/vendor`, add it to `devDependencies` as `file:vendor/…tgz`, and add the package name to `external` in `npm/tsup.config.ts`. It then loads in local builds, while the published `umbrella-mcp` reports in `get-mcp-health` that the product's tools are not available (this is how Engage works today). Move it to `dependencies` once the release is published.

## 2. npm module (`npm/src/modules/engage.ts`)

```ts
import type { LoadedModule, McpProductModule } from "../core/module-contract.js";

export const engageModule: McpProductModule = {
  id: "engage",
  displayName: "Umbraco Engage",
  toolPrefix: "engage--",
  packageName: "@umbraco-engage/mcp-dev",
  expectedMajor: "17",
  description: "Umbraco Engage: personalisation, A/B tests, segments and visitor analytics.",
  useWhen: [
    "A/B tests and their variants",
    "personalisation, personas, segments and customer journeys",
    "visitor analytics, goals, campaigns and reporting",
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

Then:
- add `engageModule` to `npm/src/modules/index.ts`
- write `description` as one sentence starting with the display name, and keep `useWhen` phrases short and concrete. If a word overlaps another product (e.g. "workflow", "analytics"), say in the phrase which meaning belongs here
- add `declare module "@umbraco-engage/mcp-dev/collections";` to `npm/src/types/product-modules.d.ts` (if the package ships no types)
- add the package to `npm/package.json` on the matching major line (see section 1 for `dependencies` or `devDependencies`)

## 3. .NET detector (`src/Umbraco.Mcp/Detection/Detectors/EngageDetector.cs`)

```csharp
namespace Umbraco.Mcp.Detection.Detectors;

public sealed class EngageDetector(ILoadedAssemblyProvider assemblies, IRegisteredApiProvider apis)
    : ProductDetectorBase(assemblies, apis)
{
    public override string Id => "engage";
    public override string DisplayName => "Umbraco Engage";
    protected override string AssemblyName => "Umbraco.Engage.Core";
    protected override string ApiName => "engage-management";
    public override string? SectionAlias => "Umb.Section.Engage";   // section the API user needs; null if none
}
```

Register it in `McpComposer`: `builder.Services.AddSingleton<IMcpProductDetector, EngageDetector>();`

## 4. Verify

- `cd npm && npm test`: the contract test covers the new module automatically.
- `dotnet test Umbraco.Mcp.slnx`
- `scripts/e2e.sh` against a demo site with the product installed; `get-mcp-health` shows it loaded.
- `scripts/pack-check.sh` to check the product loads when `umbrella-mcp` is installed with `npx` (registry dependencies only).
- Add the product to the supported products and compatibility table in `README.md`, `npm/README.md` and `src/Umbraco.Mcp/README.md`.
