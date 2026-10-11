# Umbraco MCP Umbrella Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a proof-of-concept "one MCP per Umbraco site": a NuGet addon (`Umbraco.Mcp`) that detects installed HQ products and reports health, plus one npm MCP server (`@umbraco/mcp`) that loads CMS, Forms and Automate tools in-process, only for the products the site reports.

**Architecture:** The NuGet addon exposes `GET /umbraco/management/api/v1/mcp/capabilities` (built from one `IMcpProductDetector` per product) and an "MCP" backoffice health check group. The npm server authenticates once, reads capabilities, selects product modules (one small adapter file per product under `npm/src/modules/`), registers their tools with a `<id>--` prefix, and binds every tool call to its own product's API client through `AsyncLocalStorage`. A `get-mcp-health` tool reports the result. Each module also carries a one-sentence `description` and short `useWhen` phrases: the server sends a routing table of the loaded modules as MCP `instructions` and prefixes every tool description with its product name, so agents pick a product before searching tools.

**Tech Stack:** .NET 10 / Umbraco 17.7.0 / NUnit 3 (addon); Node ≥ 22, TypeScript (strict, ESM), `@modelcontextprotocol/sdk`, `@umbraco-cms/mcp-server-sdk` 1.0.0-beta.45, tsup, Jest 30 + ts-jest (npm package).

**Spec:** `docs/superpowers/specs/2026-10-11-umbraco-mcp-umbrella-design.md`

### Spec deltas (decided while planning, from verified facts)

1. **Toolkit version is `1.0.0-beta.45`.** Published `@umbraco-cms/mcp-dev@17.6.10` (the `lts-17` tag) requires `^1.0.0-beta.45`, while published Forms `17.6.1-beta.1` pins `beta.41` and Automate `17.0.0-beta.2` pins `beta.39`. Phase 0 moves Forms and Automate to `beta.45`.
2. **"Enabled" detection uses MVC action descriptors**, not Swagger options. Products tag controllers with Umbraco's `[MapToApi("<api-name>")]`, so "enabled" means some registered controller action maps to that API. This works whichever OpenAPI generator Umbraco uses. Verified names: Forms `forms-management` (assembly `Umbraco.Forms.Core`), Automate `automate-management` (assembly `Umbraco.Automate.Core`).
3. **Single-toolkit check is a nested-copy check:** a module is skipped if its package directory contains its own `node_modules/@umbraco-cms/mcp-server-sdk`. To support this, the module contract gains a `packageName` field.
4. **`--list-tools` is implemented by the umbrella** (prints the final prefixed names). The toolkit's `handleCliCommands` assumes a single collection set.
5. **Bad credentials are detected by the first CMS call** (`getUserCurrent`, which also supplies the user that `collection.tools(user)` needs). The capabilities client therefore only distinguishes ok / no-addon / unavailable.
6. **No msw.** The capabilities request is injected as a function, so unit tests need no HTTP mocking.

## Global Constraints

- Umbraco **17 only**: `Umbraco.Cms.Api.Management` **17.7.0**, `TargetFramework` **net10.0**; demo site uses `Umbraco.Cms` 17.7.0, `Umbraco.Forms` 17.6.1, `Umbraco.Automate` 17.4.0.
- The NuGet addon takes **no package dependency on any product** (Forms, Automate, …). Detect by assembly name and API name only.
- npm: Node `>=22.0.0`, `"type": "module"`, TypeScript `strict`.
- Exactly one toolkit: `@umbraco-cms/mcp-server-sdk` **`1.0.0-beta.45`** as a direct dependency, forced on every product via `"overrides": { "@umbraco-cms/mcp-server-sdk": "$@umbraco-cms/mcp-server-sdk" }`.
- Product packages: `@umbraco-cms/mcp-dev` **`17.6.10`** from the registry; Forms and Automate from Phase 0 tarballs in `npm/vendor/`.
- Every tool name is `<module.id>--<tool.name>`, including CMS. The only unprefixed tool is `get-mcp-health`.
- CMS (`required: true`) always loads. Product modules fail in isolation; every failure is visible in `get-mcp-health`.
- Runtime is **local stdio only**. Environment: `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID`, `UMBRACO_CLIENT_SECRET`, optional `UMBRACO_MCP_MODULES`, plus the toolkit filter vars.
- Working names `@umbraco/mcp` and `Umbraco.Mcp` (final names need product sign-off; do not publish to any feed).
- Test libraries (copied from existing Umbraco repos): NUnit **3.14.0**, NUnit3TestAdapter **6.2.0**, Microsoft.NET.Test.Sdk **18.8.1**; Jest **^30.4.2**, ts-jest **^29.4.11**.
- Never commit secrets. `.env`, `appsettings.local.json` and `npm/vendor/*.tgz` are gitignored.
- Product MCP repo changes (Phase 0) are **local only**: never push, never open a PR, never change the MCP project template.
- Every registered tool description is `[<module.displayName>] <original description>`. Server `instructions` = routing table of the **loaded** modules (+ version warning), under 2,000 characters for the full module set.
- Dates in docs use DD-MM-YYYY.

## Review Focus

1. **Concurrent calls across products.** Two tool calls for different products in flight at once must each use their own product's client, including when going through the real registration path, not just `bindClient`. Pinned in Task 11 (registrar test) and Task 7.
2. **A 200 response that isn't capabilities** (for example an HTML login page, `{}`, or a missing `products` array). Expected: treated as "unavailable", CMS-only, with a readable reason, never a crash. Pinned in Task 8.
3. **Odd product versions** (`17.6.1-beta.1+abc`, `v17`, `null` while installed). Expected: the major is parsed from the leading digits; `null` while installed means skip with "unknown version". Pinned in Task 9.
4. **Messy `UMBRACO_MCP_MODULES`** (`" Forms, ,automate,engage "`). Expected: lowercase, trimmed, empties dropped, unknown ids (`engage`) reported in health notes, never thrown. Pinned in Tasks 9 and 12.
5. **Filter entries for unknown or unloaded modules** (`UMBRACO_TOOL_MODES=engage:analytics,content`). Expected: ignored for other modules, and `content` still applies to CMS. Pinned in Task 9.

---

## File Structure

```
Umbraco.MCP/
├─ .gitignore
├─ README.md
├─ Directory.Packages.props                 central NuGet versions
├─ Umbraco.Mcp.slnx
├─ src/Umbraco.Mcp/
│  ├─ Umbraco.Mcp.csproj
│  ├─ McpComposer.cs                        DI registrations
│  ├─ Detection/IMcpProductDetector.cs      detector contract
│  ├─ Detection/McpProductStatus.cs         detector result record
│  ├─ Detection/ILoadedAssemblyProvider.cs  seam: find loaded assembly by name
│  ├─ Detection/IRegisteredApiProvider.cs   seam: is an API name live
│  ├─ Detection/AssemblyVersionReader.cs    informational version without +build
│  ├─ Detection/ProductDetectorBase.cs      installed/enabled logic
│  ├─ Detection/Detectors/CmsDetector.cs
│  ├─ Detection/Detectors/FormsDetector.cs
│  ├─ Detection/Detectors/AutomateDetector.cs
│  ├─ Capabilities/McpCapabilities.cs       response record
│  ├─ Capabilities/IMcpCapabilitiesService.cs
│  ├─ Capabilities/McpCapabilitiesService.cs
│  ├─ Api/McpCapabilitiesController.cs      GET …/mcp/capabilities
│  └─ HealthChecks/McpProductsHealthCheck.cs
├─ tests/Umbraco.Mcp.Tests/
│  ├─ Umbraco.Mcp.Tests.csproj
│  ├─ Fakes.cs
│  ├─ ProductDetectorBaseTests.cs
│  ├─ McpCapabilitiesServiceTests.cs
│  ├─ McpCapabilitiesControllerTests.cs
│  └─ McpProductsHealthCheckTests.cs
├─ npm/
│  ├─ package.json · tsconfig.json · tsup.config.ts · jest.config.ts
│  ├─ vendor/                               Phase 0 tarballs (gitignored)
│  └─ src/
│     ├─ index.ts                           stdio entry, --list-tools
│     ├─ types/product-modules.d.ts         ambient types for untyped product entry points
│     ├─ core/module-contract.ts
│     ├─ core/client-context.ts
│     ├─ core/capabilities.ts
│     ├─ core/module-selection.ts
│     ├─ core/filter-config.ts
│     ├─ core/routing.ts                    routing instructions + tool description prefix
│     ├─ core/tool-registrar.ts
│     ├─ core/sdk-instance.ts
│     ├─ core/health.ts
│     ├─ core/server.ts                     orchestration
│     ├─ core/__tests__/*.test.ts
│     ├─ modules/cms.ts · forms.ts · automate.ts · index.ts
│     └─ modules/__tests__/contract.test.ts
├─ demo-site/                               Umbraco 17 + Forms + Automate + ProjectReference
├─ scripts/create-api-user.mjs · scripts/e2e.sh
└─ docs/adding-a-product.md
```

---

# Phase 0: Local product changes (in the product repos, local only)

These tasks change **other repositories, locally only**. Work on a new local branch in each. Never push and never open a PR. The output is a tarball the umbrella consumes.

### Task 1: Forms MCP exports `createApiClient` and moves to toolkit beta.45

**Files (repo `~/Desktop/Umbraco/Forms.MCP.Developer.Repository/Umbraco-Forms-MCP-Dev`):**
- Modify: `src/collections.ts` (append one export)
- Modify: `package.json` (toolkit versions)
- Output: `~/Desktop/Umbraco/Umbraco.MCP/npm/vendor/umbraco-forms-mcp-dev-17.6.1-beta.1.tgz`

**Interfaces:**
- Produces: `@umbraco-forms/mcp-dev/collections` exports `createApiClient: () => ReturnType<typeof getUmbracoFormsManagementAPI>` alongside the existing `collections`, `allModes`, `allModeNames`, `allSliceNames`.

- [ ] **Step 1: Branch from the v17 line**

```bash
cd ~/Desktop/Umbraco/Forms.MCP.Developer.Repository/Umbraco-Forms-MCP-Dev
git status --short            # must be clean; if not, stop and ask the user
git branch -a | grep -E "v17/(main|dev)"
git switch -c v17/feature/export-create-api-client origin/v17/main   # use the v17 base branch the grep shows
```

- [ ] **Step 2: Write the failing check**

```bash
npm run build && node -e "import('./dist/collections.js').then(m => { if (typeof m.createApiClient !== 'function') { console.error('FAIL: createApiClient missing'); process.exit(1) } console.log('PASS') })"
```

Expected: `FAIL: createApiClient missing`

- [ ] **Step 3: Add the export to the end of `src/collections.ts`**

```ts
/** Orval client factory for this product, used by hosts that run several Umbraco MCPs in one process. */
export { getUmbracoFormsManagementAPI as createApiClient } from "./umbraco-api/api/generated/umbracoFormsManagementApi.js";
```

- [ ] **Step 4: Move both toolkit packages to beta.45 in `package.json` `dependencies`**

```json
"@umbraco-cms/mcp-hosted": "1.0.0-beta.45",
"@umbraco-cms/mcp-server-sdk": "1.0.0-beta.45",
```

Run: `npm install && npm run compile`
Expected: exit 0. If compile fails because of toolkit API changes between beta.41 and beta.45, **stop and report the errors to the user**. Do not patch product code beyond this task's scope.

- [ ] **Step 5: Re-run the check from Step 2**

Expected: `PASS`

- [ ] **Step 6: Pack into the umbrella's vendor folder**

```bash
mkdir -p ~/Desktop/Umbraco/Umbraco.MCP/npm/vendor
npm pack --pack-destination ~/Desktop/Umbraco/Umbraco.MCP/npm/vendor
```

Expected: `umbraco-forms-mcp-dev-17.6.1-beta.1.tgz` is created.

- [ ] **Step 7: Commit (local only)**

```bash
git add src/collections.ts package.json package-lock.json
git commit -m "feat: export createApiClient from ./collections for multi-MCP hosts; bump toolkit to beta.45"
```

### Task 2: Automate MCP exports `createApiClient` and moves to toolkit beta.45

**Files (repo `~/Desktop/Umbraco/Automate.MCP.Dev.Repository/Umbraco-Automate-MCP-Dev`):**
- Modify: `src/collections.ts`
- Modify: `package.json`
- Output: `~/Desktop/Umbraco/Umbraco.MCP/npm/vendor/umbraco-automate-mcp-dev-17.0.0-beta.2.tgz`

**Interfaces:**
- Produces: `@umbraco-automate/mcp-dev/collections` exports `createApiClient: () => ReturnType<typeof getUmbracoAutomateManagementAPI>`.

- [ ] **Step 1: Branch from the v17 line**

```bash
cd ~/Desktop/Umbraco/Automate.MCP.Dev.Repository/Umbraco-Automate-MCP-Dev
git status --short            # must be clean; if not, stop and ask the user
git branch -a | grep -E "v17/(main|dev)"
git switch -c v17/feature/export-create-api-client origin/v17/main   # use the v17 base branch the grep shows
```

- [ ] **Step 2: Write the failing check**

```bash
npm run build && node -e "import('./dist/collections.js').then(m => { if (typeof m.createApiClient !== 'function') { console.error('FAIL: createApiClient missing'); process.exit(1) } console.log('PASS') })"
```

Expected: `FAIL: createApiClient missing`

- [ ] **Step 3: Add the export to the end of `src/collections.ts`**

```ts
/** Orval client factory for this product, used by hosts that run several Umbraco MCPs in one process. */
export { getUmbracoAutomateManagementAPI as createApiClient } from "./umbraco-api/api/generated/umbracoAutomateManagementApi.js";
```

- [ ] **Step 4: Move both toolkit packages to beta.45 in `package.json` `dependencies`**

```json
"@umbraco-cms/mcp-hosted": "1.0.0-beta.45",
"@umbraco-cms/mcp-server-sdk": "1.0.0-beta.45",
```

Run: `npm install && npm run compile`
Expected: exit 0. If compile fails (beta.39 → beta.45 is a larger jump), **stop and report the errors to the user**.

- [ ] **Step 5: Re-run the check from Step 2**

Expected: `PASS`

- [ ] **Step 6: Pack**

```bash
npm pack --pack-destination ~/Desktop/Umbraco/Umbraco.MCP/npm/vendor
```

Expected: `umbraco-automate-mcp-dev-17.0.0-beta.2.tgz` is created.

- [ ] **Step 7: Commit (local only)**

```bash
git add src/collections.ts package.json package-lock.json
git commit -m "feat: export createApiClient from ./collections for multi-MCP hosts; bump toolkit to beta.45"
```

---

# Phase 1: NuGet addon `Umbraco.Mcp`

All commands run from `~/Desktop/Umbraco/Umbraco.MCP`.

### Task 3: Solution scaffold, detector contract and `ProductDetectorBase`

**Files:**
- Create: `.gitignore`, `Directory.Packages.props`, `Umbraco.Mcp.slnx`
- Create: `src/Umbraco.Mcp/Umbraco.Mcp.csproj`
- Create: `src/Umbraco.Mcp/Detection/IMcpProductDetector.cs`, `McpProductStatus.cs`, `ILoadedAssemblyProvider.cs`, `IRegisteredApiProvider.cs`, `AssemblyVersionReader.cs`, `ProductDetectorBase.cs`
- Create: `tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`, `Fakes.cs`, `ProductDetectorBaseTests.cs`

**Interfaces:**
- Produces:
  - `public interface IMcpProductDetector { string Id { get; } string DisplayName { get; } McpProductStatus Detect(); }`
  - `public sealed record McpProductStatus(string Id, string DisplayName, bool Installed, bool Enabled, string? Version, IReadOnlyList<string> Issues);`
  - `public interface ILoadedAssemblyProvider { Assembly? Find(string assemblyName); }`
  - `public interface IRegisteredApiProvider { bool IsRegistered(string apiName); }`
  - `internal static class AssemblyVersionReader { public static string? Read(Assembly assembly); }`
  - `public abstract class ProductDetectorBase : IMcpProductDetector` with ctor `(ILoadedAssemblyProvider, IRegisteredApiProvider)`, abstract `Id`, `DisplayName`, `AssemblyName`, `ApiName`, and `protected virtual IEnumerable<string> GetIssues()`.

- [ ] **Step 1: Create `.gitignore`**

```gitignore
bin/
obj/
*.user
.vs/
.idea/
node_modules/
npm/dist/
npm/vendor/*.tgz
.env
appsettings.local.json
demo-site/umbraco/Data/
demo-site/umbraco/Logs/
demo-site/wwwroot/media/
coverage/
```

- [ ] **Step 2: Create `Directory.Packages.props`**

```xml
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Umbraco.Cms.Api.Management" Version="17.7.0" />
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="18.8.1" />
    <PackageVersion Include="NUnit" Version="3.14.0" />
    <PackageVersion Include="NUnit3TestAdapter" Version="6.2.0" />
  </ItemGroup>
</Project>
```

- [ ] **Step 3: Create `src/Umbraco.Mcp/Umbraco.Mcp.csproj`**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <PackageId>Umbraco.Mcp</PackageId>
    <Version>17.0.0-alpha.1</Version>
    <Description>Detects installed Umbraco HQ products for the Umbraco MCP and reports their health.</Description>
  </PropertyGroup>
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
    <PackageReference Include="Umbraco.Cms.Api.Management" />
  </ItemGroup>
  <ItemGroup>
    <InternalsVisibleTo Include="Umbraco.Mcp.Tests" />
  </ItemGroup>
</Project>
```

- [ ] **Step 4: Create `tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="NUnit" />
    <PackageReference Include="NUnit3TestAdapter" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/Umbraco.Mcp/Umbraco.Mcp.csproj" />
  </ItemGroup>
</Project>
```

- [ ] **Step 5: Create the solution**

```bash
dotnet new sln -n Umbraco.Mcp --format slnx
dotnet sln Umbraco.Mcp.slnx add src/Umbraco.Mcp/Umbraco.Mcp.csproj tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj
```

- [ ] **Step 6: Create the contract types**

`src/Umbraco.Mcp/Detection/IMcpProductDetector.cs`:

```csharp
namespace Umbraco.Mcp.Detection;

/// <summary>
/// Detects one Umbraco HQ product. <see cref="Id"/> must equal the matching npm module id (e.g. "forms").
/// </summary>
public interface IMcpProductDetector
{
    string Id { get; }

    string DisplayName { get; }

    McpProductStatus Detect();
}
```

`src/Umbraco.Mcp/Detection/McpProductStatus.cs`:

```csharp
namespace Umbraco.Mcp.Detection;

public sealed record McpProductStatus(
    string Id,
    string DisplayName,
    bool Installed,
    bool Enabled,
    string? Version,
    IReadOnlyList<string> Issues);
```

`src/Umbraco.Mcp/Detection/ILoadedAssemblyProvider.cs`:

```csharp
using System.Reflection;

namespace Umbraco.Mcp.Detection;

public interface ILoadedAssemblyProvider
{
    Assembly? Find(string assemblyName);
}

internal sealed class AppDomainLoadedAssemblyProvider : ILoadedAssemblyProvider
{
    public Assembly? Find(string assemblyName) =>
        AppDomain.CurrentDomain.GetAssemblies()
            .FirstOrDefault(a => string.Equals(a.GetName().Name, assemblyName, StringComparison.OrdinalIgnoreCase));
}
```

`src/Umbraco.Mcp/Detection/IRegisteredApiProvider.cs`:

```csharp
using System.Reflection;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Umbraco.Cms.Api.Common.Attributes;

namespace Umbraco.Mcp.Detection;

public interface IRegisteredApiProvider
{
    bool IsRegistered(string apiName);
}

/// <summary>
/// An API is "registered" when at least one live controller action maps to it via Umbraco's [MapToApi].
/// </summary>
internal sealed class ActionDescriptorRegisteredApiProvider(IActionDescriptorCollectionProvider actions) : IRegisteredApiProvider
{
    public bool IsRegistered(string apiName) =>
        actions.ActionDescriptors.Items
            .OfType<ControllerActionDescriptor>()
            .Any(d => d.ControllerTypeInfo
                .GetCustomAttributes<MapToApiAttribute>(inherit: true)
                .Any(a => string.Equals(a.ApiName, apiName, StringComparison.OrdinalIgnoreCase)));
}
```

`src/Umbraco.Mcp/Detection/AssemblyVersionReader.cs`:

```csharp
using System.Reflection;

namespace Umbraco.Mcp.Detection;

internal static class AssemblyVersionReader
{
    public static string? Read(Assembly assembly)
    {
        string? informational = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (!string.IsNullOrWhiteSpace(informational))
        {
            int plus = informational.IndexOf('+');
            return plus >= 0 ? informational[..plus] : informational;
        }

        return assembly.GetName().Version?.ToString(3);
    }
}
```

- [ ] **Step 7: Write the failing tests**

`tests/Umbraco.Mcp.Tests/Fakes.cs`:

```csharp
using System.Reflection;
using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.Tests;

internal sealed class FakeAssemblies(params (string Name, Assembly Assembly)[] loaded) : ILoadedAssemblyProvider
{
    public Assembly? Find(string assemblyName) =>
        loaded.FirstOrDefault(x => string.Equals(x.Name, assemblyName, StringComparison.OrdinalIgnoreCase)).Assembly;
}

internal sealed class FakeApis(params string[] registered) : IRegisteredApiProvider
{
    public bool IsRegistered(string apiName) => registered.Contains(apiName, StringComparer.OrdinalIgnoreCase);
}

internal sealed class TestDetector(ILoadedAssemblyProvider a, IRegisteredApiProvider r, params string[] extraIssues)
    : ProductDetectorBase(a, r)
{
    public override string Id => "test";
    public override string DisplayName => "Test Product";
    protected override string AssemblyName => "Test.Product.Core";
    protected override string ApiName => "test-management";
    protected override IEnumerable<string> GetIssues() => extraIssues;
}
```

`tests/Umbraco.Mcp.Tests/ProductDetectorBaseTests.cs`:

```csharp
using NUnit.Framework;
using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class ProductDetectorBaseTests
{
    private static readonly System.Reflection.Assembly AnyAssembly = typeof(Assert).Assembly;

    [Test]
    public void Not_installed_when_assembly_missing()
    {
        McpProductStatus s = new TestDetector(new FakeAssemblies(), new FakeApis("test-management")).Detect();

        Assert.That(s.Installed, Is.False);
        Assert.That(s.Enabled, Is.False);
        Assert.That(s.Version, Is.Null);
        Assert.That(s.Issues, Is.Empty);
    }

    [Test]
    public void Installed_and_enabled_when_assembly_loaded_and_api_registered()
    {
        McpProductStatus s = new TestDetector(
            new FakeAssemblies(("Test.Product.Core", AnyAssembly)),
            new FakeApis("test-management")).Detect();

        Assert.That(s.Installed, Is.True);
        Assert.That(s.Enabled, Is.True);
        Assert.That(s.Version, Is.Not.Null.And.Not.Contain("+"));
        Assert.That(s.Issues, Is.Empty);
        Assert.That(s.Id, Is.EqualTo("test"));
    }

    [Test]
    public void Installed_but_not_enabled_reports_issue_when_api_missing()
    {
        McpProductStatus s = new TestDetector(
            new FakeAssemblies(("Test.Product.Core", AnyAssembly)),
            new FakeApis()).Detect();

        Assert.That(s.Installed, Is.True);
        Assert.That(s.Enabled, Is.False);
        Assert.That(s.Issues, Has.Some.Contains("test-management"));
    }

    [Test]
    public void Product_specific_issues_are_appended()
    {
        McpProductStatus s = new TestDetector(
            new FakeAssemblies(("Test.Product.Core", AnyAssembly)),
            new FakeApis("test-management"),
            "Licence expired").Detect();

        Assert.That(s.Issues, Is.EqualTo(new[] { "Licence expired" }));
    }

    [Test]
    public void Version_reader_strips_build_metadata()
    {
        string? v = AssemblyVersionReader.Read(AnyAssembly);

        Assert.That(v, Is.Not.Null.And.Not.Contain("+"));
    }
}
```

- [ ] **Step 8: Run tests to verify they fail**

Run: `dotnet test Umbraco.Mcp.slnx`
Expected: build FAILS with `The type or namespace name 'ProductDetectorBase' could not be found`.

- [ ] **Step 9: Implement `src/Umbraco.Mcp/Detection/ProductDetectorBase.cs`**

```csharp
using System.Reflection;

namespace Umbraco.Mcp.Detection;

/// <summary>
/// Installed = <see cref="AssemblyName"/> is loaded. Enabled = the product's Management API (<see cref="ApiName"/>) is live.
/// Concrete detectors only declare these four values.
/// </summary>
public abstract class ProductDetectorBase : IMcpProductDetector
{
    private readonly ILoadedAssemblyProvider _assemblies;
    private readonly IRegisteredApiProvider _apis;

    protected ProductDetectorBase(ILoadedAssemblyProvider assemblies, IRegisteredApiProvider apis)
    {
        _assemblies = assemblies;
        _apis = apis;
    }

    public abstract string Id { get; }

    public abstract string DisplayName { get; }

    protected abstract string AssemblyName { get; }

    protected abstract string ApiName { get; }

    /// <summary>Extension point for product-specific checks (e.g. licence, main switch). Empty by default.</summary>
    protected virtual IEnumerable<string> GetIssues() => [];

    public McpProductStatus Detect()
    {
        Assembly? assembly = _assemblies.Find(AssemblyName);
        if (assembly is null)
        {
            return new McpProductStatus(Id, DisplayName, false, false, null, []);
        }

        bool enabled = _apis.IsRegistered(ApiName);
        var issues = new List<string>();
        if (!enabled)
        {
            issues.Add($"The {ApiName} Management API is not registered.");
        }

        issues.AddRange(GetIssues());

        return new McpProductStatus(Id, DisplayName, true, enabled, AssemblyVersionReader.Read(assembly), issues);
    }
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `dotnet test Umbraco.Mcp.slnx`
Expected: `Passed! - Failed: 0, Passed: 5`

- [ ] **Step 11: Commit**

```bash
git add .gitignore Directory.Packages.props Umbraco.Mcp.slnx src tests
git commit -m "feat(addon): scaffold Umbraco.Mcp with product detector contract and base"
```

### Task 4: Concrete detectors, capabilities service and composer

**Files:**
- Create: `src/Umbraco.Mcp/Detection/Detectors/CmsDetector.cs`, `FormsDetector.cs`, `AutomateDetector.cs`
- Create: `src/Umbraco.Mcp/Capabilities/McpCapabilities.cs`, `IMcpCapabilitiesService.cs`, `McpCapabilitiesService.cs`
- Create: `src/Umbraco.Mcp/McpComposer.cs`
- Test: `tests/Umbraco.Mcp.Tests/McpCapabilitiesServiceTests.cs`

**Interfaces:**
- Consumes: `ProductDetectorBase`, `IMcpProductDetector`, `McpProductStatus`, `AssemblyVersionReader` (Task 3).
- Produces:
  - `public sealed record McpCapabilities(string AddonVersion, IReadOnlyList<McpProductStatus> Products);`
  - `public interface IMcpCapabilitiesService { McpCapabilities GetCapabilities(); }`
  - `public sealed class McpCapabilitiesService(IEnumerable<IMcpProductDetector> detectors) : IMcpCapabilitiesService`
  - Detector ids: `"cms"`, `"forms"`, `"automate"`.

- [ ] **Step 1: Write the failing tests** in `tests/Umbraco.Mcp.Tests/McpCapabilitiesServiceTests.cs`

```csharp
using NUnit.Framework;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.Detection.Detectors;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpCapabilitiesServiceTests
{
    private sealed class ThrowingDetector : IMcpProductDetector
    {
        public string Id => "broken";
        public string DisplayName => "Broken Product";
        public McpProductStatus Detect() => throw new InvalidOperationException("boom");
    }

    [Test]
    public void Returns_one_status_per_detector_in_order_with_addon_version()
    {
        var assemblies = new FakeAssemblies(("Umbraco.Forms.Core", typeof(Assert).Assembly));
        var apis = new FakeApis("forms-management");
        var service = new McpCapabilitiesService(new IMcpProductDetector[]
        {
            new FormsDetector(assemblies, apis),
            new AutomateDetector(assemblies, apis),
        });

        McpCapabilities caps = service.GetCapabilities();

        Assert.That(caps.AddonVersion, Is.Not.Empty);
        Assert.That(caps.Products.Select(p => p.Id), Is.EqualTo(new[] { "forms", "automate" }));
        Assert.That(caps.Products[0].Installed && caps.Products[0].Enabled, Is.True);
        Assert.That(caps.Products[1].Installed, Is.False);
    }

    [Test]
    public void A_throwing_detector_becomes_an_issue_not_an_exception()
    {
        var service = new McpCapabilitiesService(new IMcpProductDetector[] { new ThrowingDetector() });

        McpProductStatus s = service.GetCapabilities().Products.Single();

        Assert.That(s.Installed, Is.False);
        Assert.That(s.Issues, Has.Some.Contains("boom"));
    }

    [Test]
    public void Detector_ids_match_npm_module_ids()
    {
        var a = new FakeAssemblies();
        var r = new FakeApis();
        Assert.That(new FormsDetector(a, r).Id, Is.EqualTo("forms"));
        Assert.That(new AutomateDetector(a, r).Id, Is.EqualTo("automate"));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test Umbraco.Mcp.slnx`
Expected: build FAILS (`McpCapabilitiesService`, `FormsDetector` not found).

- [ ] **Step 3: Implement the detectors**

`src/Umbraco.Mcp/Detection/Detectors/FormsDetector.cs`:

```csharp
namespace Umbraco.Mcp.Detection.Detectors;

public sealed class FormsDetector(ILoadedAssemblyProvider assemblies, IRegisteredApiProvider apis)
    : ProductDetectorBase(assemblies, apis)
{
    public override string Id => "forms";
    public override string DisplayName => "Umbraco Forms";
    protected override string AssemblyName => "Umbraco.Forms.Core";
    protected override string ApiName => "forms-management";
}
```

`src/Umbraco.Mcp/Detection/Detectors/AutomateDetector.cs`:

```csharp
namespace Umbraco.Mcp.Detection.Detectors;

public sealed class AutomateDetector(ILoadedAssemblyProvider assemblies, IRegisteredApiProvider apis)
    : ProductDetectorBase(assemblies, apis)
{
    public override string Id => "automate";
    public override string DisplayName => "Umbraco Automate";
    protected override string AssemblyName => "Umbraco.Automate.Core";
    protected override string ApiName => "automate-management";
}
```

`src/Umbraco.Mcp/Detection/Detectors/CmsDetector.cs`:

```csharp
using Umbraco.Cms.Core.Configuration;

namespace Umbraco.Mcp.Detection.Detectors;

/// <summary>The CMS is always present when this addon runs.</summary>
public sealed class CmsDetector(IUmbracoVersion umbracoVersion) : IMcpProductDetector
{
    public string Id => "cms";
    public string DisplayName => "Umbraco CMS";

    public McpProductStatus Detect() =>
        new(Id, DisplayName, true, true, umbracoVersion.Version.ToString(3), []);
}
```

- [ ] **Step 4: Implement the capabilities types and service**

`src/Umbraco.Mcp/Capabilities/McpCapabilities.cs`:

```csharp
using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.Capabilities;

public sealed record McpCapabilities(string AddonVersion, IReadOnlyList<McpProductStatus> Products);
```

`src/Umbraco.Mcp/Capabilities/IMcpCapabilitiesService.cs`:

```csharp
namespace Umbraco.Mcp.Capabilities;

public interface IMcpCapabilitiesService
{
    McpCapabilities GetCapabilities();
}
```

`src/Umbraco.Mcp/Capabilities/McpCapabilitiesService.cs`:

```csharp
using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.Capabilities;

public sealed class McpCapabilitiesService(IEnumerable<IMcpProductDetector> detectors) : IMcpCapabilitiesService
{
    private static readonly string AddonVersion =
        AssemblyVersionReader.Read(typeof(McpCapabilitiesService).Assembly) ?? "0.0.0";

    public McpCapabilities GetCapabilities() =>
        new(AddonVersion, detectors.Select(SafeDetect).ToList());

    private static McpProductStatus SafeDetect(IMcpProductDetector detector)
    {
        try
        {
            return detector.Detect();
        }
        catch (Exception ex)
        {
            return new McpProductStatus(detector.Id, detector.DisplayName, false, false, null, [$"Detection failed: {ex.Message}"]);
        }
    }
}
```

- [ ] **Step 5: Implement `src/Umbraco.Mcp/McpComposer.cs`**

```csharp
using Microsoft.Extensions.DependencyInjection;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.Detection.Detectors;

namespace Umbraco.Mcp;

public sealed class McpComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        builder.Services.AddSingleton<ILoadedAssemblyProvider, AppDomainLoadedAssemblyProvider>();
        builder.Services.AddSingleton<IRegisteredApiProvider, ActionDescriptorRegisteredApiProvider>();

        // One line per product. Order here is the order products appear in capabilities and health.
        builder.Services.AddSingleton<IMcpProductDetector, CmsDetector>();
        builder.Services.AddSingleton<IMcpProductDetector, FormsDetector>();
        builder.Services.AddSingleton<IMcpProductDetector, AutomateDetector>();

        builder.Services.AddSingleton<IMcpCapabilitiesService, McpCapabilitiesService>();
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `dotnet test Umbraco.Mcp.slnx`
Expected: `Passed! - Failed: 0, Passed: 8`

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat(addon): add CMS/Forms/Automate detectors, capabilities service and composer"
```

### Task 5: Capabilities Management API endpoint

**Files:**
- Create: `src/Umbraco.Mcp/Api/McpCapabilitiesController.cs`
- Test: `tests/Umbraco.Mcp.Tests/McpCapabilitiesControllerTests.cs`

**Interfaces:**
- Consumes: `IMcpCapabilitiesService`, `McpCapabilities` (Task 4).
- Produces: `GET /umbraco/management/api/v1/mcp/capabilities` → 200 JSON `{ "addonVersion": string, "products": [{ "id", "displayName", "installed", "enabled", "version", "issues" }] }` (camelCase via the Management API's JSON options). Requires an authenticated backoffice user.

- [ ] **Step 1: Write the failing test**

```csharp
using Microsoft.AspNetCore.Mvc;
using NUnit.Framework;
using Umbraco.Mcp.Api;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpCapabilitiesControllerTests
{
    private sealed class StubService(McpCapabilities caps) : IMcpCapabilitiesService
    {
        public McpCapabilities GetCapabilities() => caps;
    }

    [Test]
    public void Get_returns_ok_with_service_result()
    {
        var caps = new McpCapabilities("17.0.0", [new McpProductStatus("cms", "Umbraco CMS", true, true, "17.7.0", [])]);
        var controller = new McpCapabilitiesController(new StubService(caps));

        IActionResult result = controller.GetCapabilities();

        Assert.That(result, Is.InstanceOf<OkObjectResult>());
        Assert.That(((OkObjectResult)result).Value, Is.SameAs(caps));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test Umbraco.Mcp.slnx --filter McpCapabilitiesControllerTests`
Expected: build FAILS (`McpCapabilitiesController` not found).

- [ ] **Step 3: Implement the controller**

```csharp
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.Capabilities;

namespace Umbraco.Mcp.Api;

[ApiVersion("1.0")]
[VersionedApiBackOfficeRoute("mcp")]
[ApiExplorerSettings(GroupName = "MCP")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess)]
public sealed class McpCapabilitiesController(IMcpCapabilitiesService capabilities) : ManagementApiControllerBase
{
    [HttpGet("capabilities")]
    [MapToApiVersion("1.0")]
    [ProducesResponseType(typeof(McpCapabilities), StatusCodes.Status200OK)]
    public IActionResult GetCapabilities() => Ok(capabilities.GetCapabilities());
}
```

If the build reports that `VersionedApiBackOfficeRouteAttribute` or `ManagementApiControllerBase` is not found, look up their namespaces in `Umbraco.Cms.Api.Management` 17.7.0 (IDE "Go to definition", or the Umbraco 17 docs page "Creating a Backoffice API") and fix only the `using` lines.

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test Umbraco.Mcp.slnx`
Expected: `Passed! - Failed: 0, Passed: 9`

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(addon): add GET /umbraco/management/api/v1/mcp/capabilities"
```

### Task 6: "MCP" backoffice health check group

**Files:**
- Create: `src/Umbraco.Mcp/HealthChecks/McpProductsHealthCheck.cs`
- Test: `tests/Umbraco.Mcp.Tests/McpProductsHealthCheckTests.cs`

**Interfaces:**
- Consumes: `IMcpCapabilitiesService`, `McpCapabilities`, `McpProductStatus`.
- Produces: health check group `"MCP"`, check id `6f1d2c3a-8b47-4e2a-9c51-3d7e0b9a4f12`; `internal static IEnumerable<HealthCheckStatus> BuildStatuses(McpCapabilities caps)`.

- [ ] **Step 1: Write the failing tests**

```csharp
using NUnit.Framework;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.HealthChecks;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpProductsHealthCheckTests
{
    private static List<HealthCheckStatus> Build(params McpProductStatus[] products) =>
        McpProductsHealthCheck.BuildStatuses(new McpCapabilities("17.0.0", products)).ToList();

    [Test]
    public void First_row_is_addon_version_info()
    {
        HealthCheckStatus first = Build().First();

        Assert.That(first.ResultType, Is.EqualTo(StatusResultType.Info));
        Assert.That(first.Message, Does.Contain("17.0.0"));
    }

    [Test]
    public void Installed_and_enabled_is_success()
    {
        HealthCheckStatus row = Build(new McpProductStatus("forms", "Umbraco Forms", true, true, "17.6.1", []))[1];

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Success));
        Assert.That(row.Message, Does.Contain("Umbraco Forms").And.Contain("17.6.1"));
    }

    [Test]
    public void Installed_with_issues_is_warning_listing_issues()
    {
        HealthCheckStatus row = Build(new McpProductStatus("forms", "Umbraco Forms", true, false, "17.6.1",
            ["The forms-management Management API is not registered."]))[1];

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Warning));
        Assert.That(row.Message, Does.Contain("forms-management"));
    }

    [Test]
    public void Not_installed_is_info()
    {
        HealthCheckStatus row = Build(new McpProductStatus("automate", "Umbraco Automate", false, false, null, []))[1];

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Info));
        Assert.That(row.Message, Does.Contain("not installed"));
    }

    [Test]
    public void Failed_detection_is_warning()
    {
        HealthCheckStatus row = Build(new McpProductStatus("broken", "Broken", false, false, null, ["Detection failed: boom"]))[1];

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Warning));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test Umbraco.Mcp.slnx --filter McpProductsHealthCheckTests`
Expected: build FAILS (`McpProductsHealthCheck` not found).

- [ ] **Step 3: Implement the health check**

```csharp
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.Capabilities;

namespace Umbraco.Mcp.HealthChecks;

[HealthCheck(
    "6f1d2c3a-8b47-4e2a-9c51-3d7e0b9a4f12",
    "MCP products",
    Description = "Shows which Umbraco HQ products the Umbraco MCP can see on this site and whether their APIs are available.",
    Group = "MCP")]
public sealed class McpProductsHealthCheck(IMcpCapabilitiesService capabilities) : HealthCheck
{
    public override Task<IEnumerable<HealthCheckStatus>> GetStatusAsync() =>
        Task.FromResult(BuildStatuses(capabilities.GetCapabilities()));

    public override HealthCheckStatus ExecuteAction(HealthCheckAction action) =>
        throw new InvalidOperationException("The MCP products health check has no actions.");

    internal static IEnumerable<HealthCheckStatus> BuildStatuses(McpCapabilities caps)
    {
        var rows = new List<HealthCheckStatus>
        {
            new($"Umbraco.Mcp {caps.AddonVersion} is installed.") { ResultType = StatusResultType.Info },
        };

        foreach (var p in caps.Products)
        {
            string name = p.Version is null ? p.DisplayName : $"{p.DisplayName} {p.Version}";

            if (!p.Installed && p.Issues.Count == 0)
            {
                rows.Add(new($"{p.DisplayName} is not installed.") { ResultType = StatusResultType.Info });
            }
            else if (p.Installed && p.Enabled && p.Issues.Count == 0)
            {
                rows.Add(new($"{name} is installed and its API is available.") { ResultType = StatusResultType.Success });
            }
            else
            {
                string detail = p.Issues.Count > 0 ? string.Join(" ", p.Issues) : "Installed, but its API is not available.";
                rows.Add(new($"{name}: {detail}") { ResultType = StatusResultType.Warning });
            }
        }

        return rows;
    }
}
```

- [ ] **Step 4: Run all tests**

Run: `dotnet test Umbraco.Mcp.slnx`
Expected: `Passed! - Failed: 0, Passed: 14`

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(addon): add MCP products backoffice health check"
```

---

# Phase 2: npm package `@umbraco/mcp`

All commands run from `~/Desktop/Umbraco/Umbraco.MCP/npm` unless stated otherwise.

### Task 7: npm scaffold, module contract and client context

**Files:**
- Create: `npm/package.json`, `npm/tsconfig.json`, `npm/tsup.config.ts`, `npm/jest.config.ts`
- Create: `npm/src/core/module-contract.ts`, `npm/src/core/client-context.ts`
- Test: `npm/src/core/__tests__/client-context.test.ts`

**Interfaces:**
- Produces:
  - `interface LoadedModule { collections: ToolCollectionExport[]; allModes: ToolModeDefinition[]; allModeNames: readonly string[]; allSliceNames: readonly string[]; createApiClient: () => unknown }`
  - `interface McpProductModule { id: string; displayName: string; toolPrefix: string; packageName: string; expectedMajor: string; description: string; useWhen: string[]; required?: boolean; load(): Promise<LoadedModule> }`
  - `installClientContext(defaultFactory: () => unknown): void`
  - `bindClient<A extends unknown[], R>(factory: () => unknown, handler: (...args: A) => R): (...args: A) => R`

- [ ] **Step 1: Create `npm/package.json`**

```json
{
  "name": "@umbraco/mcp",
  "version": "17.0.0-alpha.1",
  "description": "One MCP server for an Umbraco site: loads tools for the HQ products the site has installed.",
  "type": "module",
  "private": true,
  "bin": { "umbraco-mcp": "./dist/index.js" },
  "main": "dist/index.js",
  "files": ["dist"],
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "build": "tsup --config tsup.config.ts",
    "compile": "tsc --noEmit",
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand",
    "list-tools": "node --env-file=.env dist/index.js --list-tools"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@umbraco-cms/mcp-server-sdk": "1.0.0-beta.45",
    "@umbraco-cms/mcp-dev": "17.6.10",
    "@umbraco-forms/mcp-dev": "file:vendor/umbraco-forms-mcp-dev-17.6.1-beta.1.tgz",
    "@umbraco-automate/mcp-dev": "file:vendor/umbraco-automate-mcp-dev-17.0.0-beta.2.tgz",
    "zod": "^4.4.3"
  },
  "overrides": {
    "@umbraco-cms/mcp-server-sdk": "$@umbraco-cms/mcp-server-sdk"
  },
  "devDependencies": {
    "@types/jest": "^30.0.0",
    "@types/node": "^26.1.2",
    "jest": "^30.4.2",
    "ts-jest": "^29.4.11",
    "tsup": "^8.4.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Create `npm/tsconfig.json`, `npm/tsup.config.ts`, `npm/jest.config.ts`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["node", "jest"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

```ts
// npm/tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  dts: false,
  // dependencies stay external (tsup default), so product packages are resolved from node_modules at runtime
});
```

```ts
// npm/jest.config.ts
import type { JestConfigWithTsJest } from "ts-jest";

const config: JestConfigWithTsJest = {
  preset: "ts-jest/presets/js-with-ts-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: { "^.+\\.tsx?$": ["ts-jest", { useESM: true }] },
  testMatch: ["**/__tests__/**/*.test.ts"],
  testTimeout: 30000,
};

export default config;
```

- [ ] **Step 3: Install**

Run: `npm install`
Expected: exit 0. Then `npm ls @umbraco-cms/mcp-server-sdk` lists **only** `1.0.0-beta.45` (deduped) under every product. If any other version appears, stop: the Phase 0 tarballs are missing or stale.

- [ ] **Step 4: Create `npm/src/core/module-contract.ts`**

```ts
import type { ToolCollectionExport, ToolModeDefinition } from "@umbraco-cms/mcp-server-sdk";

/** What a product package's `./collections` entry point provides once loaded. */
export interface LoadedModule {
  collections: ToolCollectionExport[];
  allModes: ToolModeDefinition[];
  allModeNames: readonly string[];
  allSliceNames: readonly string[];
  /** The product's Orval API client factory. Bound per tool call by the client context. */
  createApiClient: () => unknown;
}

/** One HQ product. Adding a product = one file implementing this + one entry in modules/index.ts. */
export interface McpProductModule {
  /** Matches the .NET detector Id. Lowercase, e.g. "forms". */
  id: string;
  displayName: string;
  /** Always `${id}--`. Applied to every tool name. */
  toolPrefix: string;
  /** npm package that provides `./collections`, e.g. "@umbraco-forms/mcp-dev". */
  packageName: string;
  /** Product major this release line supports, e.g. "17". */
  expectedMajor: string;
  /** One sentence starting with the display name: what this product is. Used in routing instructions. */
  description: string;
  /** Short phrases for the requests this product handles. Disambiguate words shared with other products here. */
  useWhen: string[];
  /** Required modules load even without capabilities (CMS only). */
  required?: boolean;
  /** Dynamic import so absent products are never loaded. */
  load(): Promise<LoadedModule>;
}
```

- [ ] **Step 5: Write the failing test** `npm/src/core/__tests__/client-context.test.ts`

```ts
import { getApiClient } from "@umbraco-cms/mcp-server-sdk";
import { bindClient, installClientContext } from "../client-context.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("client context", () => {
  beforeEach(() => installClientContext(() => "default-client"));

  it("falls back to the default client outside any bound call", () => {
    expect(getApiClient()).toBe("default-client");
  });

  it("gives each concurrent, interleaved call its own client", async () => {
    const slowForms = bindClient(() => "forms-client", async () => {
      await sleep(20);
      return getApiClient();
    });
    const fastAutomate = bindClient(() => "automate-client", async () => {
      await sleep(5);
      const first = getApiClient();
      await sleep(20);
      return [first, getApiClient()];
    });

    const [forms, automate] = await Promise.all([slowForms(), fastAutomate()]);

    expect(forms).toBe("forms-client");
    expect(automate).toEqual(["automate-client", "automate-client"]);
    expect(getApiClient()).toBe("default-client");
  });

  it("passes arguments and return values through", async () => {
    const handler = bindClient(() => "x", async (a: number, b: number) => a + b);
    await expect(handler(2, 3)).resolves.toBe(5);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- client-context`
Expected: FAIL with `Cannot find module '../client-context.js'`.

- [ ] **Step 7: Implement `npm/src/core/client-context.ts`**

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { configureApiClient } from "@umbraco-cms/mcp-server-sdk";

/**
 * The toolkit keeps ONE global API client provider. Several products share a process here, so the
 * provider reads the current product's factory from AsyncLocalStorage, which follows each call across awaits.
 */
const clientContext = new AsyncLocalStorage<() => unknown>();

export function installClientContext(defaultFactory: () => unknown): void {
  configureApiClient(() => (clientContext.getStore() ?? defaultFactory)());
}

export function bindClient<A extends unknown[], R>(
  factory: () => unknown,
  handler: (...args: A) => R,
): (...args: A) => R {
  return (...args: A) => clientContext.run(factory, () => handler(...args));
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npm test -- client-context && npm run compile`
Expected: 3 passed; compile exit 0.

- [ ] **Step 9: Commit**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
git add npm/package.json npm/package-lock.json npm/tsconfig.json npm/tsup.config.ts npm/jest.config.ts npm/src
git commit -m "feat(npm): scaffold @umbraco/mcp with module contract and per-call client context"
```

### Task 8: Capabilities client

**Files:**
- Create: `npm/src/core/capabilities.ts`
- Test: `npm/src/core/__tests__/capabilities.test.ts`

**Interfaces:**
- Produces:
  - `CAPABILITIES_PATH = "/umbraco/management/api/v1/mcp/capabilities"`
  - `interface ProductCapability { id: string; displayName: string; installed: boolean; enabled: boolean; version: string | null; issues: string[] }`
  - `interface CapabilitiesPayload { addonVersion: string; products: ProductCapability[] }`
  - `type CapabilitiesResult = { kind: "ok"; payload: CapabilitiesPayload } | { kind: "no-addon" } | { kind: "unavailable"; reason: string }`
  - `interpretCapabilitiesResponse(res: { status: number; data: unknown }): CapabilitiesResult`
  - `fetchCapabilities(request?: () => Promise<{ status: number; data: unknown }>): Promise<CapabilitiesResult>`

- [ ] **Step 1: Write the failing tests**

```ts
import { fetchCapabilities, interpretCapabilitiesResponse } from "../capabilities.js";

const payload = {
  addonVersion: "17.0.0",
  products: [
    { id: "cms", displayName: "Umbraco CMS", installed: true, enabled: true, version: "17.7.0", issues: [] },
    { id: "forms", displayName: "Umbraco Forms", installed: true, enabled: true, version: "17.6.1", issues: [] },
  ],
};

describe("interpretCapabilitiesResponse", () => {
  it("accepts a valid 200 payload", () => {
    expect(interpretCapabilitiesResponse({ status: 200, data: payload })).toEqual({ kind: "ok", payload });
  });

  it("maps 404 to no-addon", () => {
    expect(interpretCapabilitiesResponse({ status: 404, data: "" })).toEqual({ kind: "no-addon" });
  });

  it.each([401, 403, 500, 503])("maps %i to unavailable with the status in the reason", (status) => {
    const r = interpretCapabilitiesResponse({ status, data: null });
    expect(r.kind).toBe("unavailable");
    expect(r.kind === "unavailable" && r.reason).toContain(String(status));
  });

  // Review Focus 2: a 200 that is not capabilities
  it.each([
    ["html login page", "<html>login</html>"],
    ["empty object", {}],
    ["products not an array", { addonVersion: "1", products: "x" }],
    ["product missing id", { addonVersion: "1", products: [{ installed: true }] }],
  ])("treats a malformed 200 (%s) as unavailable", (_label, data) => {
    const r = interpretCapabilitiesResponse({ status: 200, data });
    expect(r.kind).toBe("unavailable");
    expect(r.kind === "unavailable" && r.reason).toMatch(/unexpected/i);
  });
});

describe("fetchCapabilities", () => {
  it("turns a thrown network error into unavailable", async () => {
    const r = await fetchCapabilities(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(r).toEqual({ kind: "unavailable", reason: "Request failed: ECONNREFUSED" });
  });

  it("uses the injected request result", async () => {
    await expect(fetchCapabilities(async () => ({ status: 404, data: "" }))).resolves.toEqual({ kind: "no-addon" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- capabilities`
Expected: FAIL with `Cannot find module '../capabilities.js'`.

- [ ] **Step 3: Implement `npm/src/core/capabilities.ts`**

```ts
import { CAPTURE_RAW_HTTP_RESPONSE, UmbracoManagementClient, type HttpResponse } from "@umbraco-cms/mcp-server-sdk";

export const CAPABILITIES_PATH = "/umbraco/management/api/v1/mcp/capabilities";

export interface ProductCapability {
  id: string;
  displayName: string;
  installed: boolean;
  enabled: boolean;
  version: string | null;
  issues: string[];
}

export interface CapabilitiesPayload {
  addonVersion: string;
  products: ProductCapability[];
}

export type CapabilitiesResult =
  | { kind: "ok"; payload: CapabilitiesPayload }
  | { kind: "no-addon" }
  | { kind: "unavailable"; reason: string };

type RawResponse = { status: number; data: unknown };

const isProduct = (p: unknown): p is ProductCapability => {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.displayName === "string" &&
    typeof o.installed === "boolean" &&
    typeof o.enabled === "boolean" &&
    (o.version === null || typeof o.version === "string") &&
    Array.isArray(o.issues)
  );
};

const isPayload = (d: unknown): d is CapabilitiesPayload => {
  if (typeof d !== "object" || d === null) return false;
  const o = d as Record<string, unknown>;
  return typeof o.addonVersion === "string" && Array.isArray(o.products) && o.products.every(isProduct);
};

export function interpretCapabilitiesResponse(res: RawResponse): CapabilitiesResult {
  if (res.status === 404) return { kind: "no-addon" };
  if (res.status !== 200) return { kind: "unavailable", reason: `Capabilities endpoint returned HTTP ${res.status}.` };
  if (!isPayload(res.data)) return { kind: "unavailable", reason: "Capabilities endpoint returned an unexpected response." };
  return { kind: "ok", payload: res.data };
}

const defaultRequest = async (): Promise<RawResponse> =>
  (await UmbracoManagementClient<unknown>(
    { url: CAPABILITIES_PATH, method: "GET" },
    CAPTURE_RAW_HTTP_RESPONSE,
  )) as unknown as HttpResponse<unknown>;

export async function fetchCapabilities(request: () => Promise<RawResponse> = defaultRequest): Promise<CapabilitiesResult> {
  try {
    return interpretCapabilitiesResponse(await request());
  } catch (error) {
    return { kind: "unavailable", reason: `Request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- capabilities && npm run compile`
Expected: all pass; compile exit 0.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
git add npm/src
git commit -m "feat(npm): add capabilities client with validation and fallbacks"
```

### Task 9: Module selection and per-module filter config

**Files:**
- Create: `npm/src/core/module-selection.ts`, `npm/src/core/filter-config.ts`
- Test: `npm/src/core/__tests__/module-selection.test.ts`, `npm/src/core/__tests__/filter-config.test.ts`

**Interfaces:**
- Consumes: `McpProductModule` (Task 7), `CapabilitiesResult`, `ProductCapability` (Task 8).
- Produces:
  - `parseForcedModules(value: string | undefined): string[]`
  - `majorOf(version: string | null): string | null`
  - `interface ModuleDecision { module: McpProductModule; product: ProductCapability | null; load: boolean; reason: string }`
  - `selectModules(modules: McpProductModule[], capabilities: CapabilitiesResult, forced: string[]): ModuleDecision[]`
  - `buildModuleFilterInput(env: NodeJS.ProcessEnv, moduleId: string, isDefaultModule: boolean): ServerConfigForCollections`

- [ ] **Step 1: Write the failing selection tests**

```ts
import type { McpProductModule } from "../module-contract.js";
import type { CapabilitiesResult, ProductCapability } from "../capabilities.js";
import { majorOf, parseForcedModules, selectModules } from "../module-selection.js";

const mod = (id: string, required = false): McpProductModule => ({
  id, displayName: id, toolPrefix: `${id}--`, packageName: `@x/${id}`, expectedMajor: "17", description: `${id} description`, useWhen: [`${id} requests`], required,
  load: async () => { throw new Error("not used"); },
});
const product = (id: string, over: Partial<ProductCapability> = {}): ProductCapability => ({
  id, displayName: id, installed: true, enabled: true, version: "17.1.0", issues: [], ...over,
});
const ok = (...products: ProductCapability[]): CapabilitiesResult => ({ kind: "ok", payload: { addonVersion: "17.0.0", products } });
const modules = [mod("cms", true), mod("forms"), mod("automate")];
const decision = (ds: ReturnType<typeof selectModules>, id: string) => ds.find((d) => d.module.id === id)!;

describe("selectModules", () => {
  it("always loads required modules, even without capabilities", () => {
    const ds = selectModules(modules, { kind: "no-addon" }, []);
    expect(decision(ds, "cms").load).toBe(true);
    expect(decision(ds, "forms").load).toBe(false);
    expect(decision(ds, "forms").reason).toMatch(/Umbraco\.Mcp addon is not installed/);
  });

  it("loads installed and enabled products with a matching major", () => {
    const ds = selectModules(modules, ok(product("cms"), product("forms"), product("automate", { installed: false, enabled: false, version: null })), []);
    expect(decision(ds, "forms").load).toBe(true);
    expect(decision(ds, "automate").load).toBe(false);
    expect(decision(ds, "automate").reason).toMatch(/not installed/);
  });

  it("skips installed-but-disabled products", () => {
    const ds = selectModules(modules, ok(product("forms", { enabled: false })), []);
    expect(decision(ds, "forms").load).toBe(false);
    expect(decision(ds, "forms").reason).toMatch(/not enabled/);
  });

  // Review Focus 3: odd versions
  it.each([
    ["17.6.1-beta.1+abc", true],
    ["v17.2.0", true],
    ["18.0.0", false],
  ])("version %s -> load=%s", (version, load) => {
    const ds = selectModules(modules, ok(product("forms", { version })), []);
    expect(decision(ds, "forms").load).toBe(load);
  });

  it("skips an installed product with an unknown version", () => {
    const ds = selectModules(modules, ok(product("forms", { version: null })), []);
    expect(decision(ds, "forms").load).toBe(false);
    expect(decision(ds, "forms").reason).toMatch(/unknown version/);
  });

  it("forced modules load regardless of capabilities", () => {
    const ds = selectModules(modules, { kind: "unavailable", reason: "HTTP 500" }, ["automate"]);
    expect(decision(ds, "automate").load).toBe(true);
    expect(decision(ds, "automate").reason).toMatch(/UMBRACO_MCP_MODULES/);
    expect(decision(ds, "forms").reason).toMatch(/HTTP 500/);
  });
});

describe("parseForcedModules", () => {
  // Review Focus 4
  it("normalises case, whitespace and empties", () => {
    expect(parseForcedModules(" Forms, ,automate,engage ")).toEqual(["forms", "automate", "engage"]);
  });
  it("returns [] for undefined or blank", () => {
    expect(parseForcedModules(undefined)).toEqual([]);
    expect(parseForcedModules("  ")).toEqual([]);
  });
});

describe("majorOf", () => {
  it.each([["17.6.1", "17"], ["v17", "17"], ["17", "17"], [null, null], ["abc", null]])("%s -> %s", (v, m) => {
    expect(majorOf(v)).toBe(m);
  });
});
```

- [ ] **Step 2: Write the failing filter tests**

```ts
import { buildModuleFilterInput } from "../filter-config.js";

describe("buildModuleFilterInput", () => {
  const env = {
    UMBRACO_TOOL_MODES: "content, forms:forms, engage:analytics",
    UMBRACO_INCLUDE_TOOL_COLLECTIONS: "automate:*",
    UMBRACO_EXCLUDE_TOOLS: "delete-document, forms:delete-form",
    UMBRACO_INCLUDE_SLICES: "read,list",
  };

  it("unprefixed entries apply to the default (CMS) module only", () => {
    const cms = buildModuleFilterInput(env, "cms", true);
    expect(cms.toolModes).toEqual(["content"]);
    expect(cms.excludeTools).toEqual(["delete-document"]);
  });

  it("prefixed entries apply to their module, with the prefix stripped", () => {
    const forms = buildModuleFilterInput(env, "forms", false);
    expect(forms.toolModes).toEqual(["forms"]);
    expect(forms.excludeTools).toEqual(["delete-form"]);
  });

  it("module:* means no restriction for that list", () => {
    expect(buildModuleFilterInput(env, "automate", false).includeToolCollections).toBeUndefined();
  });

  it("slices apply to every module", () => {
    expect(buildModuleFilterInput(env, "automate", false).includeSlices).toEqual(["read", "list"]);
    expect(buildModuleFilterInput(env, "cms", true).includeSlices).toEqual(["read", "list"]);
  });

  // Review Focus 5
  it("ignores entries for unknown or other modules", () => {
    const automate = buildModuleFilterInput(env, "automate", false);
    expect(automate.toolModes).toBeUndefined();
    expect(automate.excludeTools).toBeUndefined();
  });

  it("returns an empty config when no vars are set", () => {
    expect(buildModuleFilterInput({}, "cms", true)).toEqual({});
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- module-selection filter-config`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 4: Implement `npm/src/core/module-selection.ts`**

```ts
import type { CapabilitiesResult, ProductCapability } from "./capabilities.js";
import type { McpProductModule } from "./module-contract.js";

export interface ModuleDecision {
  module: McpProductModule;
  product: ProductCapability | null;
  load: boolean;
  reason: string;
}

export function parseForcedModules(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function majorOf(version: string | null): string | null {
  const match = version?.match(/^v?(\d+)/i);
  return match ? match[1] : null;
}

export function selectModules(
  modules: McpProductModule[],
  capabilities: CapabilitiesResult,
  forced: string[],
): ModuleDecision[] {
  return modules.map((module) => {
    const product =
      capabilities.kind === "ok" ? capabilities.payload.products.find((p) => p.id === module.id) ?? null : null;
    const decide = (load: boolean, reason: string): ModuleDecision => ({ module, product, load, reason });

    if (module.required) return decide(true, "Required module.");
    if (forced.includes(module.id)) return decide(true, "Forced on via UMBRACO_MCP_MODULES.");
    if (capabilities.kind === "no-addon") {
      return decide(false, "The Umbraco.Mcp addon is not installed on the site, so products cannot be detected.");
    }
    if (capabilities.kind === "unavailable") return decide(false, `Capabilities unavailable: ${capabilities.reason}`);
    if (!product || !product.installed) return decide(false, `${module.displayName} is not installed on the site.`);
    if (!product.enabled) return decide(false, `${module.displayName} is installed but not enabled.`);
    const major = majorOf(product.version);
    if (major === null) return decide(false, `${module.displayName} is installed with an unknown version.`);
    if (major !== module.expectedMajor) {
      return decide(false, `${module.displayName} ${product.version} does not match supported major ${module.expectedMajor}.`);
    }
    return decide(true, `${module.displayName} is installed and enabled.`);
  });
}
```

- [ ] **Step 5: Implement `npm/src/core/filter-config.ts`**

```ts
import type { ServerConfigForCollections } from "@umbraco-cms/mcp-server-sdk";

/** Lists that accept `module:` prefixes. Unprefixed entries belong to the default (CMS) module. */
const MODULE_SCOPED = {
  toolModes: "UMBRACO_TOOL_MODES",
  includeToolCollections: "UMBRACO_INCLUDE_TOOL_COLLECTIONS",
  excludeToolCollections: "UMBRACO_EXCLUDE_TOOL_COLLECTIONS",
  includeTools: "UMBRACO_INCLUDE_TOOLS",
  excludeTools: "UMBRACO_EXCLUDE_TOOLS",
} as const;

/** Lists that apply to every module unchanged. */
const GLOBAL = {
  includeSlices: "UMBRACO_INCLUDE_SLICES",
  excludeSlices: "UMBRACO_EXCLUDE_SLICES",
} as const;

const split = (value: string | undefined) =>
  (value ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);

function entriesFor(value: string | undefined, moduleId: string, isDefaultModule: boolean): string[] | undefined {
  const mine: string[] = [];
  for (const entry of split(value)) {
    const colon = entry.indexOf(":");
    if (colon === -1) {
      if (isDefaultModule) mine.push(entry);
      continue;
    }
    if (entry.slice(0, colon).toLowerCase() !== moduleId) continue;
    const item = entry.slice(colon + 1);
    if (item === "*") return undefined; // no restriction for this module
    mine.push(item);
  }
  return mine.length > 0 ? mine : undefined;
}

export function buildModuleFilterInput(
  env: NodeJS.ProcessEnv,
  moduleId: string,
  isDefaultModule: boolean,
): ServerConfigForCollections {
  const config: ServerConfigForCollections = {};
  for (const [key, envName] of Object.entries(MODULE_SCOPED) as [keyof typeof MODULE_SCOPED, string][]) {
    const entries = entriesFor(env[envName], moduleId, isDefaultModule);
    if (entries) config[key] = entries;
  }
  for (const [key, envName] of Object.entries(GLOBAL) as [keyof typeof GLOBAL, string][]) {
    const entries = split(env[envName]);
    if (entries.length > 0) config[key] = entries;
  }
  return config;
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- module-selection filter-config && npm run compile`
Expected: all pass; compile exit 0.

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
git add npm/src
git commit -m "feat(npm): add capability-driven module selection and module-scoped filters"
```

### Task 10: Routing instructions and tool description prefix

**Files:**
- Create: `npm/src/core/routing.ts`
- Test: `npm/src/core/__tests__/routing.test.ts`

**Interfaces:**
- Consumes: `McpProductModule` (Task 7).
- Produces:
  - `HEALTH_TOOL_NAME = "get-mcp-health"` (single source; `health.ts` re-exports it)
  - `describeTool(module: Pick<McpProductModule, "displayName">, description: string): string` returns `"[<displayName>] <description>"`
  - `buildRoutingInstructions(modules: McpProductModule[], extras?: Array<string | null>): string`

- [ ] **Step 1: Write the failing tests** `npm/src/core/__tests__/routing.test.ts`

```ts
import type { McpProductModule } from "../module-contract.js";
import { HEALTH_TOOL_NAME, buildRoutingInstructions, describeTool } from "../routing.js";

const mod = (id: string, useWhen: string[]): McpProductModule => ({
  id, displayName: `Umbraco ${id}`, toolPrefix: `${id}--`, packageName: `@x/${id}`, expectedMajor: "17",
  description: `Umbraco ${id}: does ${id} things.`, useWhen,
  load: async () => { throw new Error("unused"); },
});

describe("describeTool", () => {
  it("prefixes the product display name", () => {
    expect(describeTool({ displayName: "Umbraco Forms" }, "Lists all forms.")).toBe("[Umbraco Forms] Lists all forms.");
  });
});

describe("buildRoutingInstructions", () => {
  const cms = mod("cms", ["content", "media"]);
  const forms = mod("forms", ["forms", "form workflows (after submit)"]);

  it("lists one line per module with prefix, description and useWhen", () => {
    const text = buildRoutingInstructions([cms, forms]);
    expect(text).toContain("- `cms--` Umbraco cms: does cms things. Use for: content; media.");
    expect(text).toContain("- `forms--` Umbraco forms: does forms things. Use for: forms; form workflows (after submit).");
  });

  it("only mentions the modules it is given", () => {
    expect(buildRoutingInstructions([cms])).not.toContain("forms--");
  });

  it("tells the agent to pick a product first and points to the health tool", () => {
    const text = buildRoutingInstructions([cms]);
    expect(text).toMatch(/Pick the product/);
    expect(text).toContain(HEALTH_TOOL_NAME);
  });

  it("appends non-null extras and skips null ones", () => {
    const text = buildRoutingInstructions([cms], [null, "Version mismatch: 18 vs 17"]);
    expect(text.endsWith("\n\nVersion mismatch: 18 vs 17")).toBe(true);
    expect(text).not.toContain("null");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- routing`
Expected: FAIL with `Cannot find module '../routing.js'`.

- [ ] **Step 3: Implement `npm/src/core/routing.ts`**

```ts
import type { McpProductModule } from "./module-contract.js";

export const HEALTH_TOOL_NAME = "get-mcp-health";

/** Every tool description starts with its product so keyword-based tool search finds the right product. */
export function describeTool(module: Pick<McpProductModule, "displayName">, description: string): string {
  return `[${module.displayName}] ${description}`;
}

/**
 * Routing table sent as MCP server `instructions` (most clients fold it into the system prompt),
 * so the agent chooses a product before looking through tools. Only pass modules that actually loaded.
 */
export function buildRoutingInstructions(modules: McpProductModule[], extras: Array<string | null> = []): string {
  const routing = [
    "This server exposes tools for several Umbraco products on one site. Every tool name starts with its product prefix.",
    "Pick the product from the user's request first, then only use tools with that prefix:",
    "",
    ...modules.map((m) => `- \`${m.toolPrefix}\` ${m.description} Use for: ${m.useWhen.join("; ")}.`),
    "",
    `If the request does not clearly match one product, or product tools seem missing, call ${HEALTH_TOOL_NAME}.`,
  ].join("\n");
  return [routing, ...extras.filter((e): e is string => Boolean(e))].join("\n\n");
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- routing && npm run compile`
Expected: 5 passed; compile exit 0.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
git add npm/src
git commit -m "feat(npm): add routing instructions and product-prefixed tool descriptions"
```

### Task 11: Tool registrar (prefix, filter, collision, client binding)

**Files:**
- Create: `npm/src/core/tool-registrar.ts`
- Test: `npm/src/core/__tests__/tool-registrar.test.ts`

**Interfaces:**
- Consumes: `McpProductModule`, `LoadedModule` (Task 7), `bindClient` (Task 7), `describeTool` (Task 10).
- Produces:
  - `class DuplicateToolNameError extends Error { toolName: string }`
  - `interface RegistrationContext { server: { registerTool: McpServer["registerTool"] }; user: unknown; registered: Map<string, string> }` (map: final tool name → module id)
  - `registerModuleTools(ctx: RegistrationContext, module: McpProductModule, loaded: LoadedModule, filter: CollectionConfiguration): number`

- [ ] **Step 1: Write the failing tests**

```ts
import { createCollectionConfigLoader, getApiClient, type CollectionConfiguration } from "@umbraco-cms/mcp-server-sdk";
import { installClientContext } from "../client-context.js";
import type { LoadedModule, McpProductModule } from "../module-contract.js";
import { DuplicateToolNameError, registerModuleTools, type RegistrationContext } from "../tool-registrar.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tool = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: `${name} tool`,
  slices: ["read"],
  annotations: { readOnlyHint: true },
  handler: async () => {
    await sleep(name.includes("slow") ? 20 : 1);
    return { content: [{ type: "text", text: String(getApiClient()) }] };
  },
  ...extra,
});

const loaded = (client: string, tools: ReturnType<typeof tool>[]): LoadedModule => ({
  collections: [{ metadata: { name: "things", displayName: "Things", description: "" }, tools: () => tools as never }],
  allModes: [],
  allModeNames: [],
  allSliceNames: ["read", "create"],
  createApiClient: () => client,
});

const mod = (id: string): McpProductModule => ({
  id, displayName: id, toolPrefix: `${id}--`, packageName: `@x/${id}`, expectedMajor: "17", description: `${id} description`, useWhen: [`${id} requests`],
  load: async () => { throw new Error("unused"); },
});

const noFilter = (l: LoadedModule): CollectionConfiguration =>
  createCollectionConfigLoader({ modeRegistry: l.allModes, allModeNames: l.allModeNames, allSliceNames: l.allSliceNames }).loadFromConfig({});

const ctx = (): RegistrationContext & {
  calls: Map<string, (...a: unknown[]) => Promise<any>>;
  configs: Map<string, { description?: string }>;
} => {
  const calls = new Map<string, (...a: unknown[]) => Promise<any>>();
  const configs = new Map<string, { description?: string }>();
  return {
    calls,
    configs,
    user: { id: "u" },
    registered: new Map(),
    server: { registerTool: ((name: string, cfg: { description?: string }, cb: any) => { calls.set(name, cb); configs.set(name, cfg); }) as never },
  };
};

beforeEach(() => installClientContext(() => "default-client"));

describe("registerModuleTools", () => {
  it("prefixes every tool and returns the count", () => {
    const c = ctx();
    const l = loaded("forms-client", [tool("list-forms"), tool("get-form")]);
    expect(registerModuleTools(c, mod("forms"), l, noFilter(l))).toBe(2);
    expect([...c.calls.keys()]).toEqual(["forms--list-forms", "forms--get-form"]);
    expect(c.registered.get("forms--list-forms")).toBe("forms");
  });

  it("prefixes every description with the product display name", () => {
    const c = ctx();
    const l = loaded("forms-client", [tool("list-forms")]);
    registerModuleTools(c, mod("forms"), l, noFilter(l));
    expect(c.configs.get("forms--list-forms")!.description).toBe("[forms] list-forms tool");
  });

  it("skips tools whose enabled(user) is false", () => {
    const c = ctx();
    const l = loaded("forms-client", [tool("secret", { enabled: () => false }), tool("open")]);
    expect(registerModuleTools(c, mod("forms"), l, noFilter(l))).toBe(1);
  });

  it("applies the filter config", () => {
    const c = ctx();
    const l = loaded("forms-client", [tool("a"), tool("b")]);
    const filter = createCollectionConfigLoader({ modeRegistry: [], allModeNames: [], allSliceNames: ["read"] })
      .loadFromConfig({ excludeTools: ["b"] });
    expect(registerModuleTools(c, mod("forms"), l, filter)).toBe(1);
  });

  it("throws on a duplicate final name", () => {
    const c = ctx();
    c.registered.set("forms--a", "other");
    const l = loaded("forms-client", [tool("a")]);
    expect(() => registerModuleTools(c, mod("forms"), l, noFilter(l))).toThrow(DuplicateToolNameError);
  });

  // Review Focus 1 through the real registration path
  it("binds each registered handler to its own product client under concurrency", async () => {
    const c = ctx();
    const f = loaded("forms-client", [tool("slow-list")]);
    const a = loaded("automate-client", [tool("list")]);
    registerModuleTools(c, mod("forms"), f, noFilter(f));
    registerModuleTools(c, mod("automate"), a, noFilter(a));

    const [formsResult, automateResult] = await Promise.all([
      c.calls.get("forms--slow-list")!({}, {}),
      c.calls.get("automate--list")!({}, {}),
    ]);

    expect(formsResult.content[0].text).toBe("forms-client");
    expect(automateResult.content[0].text).toBe("automate-client");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tool-registrar`
Expected: FAIL with `Cannot find module '../tool-registrar.js'`.

- [ ] **Step 3: Implement `npm/src/core/tool-registrar.ts`**

```ts
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createToolAnnotations,
  registerToolCollection,
  shouldIncludeTool,
  type CollectionConfiguration,
} from "@umbraco-cms/mcp-server-sdk";
import { bindClient } from "./client-context.js";
import type { LoadedModule, McpProductModule } from "./module-contract.js";
import { describeTool } from "./routing.js";

export class DuplicateToolNameError extends Error {
  constructor(public readonly toolName: string, existingModule: string, newModule: string) {
    super(`Tool "${toolName}" is registered by both "${existingModule}" and "${newModule}".`);
    this.name = "DuplicateToolNameError";
  }
}

export interface RegistrationContext {
  server: { registerTool: McpServer["registerTool"] };
  user: unknown;
  /** final tool name -> owning module id */
  registered: Map<string, string>;
}

export function registerModuleTools(
  ctx: RegistrationContext,
  module: McpProductModule,
  loaded: LoadedModule,
  filter: CollectionConfiguration,
): number {
  let count = 0;
  for (const collection of loaded.collections) {
    const collectionName = collection.metadata.name;
    for (const tool of collection.tools(ctx.user)) {
      if (tool.enabled && !tool.enabled(ctx.user)) continue;
      if (!shouldIncludeTool(tool, { collectionName, config: filter })) continue;

      const name = `${module.toolPrefix}${tool.name}`;
      const owner = ctx.registered.get(name);
      if (owner) throw new DuplicateToolNameError(name, owner, module.id);
      ctx.registered.set(name, module.id);
      registerToolCollection(name, `${module.id}:${collectionName}`);

      ctx.server.registerTool(
        name,
        {
          description: describeTool(module, tool.description),
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: createToolAnnotations(tool),
        },
        bindClient(loaded.createApiClient, tool.handler as (...args: unknown[]) => unknown) as ToolCallback<any>,
      );
      count++;
    }
  }
  return count;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- tool-registrar && npm run compile`
Expected: 6 passed; compile exit 0. If `createCollectionConfigLoader({ modeRegistry: [] ... })` rejects an empty mode list, pass `allModeNames: []` exactly as shown. The toolkit validates names only when modes are requested.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
git add npm/src
git commit -m "feat(npm): add tool registrar with prefixing, filtering, collision check and client binding"
```

### Task 12: Health report and `get-mcp-health` tool

**Files:**
- Create: `npm/src/core/health.ts`
- Test: `npm/src/core/__tests__/health.test.ts`

**Interfaces:**
- Consumes: `CapabilitiesResult` (Task 8), `ModuleDecision` (Task 9), `McpProductModule` (Task 7).
- Produces:
  - `interface ModuleRuntimeState { decision: ModuleDecision; loaded: boolean; toolCount: number; issues: string[] }`
  - `interface HealthState { capabilities: CapabilitiesResult; umbracoVersion: string | null; versionCheckMessage: string | null; forcedModules: string[]; modules: ModuleRuntimeState[] }`
  - `interface HealthReport { addon; umbraco; forcedModules; products; notes }` (shape below)
  - `buildHealthReport(state: HealthState): HealthReport`
  - re-exports `HEALTH_TOOL_NAME` from `routing.ts` (Task 10)
  - `registerHealthTool(server: { registerTool: McpServer["registerTool"] }, getState: () => HealthState): void`

- [ ] **Step 1: Write the failing tests**

```ts
import type { CapabilitiesResult } from "../capabilities.js";
import { buildHealthReport, type HealthState, type ModuleRuntimeState } from "../health.js";
import type { McpProductModule } from "../module-contract.js";

const mod = (id: string, displayName: string, required = false): McpProductModule => ({
  id, displayName, toolPrefix: `${id}--`, packageName: `@x/${id}`, expectedMajor: "17", description: `${id} description`, useWhen: [`${id} requests`], required,
  load: async () => { throw new Error("unused"); },
});

const state = (capabilities: CapabilitiesResult, modules: ModuleRuntimeState[], forced: string[] = []): HealthState => ({
  capabilities, umbracoVersion: "17.7.0", versionCheckMessage: null, forcedModules: forced, modules,
});

const cmsLoaded: ModuleRuntimeState = {
  decision: { module: mod("cms", "Umbraco CMS", true), product: null, load: true, reason: "Required module." },
  loaded: true, toolCount: 300, issues: [],
};

describe("buildHealthReport", () => {
  it("reports a missing addon with an install hint", () => {
    const r = buildHealthReport(state({ kind: "no-addon" }, [cmsLoaded]));
    expect(r.addon).toEqual({ installed: false, version: null, status: "not-installed" });
    expect(r.notes.join(" ")).toMatch(/Install the Umbraco\.Mcp NuGet package/);
    expect(r.umbraco).toEqual({ version: "17.7.0", versionCheck: "ok" });
  });

  it("lists products with module and load state", () => {
    const forms = { id: "forms", displayName: "Umbraco Forms", installed: true, enabled: true, version: "17.6.1", issues: [] };
    const r = buildHealthReport(state(
      { kind: "ok", payload: { addonVersion: "17.0.0", products: [forms] } },
      [cmsLoaded, { decision: { module: mod("forms", "Umbraco Forms"), product: forms, load: true, reason: "ok" }, loaded: true, toolCount: 118, issues: [] }],
    ));
    expect(r.addon).toEqual({ installed: true, version: "17.0.0", status: "ok" });
    expect(r.products.find((p) => p.id === "forms")).toEqual({
      id: "forms", displayName: "Umbraco Forms", description: "forms description", installed: true, enabled: true, version: "17.6.1",
      hasModule: true, loaded: true, toolCount: 118, issues: [],
    });
  });

  it("notes a detected product with no module, and a module whose product is absent", () => {
    const engage = { id: "engage", displayName: "Umbraco Engage", installed: true, enabled: true, version: "17.0.0", issues: [] };
    const automateModule = mod("automate", "Umbraco Automate");
    const r = buildHealthReport(state(
      { kind: "ok", payload: { addonVersion: "17.0.0", products: [engage] } },
      [cmsLoaded, { decision: { module: automateModule, product: null, load: false, reason: "not installed" }, loaded: false, toolCount: 0, issues: [] }],
    ));
    expect(r.notes).toContain("Umbraco Engage is installed, but this MCP has no Umbraco Engage module yet.");
    expect(r.notes).toContain("There is a module for Umbraco Automate, but it is not installed on this site.");
    expect(r.products.find((p) => p.id === "engage")!.hasModule).toBe(false);
  });

  // Review Focus 4: unknown forced ids are reported, not thrown
  it("notes forced module ids that match no module", () => {
    const r = buildHealthReport(state({ kind: "no-addon" }, [cmsLoaded], ["engage"]));
    expect(r.forcedModules).toEqual(["engage"]);
    expect(r.notes).toContain('UMBRACO_MCP_MODULES lists "engage", but there is no module with that id.');
  });

  it("surfaces the version check message", () => {
    const s = state({ kind: "no-addon" }, [cmsLoaded]);
    s.versionCheckMessage = "Version mismatch: 18 vs 17";
    expect(buildHealthReport(s).umbraco.versionCheck).toBe("Version mismatch: 18 vs 17");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- health`
Expected: FAIL with `Cannot find module '../health.js'`.

- [ ] **Step 3: Implement `npm/src/core/health.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createToolResult } from "@umbraco-cms/mcp-server-sdk";
import type { CapabilitiesResult } from "./capabilities.js";
import type { ModuleDecision } from "./module-selection.js";

import { HEALTH_TOOL_NAME } from "./routing.js";

export { HEALTH_TOOL_NAME };

export interface ModuleRuntimeState {
  decision: ModuleDecision;
  loaded: boolean;
  toolCount: number;
  issues: string[];
}

export interface HealthState {
  capabilities: CapabilitiesResult;
  umbracoVersion: string | null;
  versionCheckMessage: string | null;
  forcedModules: string[];
  modules: ModuleRuntimeState[];
}

export interface HealthProduct {
  id: string;
  displayName: string;
  description: string | null;
  installed: boolean | null;
  enabled: boolean | null;
  version: string | null;
  hasModule: boolean;
  loaded: boolean;
  toolCount: number;
  issues: string[];
}

export interface HealthReport {
  addon: { installed: boolean; version: string | null; status: "ok" | "not-installed" | "unavailable"; detail?: string };
  umbraco: { version: string | null; versionCheck: string };
  forcedModules: string[];
  products: HealthProduct[];
  notes: string[];
}

export function buildHealthReport(state: HealthState): HealthReport {
  const caps = state.capabilities;
  const notes: string[] = [];
  const detected = caps.kind === "ok" ? caps.payload.products : [];

  const addon: HealthReport["addon"] =
    caps.kind === "ok"
      ? { installed: true, version: caps.payload.addonVersion, status: "ok" }
      : caps.kind === "no-addon"
        ? { installed: false, version: null, status: "not-installed" }
        : { installed: false, version: null, status: "unavailable", detail: caps.reason };

  if (caps.kind === "no-addon") {
    notes.push("Install the Umbraco.Mcp NuGet package on the site to enable product tools beyond the CMS.");
  }

  const products: HealthProduct[] = state.modules.map(({ decision, loaded, toolCount, issues }) => {
    const p = detected.find((d) => d.id === decision.module.id) ?? null;
    if (caps.kind === "ok" && !decision.module.required && (!p || !p.installed)) {
      notes.push(`There is a module for ${decision.module.displayName}, but it is not installed on this site.`);
    }
    return {
      id: decision.module.id,
      displayName: decision.module.displayName,
      description: decision.module.description,
      installed: p ? p.installed : null,
      enabled: p ? p.enabled : null,
      version: p ? p.version : null,
      hasModule: true,
      loaded,
      toolCount,
      issues: [...(p?.issues ?? []), ...issues, ...(loaded ? [] : [decision.reason])],
    };
  });

  for (const p of detected) {
    if (products.some((x) => x.id === p.id)) continue;
    products.push({ ...p, description: null, hasModule: false, loaded: false, toolCount: 0 });
    if (p.installed) notes.push(`${p.displayName} is installed, but this MCP has no ${p.displayName} module yet.`);
  }

  for (const id of state.forcedModules) {
    if (!state.modules.some((m) => m.decision.module.id === id)) {
      notes.push(`UMBRACO_MCP_MODULES lists "${id}", but there is no module with that id.`);
    }
  }

  return {
    addon,
    umbraco: { version: state.umbracoVersion, versionCheck: state.versionCheckMessage ?? "ok" },
    forcedModules: state.forcedModules,
    products,
    notes,
  };
}

export function registerHealthTool(server: { registerTool: McpServer["registerTool"] }, getState: () => HealthState): void {
  server.registerTool(
    HEALTH_TOOL_NAME,
    {
      description:
        "Reports which Umbraco products this MCP detected on the site, which tool modules loaded (with tool counts), " +
        "the Umbraco version check result, and how to fix anything missing. Call this first when product tools seem absent.",
      annotations: { readOnlyHint: true },
    },
    async () => createToolResult(buildHealthReport(getState())),
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- health && npm run compile`
Expected: 5 passed; compile exit 0.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
git add npm/src
git commit -m "feat(npm): add health report and get-mcp-health tool"
```

### Task 13: Product modules and the module contract test

**Files:**
- Create: `npm/src/types/product-modules.d.ts`
- Create: `npm/src/modules/cms.ts`, `npm/src/modules/forms.ts`, `npm/src/modules/automate.ts`, `npm/src/modules/index.ts`
- Test: `npm/src/modules/__tests__/contract.test.ts`

**Interfaces:**
- Consumes: `McpProductModule`, `LoadedModule` (Task 7).
- Produces: `export const modules: McpProductModule[]` in `npm/src/modules/index.ts`, with ids `cms` (required), `forms`, `automate`.

- [ ] **Step 1: Verify the CMS entry point's real exports**

Run: `node -e "import('@umbraco-cms/mcp-dev/collections').then(m => console.log(Object.keys(m).sort().join(',')))"`
Expected: includes `UmbracoManagementClient,allModeNames,allModes,allSliceNames,collections`. If `UmbracoManagementClient` is missing on 17.6.10, stop and report it. The CMS 17 line then needs the same Phase 0 export.

- [ ] **Step 2: Write the failing contract test** `npm/src/modules/__tests__/contract.test.ts`

```ts
import { createPermissiveCodegenUser } from "@umbraco-cms/mcp-server-sdk";
import { buildRoutingInstructions } from "../../core/routing.js";
import { modules } from "../index.js";

const user = createPermissiveCodegenUser();

describe.each(modules.map((m) => [m.id, m] as const))("module %s", (_id, module) => {
  it("has a valid id, prefix, package and major", () => {
    expect(module.id).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(module.toolPrefix).toBe(`${module.id}--`);
    expect(module.packageName).toMatch(/^@[a-z0-9-]+\/[a-z0-9-]+$/);
    expect(module.expectedMajor).toBe("17");
  });

  it("has routing text: description starts with the display name, useWhen is non-empty", () => {
    expect(module.description.startsWith(`${module.displayName}: `)).toBe(true);
    expect(module.useWhen.length).toBeGreaterThan(0);
    for (const phrase of module.useWhen) expect(phrase.trim().length).toBeGreaterThan(0);
  });

  it("loads every LoadedModule field", async () => {
    const loaded = await module.load();
    expect(Array.isArray(loaded.collections)).toBe(true);
    expect(loaded.collections.length).toBeGreaterThan(0);
    expect(Array.isArray(loaded.allModes)).toBe(true);
    expect(Array.isArray(loaded.allModeNames)).toBe(true);
    expect(Array.isArray(loaded.allSliceNames)).toBe(true);
    expect(typeof loaded.createApiClient).toBe("function");
  });

  it("defines well-formed tools", async () => {
    const loaded = await module.load();
    for (const collection of loaded.collections) {
      for (const tool of collection.tools(user)) {
        expect(typeof tool.name).toBe("string");
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.handler).toBe("function");
      }
    }
  });
});

describe("module set", () => {
  it("has exactly one required module, and it is cms", () => {
    expect(modules.filter((m) => m.required).map((m) => m.id)).toEqual(["cms"]);
  });

  it("has unique ids", () => {
    expect(new Set(modules.map((m) => m.id)).size).toBe(modules.length);
  });

  it("keeps the routing instructions for all modules under 2,000 characters", () => {
    expect(buildRoutingInstructions(modules).length).toBeLessThan(2000);
  });

  it("produces unique prefixed tool names across all modules", async () => {
    const seen = new Map<string, string>();
    for (const module of modules) {
      const loaded = await module.load();
      for (const collection of loaded.collections) {
        for (const tool of collection.tools(user)) {
          const name = `${module.toolPrefix}${tool.name}`;
          expect(seen.get(name)).toBeUndefined();
          seen.set(name, module.id);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- contract`
Expected: FAIL with `Cannot find module '../index.js'`.

- [ ] **Step 4: Create `npm/src/types/product-modules.d.ts`** (Forms and Automate ship no types for `./collections`)

```ts
declare module "@umbraco-forms/mcp-dev/collections";
declare module "@umbraco-automate/mcp-dev/collections";
```

- [ ] **Step 5: Create the three modules and the list**

`npm/src/modules/cms.ts`:

```ts
import type { LoadedModule, McpProductModule } from "../core/module-contract.js";

export const cmsModule: McpProductModule = {
  id: "cms",
  displayName: "Umbraco CMS",
  toolPrefix: "cms--",
  packageName: "@umbraco-cms/mcp-dev",
  expectedMajor: "17",
  required: true,
  description: "Umbraco CMS: the site's content, structure, media, members and settings.",
  useWhen: [
    "content/documents, publishing, blueprints and the recycle bin",
    "document types, data types, templates, partial views, stylesheets and scripts",
    "media and media types",
    "members, users and user groups",
    "dictionary items, languages, domains, redirects and CMS webhooks",
    "health checks, logs, search indexes and server information",
  ],
  load: async (): Promise<LoadedModule> => {
    const m = await import("@umbraco-cms/mcp-dev/collections");
    return {
      collections: m.collections as LoadedModule["collections"],
      allModes: m.allModes as LoadedModule["allModes"],
      allModeNames: m.allModeNames,
      allSliceNames: m.allSliceNames,
      createApiClient: () => m.UmbracoManagementClient.getClient(),
    };
  },
};
```

`npm/src/modules/forms.ts`:

```ts
import type { LoadedModule, McpProductModule } from "../core/module-contract.js";

export const formsModule: McpProductModule = {
  id: "forms",
  displayName: "Umbraco Forms",
  toolPrefix: "forms--",
  packageName: "@umbraco-forms/mcp-dev",
  expectedMajor: "17",
  description: "Umbraco Forms: forms, their fields and the entries people submit.",
  useWhen: [
    "forms, form fields, pages, conditions, themes and form templates",
    "form submissions (entries/records), searching and exporting them",
    "form workflows (actions that run after a form is submitted), data sources and prevalue sources",
  ],
  load: async (): Promise<LoadedModule> => {
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

`npm/src/modules/automate.ts`:

```ts
import type { LoadedModule, McpProductModule } from "../core/module-contract.js";

export const automateModule: McpProductModule = {
  id: "automate",
  displayName: "Umbraco Automate",
  toolPrefix: "automate--",
  packageName: "@umbraco-automate/mcp-dev",
  expectedMajor: "17",
  description: "Umbraco Automate: automations that react to triggers and run steps.",
  useWhen: [
    "automations: creating, editing, publishing and triggering them",
    "triggers, steps, connections and the trigger/step catalogue",
    "automation runs, their history, retries and pending approvals",
    "workspaces, metrics and version history",
    "general automations that are not tied to a form submission",
  ],
  load: async (): Promise<LoadedModule> => {
    const m = await import("@umbraco-automate/mcp-dev/collections");
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

`npm/src/modules/index.ts`:

```ts
import type { McpProductModule } from "../core/module-contract.js";
import { automateModule } from "./automate.js";
import { cmsModule } from "./cms.js";
import { formsModule } from "./forms.js";

/** The only list to edit when adding a product. CMS first: it is the default module for unprefixed filters. */
export const modules: McpProductModule[] = [cmsModule, formsModule, automateModule];
```

- [ ] **Step 6: Run the contract test and typecheck**

Run: `npm test -- contract && npm run compile`
Expected: all pass; compile exit 0. A failure in "produces unique prefixed tool names" means a product defines the same tool name twice within itself. Report it rather than renaming.

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
git add npm/src
git commit -m "feat(npm): add CMS, Forms and Automate modules with an auto-applied contract test"
```

### Task 14: Single-toolkit check

**Files:**
- Create: `npm/src/core/sdk-instance.ts`
- Test: `npm/src/core/__tests__/sdk-instance.test.ts`

**Interfaces:**
- Produces:
  - `findPackageDir(entryFilePath: string, packageName: string): string | null` (walks up from the entry file to the `package.json` whose `name === packageName`)
  - `hasNestedSdkCopy(packageDir: string): boolean`
  - `checkSingleSdk(packageName: string): string | null` (returns an issue message or `null`; uses `import.meta.resolve(`${packageName}/collections`)`)

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPackageDir, hasNestedSdkCopy } from "../sdk-instance.js";

function fakePackage(nested: boolean): { dir: string; entry: string } {
  const root = mkdtempSync(join(tmpdir(), "umb-mcp-"));
  const dir = join(root, "node_modules", "@x", "product");
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@x/product" }));
  writeFileSync(join(dir, "dist", "collections.js"), "");
  if (nested) mkdirSync(join(dir, "node_modules", "@umbraco-cms", "mcp-server-sdk"), { recursive: true });
  return { dir, entry: join(dir, "dist", "collections.js") };
}

describe("sdk instance check", () => {
  it("finds the package dir by walking up to the matching package.json", () => {
    const { dir, entry } = fakePackage(false);
    expect(findPackageDir(entry, "@x/product")).toBe(dir);
  });

  it("returns null when no matching package.json exists", () => {
    const { entry } = fakePackage(false);
    expect(findPackageDir(entry, "@x/other")).toBeNull();
  });

  it("detects a nested toolkit copy", () => {
    expect(hasNestedSdkCopy(fakePackage(true).dir)).toBe(true);
    expect(hasNestedSdkCopy(fakePackage(false).dir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sdk-instance`
Expected: FAIL with `Cannot find module '../sdk-instance.js'`.

- [ ] **Step 3: Implement `npm/src/core/sdk-instance.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function findPackageDir(entryFilePath: string, packageName: string): string | null {
  let dir = dirname(entryFilePath);
  while (true) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        if ((JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name === packageName) return dir;
      } catch {
        // unreadable package.json: keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function hasNestedSdkCopy(packageDir: string): boolean {
  return existsSync(join(packageDir, "node_modules", "@umbraco-cms", "mcp-server-sdk"));
}

/** Returns an issue message when the product would run on its own toolkit copy, else null. */
export function checkSingleSdk(packageName: string): string | null {
  const entry = fileURLToPath(import.meta.resolve(`${packageName}/collections`));
  const dir = findPackageDir(entry, packageName);
  if (dir && hasNestedSdkCopy(dir)) {
    return `${packageName} has its own copy of @umbraco-cms/mcp-server-sdk (toolkit version mismatch); module skipped.`;
  }
  return null;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- sdk-instance && npm run compile`
Expected: 3 passed; compile exit 0.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
git add npm/src
git commit -m "feat(npm): skip modules that would run on a second toolkit copy"
```

### Task 15: Server orchestration and stdio entry point

**Files:**
- Create: `npm/src/core/server.ts`, `npm/src/index.ts`
- Create: `npm/.env.example`

**Interfaces:**
- Consumes: everything from Tasks 7–14: `installClientContext`, `buildRoutingInstructions`, `fetchCapabilities`, `parseForcedModules`, `selectModules`, `buildModuleFilterInput`, `registerModuleTools`, `DuplicateToolNameError`, `checkSingleSdk`, `registerHealthTool`, `HEALTH_TOOL_NAME`, `HealthState`, `ModuleRuntimeState`, `modules`.
- Produces: `startServer(options: { modules: McpProductModule[]; env: NodeJS.ProcessEnv; version: string }): Promise<{ server: McpServer; toolNames: string[] }>`; CLI flag `--list-tools`.

- [ ] **Step 1: Implement `npm/src/core/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CAPTURE_RAW_HTTP_RESPONSE,
  SERVER_INFORMATION_PATH,
  UmbracoManagementClient,
  checkUmbracoVersion,
  configureVersionCheckHook,
  createCollectionConfigLoader,
  getVersionCheckMessage,
  initializeUmbracoFetch,
  useDraft202012ToolSchemas,
  type HttpResponse,
} from "@umbraco-cms/mcp-server-sdk";
import { fetchCapabilities } from "./capabilities.js";
import { installClientContext } from "./client-context.js";
import { buildModuleFilterInput } from "./filter-config.js";
import { HEALTH_TOOL_NAME, registerHealthTool, type HealthState, type ModuleRuntimeState } from "./health.js";
import type { LoadedModule, McpProductModule } from "./module-contract.js";
import { parseForcedModules, selectModules } from "./module-selection.js";
import { buildRoutingInstructions } from "./routing.js";
import { checkSingleSdk } from "./sdk-instance.js";
import { DuplicateToolNameError, registerModuleTools, type RegistrationContext } from "./tool-registrar.js";

const EXPECTED_UMBRACO_MAJOR = "17";

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    console.error(`Error: ${name} is required.`);
    process.exit(1);
  }
  return value;
}

export async function startServer(options: {
  modules: McpProductModule[];
  env: NodeJS.ProcessEnv;
  version: string;
}): Promise<{ server: McpServer; toolNames: string[] }> {
  const { env, version } = options;
  initializeUmbracoFetch({
    baseUrl: requireEnv(env, "UMBRACO_BASE_URL"),
    clientId: requireEnv(env, "UMBRACO_CLIENT_ID"),
    clientSecret: requireEnv(env, "UMBRACO_CLIENT_SECRET"),
  });

  const cms = options.modules.find((m) => m.required);
  if (!cms) throw new Error("No required (CMS) module configured.");
  const cmsLoaded = await cms.load();
  installClientContext(cmsLoaded.createApiClient);

  // First call doubles as the credentials check and supplies the user for collection.tools(user).
  let user: unknown;
  try {
    user = await (cmsLoaded.createApiClient() as { getUserCurrent(): Promise<unknown> }).getUserCurrent();
  } catch (error) {
    console.error("Could not authenticate against Umbraco. Check UMBRACO_BASE_URL, UMBRACO_CLIENT_ID and UMBRACO_CLIENT_SECRET.", error);
    process.exit(1);
  }

  const info = (await UmbracoManagementClient<unknown>(
    { url: SERVER_INFORMATION_PATH, method: "GET" },
    CAPTURE_RAW_HTTP_RESPONSE,
  )) as unknown as HttpResponse<{ version?: string }>;
  const umbracoVersion = info.data?.version ?? null;
  await checkUmbracoVersion({
    mcpVersion: version,
    expectedUmbracoMajor: EXPECTED_UMBRACO_MAJOR,
    client: { getServerInformation: async () => ({ version: umbracoVersion ?? "0.0.0" }) },
  });
  configureVersionCheckHook();
  const versionCheckMessage = getVersionCheckMessage();

  const capabilities = await fetchCapabilities();
  const forcedModules = parseForcedModules(env.UMBRACO_MCP_MODULES);
  const decisions = selectModules(options.modules, capabilities, forcedModules);

  // Phase 1: load the selected modules. Server instructions are fixed at construction,
  // so we need to know which modules loaded before creating the server.
  const states: ModuleRuntimeState[] = [];
  const ready: Array<{ state: ModuleRuntimeState; loaded: LoadedModule }> = [];
  for (const decision of decisions) {
    const state: ModuleRuntimeState = { decision, loaded: false, toolCount: 0, issues: [] };
    states.push(state);
    if (!decision.load) continue;
    if (decision.module.required) {
      ready.push({ state, loaded: cmsLoaded });
      continue;
    }
    try {
      const sdkIssue = checkSingleSdk(decision.module.packageName);
      if (sdkIssue) {
        state.issues.push(sdkIssue);
        continue;
      }
      ready.push({ state, loaded: await decision.module.load() });
    } catch (error) {
      state.issues.push(`Failed to load: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const server = new McpServer(
    { name: "Umbraco MCP", version },
    { instructions: buildRoutingInstructions(ready.map((r) => r.state.decision.module), [versionCheckMessage]) },
  );

  // Phase 2: register each loaded module's tools.
  const ctx: RegistrationContext = { server, user, registered: new Map([[HEALTH_TOOL_NAME, "core"]]) };
  for (const { state, loaded } of ready) {
    const { module } = state.decision;
    try {
      const filter = createCollectionConfigLoader({
        modeRegistry: loaded.allModes,
        allModeNames: loaded.allModeNames,
        allSliceNames: loaded.allSliceNames,
      }).loadFromConfig(buildModuleFilterInput(env, module.id, module.required === true));
      state.toolCount = registerModuleTools(ctx, module, loaded, filter);
      state.loaded = true;
    } catch (error) {
      if (error instanceof DuplicateToolNameError || module.required) throw error;
      state.issues.push(`Failed to register tools: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const healthState: HealthState = { capabilities, umbracoVersion, versionCheckMessage, forcedModules, modules: states };
  registerHealthTool(server, () => healthState);

  // Must run after every registerTool call.
  useDraft202012ToolSchemas(server);

  return { server, toolNames: [...ctx.registered.keys()].sort() };
}
```

- [ ] **Step 2: Implement `npm/src/index.ts`**

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import packageJson from "../package.json" with { type: "json" };
import { startServer } from "./core/server.js";
import { modules } from "./modules/index.js";

const { server, toolNames } = await startServer({ modules, env: process.env, version: packageJson.version });

if (process.argv.includes("--list-tools")) {
  console.log(toolNames.join("\n"));
  process.exit(0);
}

await server.connect(new StdioServerTransport());
console.error(`Umbraco MCP started with ${toolNames.length} tool(s).`);
```

- [ ] **Step 3: Create `npm/.env.example`** (placeholders only, never real secrets)

```dotenv
UMBRACO_BASE_URL=https://localhost:44399
UMBRACO_CLIENT_ID=umbraco-back-office-mcp
UMBRACO_CLIENT_SECRET=change-me
# Local dev with a self-signed certificate only:
NODE_TLS_REJECT_UNAUTHORIZED=0
# Optional: force modules on without detection
# UMBRACO_MCP_MODULES=forms,automate
```

- [ ] **Step 4: Build, typecheck and run the full unit suite**

Run: `npm run compile && npm run build && npm test`
Expected: compile exit 0; `dist/index.js` exists; all suites pass.

- [ ] **Step 5: Verify startup fails clearly without credentials**

Run: `env -i PATH="$PATH" node dist/index.js --list-tools; echo "exit=$?"`
Expected: `Error: UMBRACO_BASE_URL is required.` and `exit=1`.

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
git add npm/src npm/.env.example
git commit -m "feat(npm): wire startup orchestration, health state and --list-tools"
```

---

# Phase 3: Demo site, end-to-end check and docs

### Task 16: Demo site and end-to-end script

**Files:**
- Create: `demo-site/` (Umbraco 17.7.0 site via template)
- Create: `scripts/create-api-user.mjs` (copied from the Automate MCP repo, base URL parameterised)
- Create: `scripts/e2e.sh`

**Interfaces:**
- Consumes: `Umbraco.Mcp` project (Phase 1), `npm/dist/index.js` (Task 15).
- Produces: a local site at `https://localhost:44399` (HTTP `http://localhost:9399`) with Forms 17.6.1, Automate 17.4.0 and `Umbraco.Mcp`; an API user `umbraco-back-office-mcp`.

- [ ] **Step 1: Create the site from the Umbraco 17.7.0 template**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
dotnet new install Umbraco.Templates::17.7.0
dotnet new umbraco -n DemoSite -o demo-site --development-database-type SQLite \
  --friendly-name "Admin" --email admin@test.com --password SecurePass1234
cd demo-site
dotnet add package Umbraco.Forms --version 17.6.1
dotnet add package Umbraco.Automate --version 17.4.0
dotnet add reference ../src/Umbraco.Mcp/Umbraco.Mcp.csproj
```

If the template generated a `Directory.Packages.props` with central versions, add the two packages there instead of `--version` (follow the error message from `dotnet add package`).

- [ ] **Step 2: Pin the ports** in `demo-site/Properties/launchSettings.json`. Set the HTTPS profile's `applicationUrl` to:

```json
"applicationUrl": "https://localhost:44399;http://localhost:9399"
```

These ports avoid the Forms demo (44390) and Automate demo (44320).

- [ ] **Step 3: Add the demo site to the solution and build**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
dotnet sln Umbraco.Mcp.slnx add demo-site/DemoSite.csproj
dotnet build Umbraco.Mcp.slnx
```

Expected: build succeeds.

- [ ] **Step 4: Start the site** (separate terminal, keep it running)

```bash
dotnet run --project demo-site --launch-profile DemoSite
```

Expected: the site boots, the unattended install creates the admin user, and `https://localhost:44399/umbraco` shows the login page.

- [ ] **Step 5: Create the API user**

```bash
cp ~/Desktop/Umbraco/Automate.MCP.Dev.Repository/Umbraco-Automate-MCP-Dev/scripts/create-api-user.mjs scripts/create-api-user.mjs
node scripts/create-api-user.mjs http://localhost:9399 admin@test.com SecurePass1234
```

Expected: the script reports the API user and client credentials were created (client id `umbraco-back-office-mcp`, dev secret from the script). Write them into `npm/.env` (gitignored) based on `npm/.env.example`, with `UMBRACO_BASE_URL=http://localhost:9399`.

- [ ] **Step 6: Create `scripts/e2e.sh`**

```bash
#!/usr/bin/env bash
# End-to-end smoke check against the running demo site. Requires npm/.env and a built npm/dist.
set -euo pipefail
cd "$(dirname "$0")/../npm"
set -a; source .env; set +a

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "1. Capabilities endpoint"
TOKEN=$(curl -sk -X POST "$UMBRACO_BASE_URL/umbraco/management/api/v1/security/back-office/token" \
  -d grant_type=client_credentials -d client_id="$UMBRACO_CLIENT_ID" -d client_secret="$UMBRACO_CLIENT_SECRET" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).access_token))")
CAPS=$(curl -sk -H "Authorization: Bearer $TOKEN" "$UMBRACO_BASE_URL/umbraco/management/api/v1/mcp/capabilities")
echo "$CAPS"
echo "$CAPS" | grep -q '"id":"forms"' || fail "capabilities missing forms"
echo "$CAPS" | grep -q '"id":"automate"' || fail "capabilities missing automate"

echo "2. Tool list"
TOOLS=$(node dist/index.js --list-tools)
for prefix in "cms--" "forms--" "automate--"; do
  echo "$TOOLS" | grep -q "^$prefix" || fail "no $prefix tools"
done
echo "$TOOLS" | grep -qx "get-mcp-health" || fail "get-mcp-health missing"
echo "   $(echo "$TOOLS" | wc -l | tr -d ' ') tools"
LIST=$(npx -y @modelcontextprotocol/inspector@1 --cli node dist/index.js --method tools/list)
echo "$LIST" | grep -q '\[Umbraco Forms\]' || fail "tool descriptions are not product-prefixed"

echo "3. Smoke calls"
for tool in get-mcp-health forms--list-forms automate--list-automations; do
  npx -y @modelcontextprotocol/inspector@1 --cli node dist/index.js --method tools/call --tool-name "$tool" >/dev/null \
    || fail "$tool call failed"
  echo "   $tool ok"
done

echo "PASS"
```

Run: `chmod +x scripts/e2e.sh && (cd npm && npm run build) && scripts/e2e.sh`
Expected: `PASS`. If the Inspector CLI flags differ in the installed version, run `npx @modelcontextprotocol/inspector@1 --help` and adjust only the step-3 command line.

- [ ] **Step 7: Verify the backoffice health check by hand**

Log in at `https://localhost:44399/umbraco` → Settings → Health Check → group **MCP** → "Check group".
Expected: an Info row for `Umbraco.Mcp …`, and Success rows for Umbraco CMS, Umbraco Forms and Umbraco Automate.

- [ ] **Step 8: Verify product removal hides its tools**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP/demo-site && dotnet remove package Umbraco.Automate
# restart the site (Step 4), then:
cd ../npm && node --env-file=.env dist/index.js --list-tools | grep -c "^automate--" || true
```

Expected: `0`. The health check now shows "Umbraco Automate is not installed." Re-add the package afterwards: `dotnet add package Umbraco.Automate --version 17.4.0`.

- [ ] **Step 9: Commit** (no secrets: `.env`, `appsettings.local.json` and the SQLite data are gitignored)

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
git status --short   # confirm no .env, *.sqlite* or appsettings.local.json is staged
git add demo-site scripts Umbraco.Mcp.slnx
git commit -m "test: add demo site and end-to-end smoke script"
```

### Task 17: README and "adding a product" guide

**Files:**
- Create: `README.md`, `docs/adding-a-product.md`

**Interfaces:**
- Consumes: final names and paths from all previous tasks.

- [ ] **Step 1: Write `docs/adding-a-product.md`**

````markdown
# Adding an Umbraco HQ product

Example: Umbraco Engage. Nothing in `npm/src/core/` or the addon's core changes.

## 1. Product MCP repo (local branch only, never a PR)

`src/collections.ts` must export the API client factory next to the existing exports:

```ts
export { getUmbracoEngageManagementAPI as createApiClient } from "./umbraco-api/api/generated/umbracoEngageManagementApi.js";
```

and depend on the same `@umbraco-cms/mcp-server-sdk` version as `npm/package.json`. Then `npm pack --pack-destination <path-to>/Umbraco.MCP/npm/vendor` and point the umbrella's dependency at the tarball (`file:vendor/…tgz`).

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
- add the dependency to `npm/package.json` on the matching major line

## 3. .NET detector (`src/Umbraco.Mcp/Detection/Detectors/EngageDetector.cs`)

```csharp
namespace Umbraco.Mcp.Detection.Detectors;

public sealed class EngageDetector(ILoadedAssemblyProvider assemblies, IRegisteredApiProvider apis)
    : ProductDetectorBase(assemblies, apis)
{
    public override string Id => "engage";
    public override string DisplayName => "Umbraco Engage";
    protected override string AssemblyName => "<Engage core assembly name>";   // check the site's bin folder
    protected override string ApiName => "engage-management";
}
```

Register it in `McpComposer`: `builder.Services.AddSingleton<IMcpProductDetector, EngageDetector>();`

## 4. Verify

- `cd npm && npm test`: the contract test covers the new module automatically.
- `dotnet test Umbraco.Mcp.slnx`
- `scripts/e2e.sh` against a demo site with the product installed; `get-mcp-health` shows it loaded.
````

- [ ] **Step 2: Write `README.md`**

````markdown
# Umbraco MCP (proof of concept)

One MCP server for an Umbraco 17 site. It detects which Umbraco HQ products are installed and loads only their tools.

| Part | What it does |
|---|---|
| `src/Umbraco.Mcp` (NuGet) | Detects products, serves `GET /umbraco/management/api/v1/mcp/capabilities`, adds an **MCP** backoffice health check |
| `npm/` (`@umbraco/mcp`) | Stdio MCP server: CMS always, Forms/Automate when detected; tools are prefixed `cms--`, `forms--`, `automate--`; `get-mcp-health` explains what loaded and why |

Agents get a routing table (MCP server `instructions`) that says which prefix to use for which kind of request, and every tool description starts with its product, e.g. `[Umbraco Forms] …`.

Working names: final package names need product sign-off. Nothing is published to npm or NuGet.

## Use it locally

1. Add a project reference (or local NuGet package) to `Umbraco.Mcp` in your Umbraco 17 site and restart it.
2. Create an API user with client credentials in the backoffice.
3. `cd npm && npm install && npm run build`
4. MCP client config:

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "node",
      "args": ["/absolute/path/to/Umbraco.MCP/npm/dist/index.js"],
      "env": {
        "UMBRACO_BASE_URL": "https://localhost:44399",
        "UMBRACO_CLIENT_ID": "umbraco-back-office-mcp",
        "UMBRACO_CLIENT_SECRET": "<your secret>"
      }
    }
  }
}
```

## Configuration

| Variable | Meaning |
|---|---|
| `UMBRACO_MCP_MODULES` | Force modules on without detection, e.g. `forms,automate` |
| `UMBRACO_TOOL_MODES`, `UMBRACO_INCLUDE_/EXCLUDE_TOOL_COLLECTIONS`, `UMBRACO_INCLUDE_/EXCLUDE_TOOLS` | Toolkit filters. Unprefixed entries apply to CMS; `forms:<value>` targets a module; `forms:*` means no restriction for that module |
| `UMBRACO_INCLUDE_SLICES`, `UMBRACO_EXCLUDE_SLICES` | Apply to every module |

## Compatibility (v1)

| Component | Version |
|---|---|
| Umbraco CMS | 17.x |
| `@umbraco-cms/mcp-server-sdk` | 1.0.0-beta.45 (single copy enforced) |
| `@umbraco-cms/mcp-dev` | 17.6.10 |
| `@umbraco-forms/mcp-dev` / `@umbraco-automate/mcp-dev` | local builds with the `createApiClient` export (`npm/vendor/`); these changes are never pushed |

## Develop

- `dotnet test Umbraco.Mcp.slnx`
- `cd npm && npm test`
- `scripts/e2e.sh` (needs the demo site running; see `docs/superpowers/plans/2026-10-11-umbraco-mcp-umbrella.md`, Task 16)
- Adding a product: [docs/adding-a-product.md](docs/adding-a-product.md)

Known trade-off: tool names are prefixed (`cms--get-document`), so they differ from the standalone CMS MCP's names.
````

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/Umbraco/Umbraco.MCP
git add README.md docs/adding-a-product.md
git commit -m "docs: add README and adding-a-product guide"
```

---

## Self-review against the spec

| Spec section | Task(s) |
|---|---|
| 1 Success criteria: tools for detected products, removal hides tools, health group, small extension, isolation, routing table | 15, 16 (Steps 6–8), 6, 17, 7 + 11, 10 + 15 |
| 2 Scope (CMS/Forms/Automate, 17, stdio, local-only product changes) | 1, 2, 13, 15 |
| 3 Background (missing exports, toolkit pins, collisions) | 1, 2, 7 (Step 3 dedupe check), 11, 13 |
| 4.1 npm module contract (+ `packageName`, `description`, `useWhen`) | 7, 13 |
| 4.2 .NET detector contract, no product dependency | 3, 4 |
| 5.1 Startup sequence | 15 |
| 5.2 Per-call client isolation | 7, 11 |
| 5.3 Single toolkit instance | 7 (overrides), 14, 15 |
| 5.4 Capabilities endpoint | 5, 8 |
| 5.5 Filtering | 9, 15 |
| 5.6 Routing descriptions (instructions, description prefix, health) | 10, 11, 12, 13 (length guard), 15, 16 (Step 6) |
| 6.1 Backoffice health check | 6, 16 (Step 7) |
| 6.2 `get-mcp-health` | 12, 15, 16 |
| 7 Error handling table | 8, 9, 14, 15 (Steps 1 and 5) |
| 8 Testing | every task; contract test in 13; E2E in 16 |
| 9 Extension recipe | 17 |
| 10 Phases | Phase 0–3 headings |
