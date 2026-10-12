# Backoffice Tool Group Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a site admin switch MCP tool groups (collections) on or off per product from an "Umbrella" dashboard in the Umbraco backoffice; the npm server applies the choice on its next start.

**Architecture:** The add-on stores the disabled lists and the last-reported collection catalogue in two `umbracoKeyValue` rows, adds `disabledCollections` to each product in the capabilities payload, and exposes `GET/PUT tool-settings` (Settings section) plus `POST catalogue` (API users only). The npm server folds the site list into each module's `excludeToolCollections` unless the environment sets collection filters for that module, then reports its unfiltered catalogue back. A single plain-JS Lit dashboard (no build step) reads and writes the settings.

**Tech Stack:** .NET 10 / Umbraco 17.7.0 Management API, NUnit 3 with hand-written fakes; TypeScript (ESM, strict) with Jest 30; Umbraco backoffice extension API (Lit, UUI) via the backoffice import map.

**Spec:** `docs/superpowers/specs/2026-10-12-backoffice-tool-toggles-design.md`

## Global Constraints

- Umbraco **17 only**: `Umbraco.Cms.Api.Management` 17.7.0, `net10.0`. Don't upgrade dependency versions.
- The add-on must never take a package dependency on any product.
- npm: ESM, `.js` import suffixes in TS, TypeScript strict, Node ≥ 22. Network edges are injected as functions; no HTTP mocking.
- .NET tests: NUnit 3, hand-written fakes in `tests/Umbraco.Mcp.Tests/Fakes.cs`.
- Never call `configureApiClient` outside `client-context.ts`.
- Key/value rows: `Umbraco.Mcp.ToolSettings` and `Umbraco.Mcp.Catalogue`, JSON camelCase.
- Size caps: at most 50 modules, 200 collections per module, 100 characters per name or id.
- Env wins: a module with any `UMBRACO_INCLUDE_TOOL_COLLECTIONS` / `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` entry (including `forms:*`, or unprefixed for CMS) ignores the site list.
- Dates in docs and UI: DD-MM-YYYY. Stage files explicitly (never `git add -A`); never commit `demo-site/appsettings.json` with a generated `Imaging:HMACSecretKey`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **`disabledCollections: null` in the capabilities payload** → npm treats it as `[]`; it must not make the whole payload "unexpected" (which would unload every product). Test in Task 4.
2. **The site disables a collection name the module does not have** (renamed upstream, typo) → every other tool still registers; nothing throws. Test in Task 5.
3. **Tool-level env filters (`UMBRACO_EXCLUDE_TOOLS`, `UMBRACO_INCLUDE_TOOLS`) or an empty item like `forms:`** → do not count as "env sets collection filters"; the site list still applies. Test in Task 5.
4. **A catalogue report containing a module id the add-on has no detector for** (newer npm, older add-on) → stored without error; `PUT` still rejects that id. Test in Task 3.
5. **A module that fails to load on one start** → its previous catalogue entry remains so the dashboard keeps its checkboxes. Test in Task 1.

**Deviation from the spec, deliberate:** the spec says `--list-tools` does not report the catalogue. Reporting from `--list-tools` is harmless (same API user, same data) and is what lets `scripts/e2e.sh` verify the report without a long-running stdio server, so this plan reports on every start. Task 9 updates the spec line.

## File Structure

| File | Responsibility |
|---|---|
| `src/Umbraco.Mcp/ToolSettings/McpToolCatalogue.cs` (create) | Stored catalogue records |
| `src/Umbraco.Mcp/ToolSettings/McpCatalogueReport.cs` (create) | What the npm server POSTs |
| `src/Umbraco.Mcp/ToolSettings/IMcpToolSettingsStore.cs` (create) | Store interface |
| `src/Umbraco.Mcp/ToolSettings/KeyValueMcpToolSettingsStore.cs` (create) | Key/value implementation |
| `src/Umbraco.Mcp/ToolSettings/McpToolSettingsValidation.cs` (create) | Normalise + cap PUT and POST bodies |
| `src/Umbraco.Mcp/Api/McpToolSettingsController.cs` (create) | `GET/PUT tool-settings`, `POST catalogue` |
| `src/Umbraco.Mcp/Detection/McpProductStatus.cs` (modify) | `DisabledCollections` init property |
| `src/Umbraco.Mcp/Capabilities/McpCapabilitiesService.cs` (modify) | Fill `DisabledCollections` |
| `src/Umbraco.Mcp/McpComposer.cs` (modify) | Register the store |
| `src/Umbraco.Mcp/Umbraco.Mcp.csproj` (modify) | Razor SDK for static web assets |
| `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbraco-package.json` (create) | Dashboard manifest |
| `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-dashboard.js` (create) | Dashboard element |
| `npm/src/core/capabilities.ts` (modify) | Optional `disabledCollections`, `siteDisabledCollections()` |
| `npm/src/core/filter-config.ts` (modify) | `envSetsCollectionFilter()`, `buildEffectiveFilterInput()` |
| `npm/src/core/catalogue.ts` (create) | `buildCatalogue()`, `reportCatalogue()` |
| `npm/src/core/health.ts` (modify) | Notes for disabled/ignored collections and report failure |
| `npm/src/core/server.ts` (modify) | Wire it together |
| `scripts/e2e.sh`, `README.md`, `npm/README.md`, `src/Umbraco.Mcp/README.md`, `CLAUDE.md` (modify) | E2E check and docs |

---

### Task 1: Tool settings store (.NET)

**Files:**
- Create: `src/Umbraco.Mcp/ToolSettings/McpToolCatalogue.cs`
- Create: `src/Umbraco.Mcp/ToolSettings/McpCatalogueReport.cs`
- Create: `src/Umbraco.Mcp/ToolSettings/IMcpToolSettingsStore.cs`
- Create: `src/Umbraco.Mcp/ToolSettings/KeyValueMcpToolSettingsStore.cs`
- Test: `tests/Umbraco.Mcp.Tests/KeyValueMcpToolSettingsStoreTests.cs`

**Interfaces:**
- Consumes: `IKeyValueService` (Umbraco), existing `FakeKeyValueService` in `Fakes.cs`.
- Produces:
  - `record McpCollectionInfo(string Name, int ToolCount)`
  - `record McpModuleCatalogue(DateTimeOffset ReportedAt, bool SiteSettingsIgnored, IReadOnlyList<McpCollectionInfo> Collections)`
  - `record McpToolCatalogue(string? UmbrellaVersion, IReadOnlyDictionary<string, McpModuleCatalogue> Modules)` with `static McpToolCatalogue Empty`
  - `record McpModuleReport(string Id, bool SiteSettingsIgnored, IReadOnlyList<McpCollectionInfo> Collections)`
  - `record McpCatalogueReport(string UmbrellaVersion, IReadOnlyList<McpModuleReport> Modules)`
  - `interface IMcpToolSettingsStore { IReadOnlyDictionary<string, IReadOnlyList<string>> GetDisabledCollections(); void SetDisabledCollections(IReadOnlyDictionary<string, IReadOnlyList<string>> disabled); McpToolCatalogue GetCatalogue(); void MergeCatalogue(McpCatalogueReport report, DateTimeOffset at); }`
  - `KeyValueMcpToolSettingsStore(IKeyValueService, ILogger<KeyValueMcpToolSettingsStore>)` with `internal const string SettingsKey = "Umbraco.Mcp.ToolSettings"` and `internal const string CatalogueKey = "Umbraco.Mcp.Catalogue"`

- [ ] **Step 1: Write the failing tests**

`tests/Umbraco.Mcp.Tests/KeyValueMcpToolSettingsStoreTests.cs`:

```csharp
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class KeyValueMcpToolSettingsStoreTests
{
    private static readonly DateTimeOffset First = new(2026, 10, 12, 9, 0, 0, TimeSpan.Zero);

    private static KeyValueMcpToolSettingsStore Store(FakeKeyValueService values) =>
        new(values, NullLogger<KeyValueMcpToolSettingsStore>.Instance);

    private static McpModuleReport Module(string id, params string[] collections) =>
        new(id, false, collections.Select(c => new McpCollectionInfo(c, 3)).ToList());

    [Test]
    public void Nothing_stored_means_nothing_disabled_and_nothing_reported()
    {
        var store = Store(new FakeKeyValueService());

        Assert.That(store.GetDisabledCollections(), Is.Empty);
        Assert.That(store.GetCatalogue().Modules, Is.Empty);
        Assert.That(store.GetCatalogue().UmbrellaVersion, Is.Null);
    }

    [Test]
    public void Disabled_collections_round_trip_as_camel_case_json()
    {
        var values = new FakeKeyValueService();
        var store = Store(values);

        store.SetDisabledCollections(new Dictionary<string, IReadOnlyList<string>>
        {
            ["forms"] = ["prevalue-source"],
            ["cms"] = ["log-viewer", "models-builder"],
        });

        Assert.That(store.GetDisabledCollections()["forms"], Is.EqualTo(new[] { "prevalue-source" }));
        Assert.That(store.GetDisabledCollections()["cms"], Is.EqualTo(new[] { "log-viewer", "models-builder" }));
        Assert.That(values.Values[KeyValueMcpToolSettingsStore.SettingsKey], Does.Contain("\"forms\":[\"prevalue-source\"]"));
    }

    // Review Focus 5: a module that failed to load on one start keeps its last entry.
    [Test]
    public void A_report_overwrites_the_modules_it_contains_and_keeps_the_others()
    {
        var store = Store(new FakeKeyValueService());
        store.MergeCatalogue(new McpCatalogueReport("17.0.0-alpha.1", [Module("forms", "form", "prevalue-source"), Module("engage", "persona")]), First);

        store.MergeCatalogue(new McpCatalogueReport("17.0.0-alpha.2", [Module("forms", "form")]), First.AddHours(1));

        McpToolCatalogue catalogue = store.GetCatalogue();
        Assert.That(catalogue.UmbrellaVersion, Is.EqualTo("17.0.0-alpha.2"));
        Assert.That(catalogue.Modules["forms"].ReportedAt, Is.EqualTo(First.AddHours(1)));
        Assert.That(catalogue.Modules["forms"].Collections.Select(c => c.Name), Is.EqualTo(new[] { "form" }));
        Assert.That(catalogue.Modules["engage"].ReportedAt, Is.EqualTo(First));
        Assert.That(catalogue.Modules["engage"].Collections.Single(), Is.EqualTo(new McpCollectionInfo("persona", 3)));
    }

    [Test]
    public void The_catalogue_is_stored_as_camel_case_json()
    {
        var values = new FakeKeyValueService();
        Store(values).MergeCatalogue(new McpCatalogueReport("1.0.0", [Module("forms", "prevalue-source")]), First);

        string json = values.Values[KeyValueMcpToolSettingsStore.CatalogueKey]!;
        Assert.That(json, Does.Contain("\"umbrellaVersion\":\"1.0.0\""));
        Assert.That(json, Does.Contain("\"toolCount\":3"));
        Assert.That(json, Does.Contain("\"siteSettingsIgnored\":false"));
    }

    [Test]
    public void Corrupt_rows_read_as_empty()
    {
        var values = new FakeKeyValueService();
        values.SetValue(KeyValueMcpToolSettingsStore.SettingsKey, "{not json");
        values.SetValue(KeyValueMcpToolSettingsStore.CatalogueKey, "[1,2,3]");
        var store = Store(values);

        Assert.That(store.GetDisabledCollections(), Is.Empty);
        Assert.That(store.GetCatalogue().Modules, Is.Empty);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter KeyValueMcpToolSettingsStoreTests`
Expected: build FAIL, `The type or namespace name 'ToolSettings' does not exist in the namespace 'Umbraco.Mcp'`.

- [ ] **Step 3: Write the records**

`src/Umbraco.Mcp/ToolSettings/McpToolCatalogue.cs`:

```csharp
namespace Umbraco.Mcp.ToolSettings;

/// <summary>One tool group (collection) of a module and how many of its tools the MCP's API user can use.</summary>
public sealed record McpCollectionInfo(string Name, int ToolCount);

/// <summary>What the MCP server last reported for one module.</summary>
public sealed record McpModuleCatalogue(DateTimeOffset ReportedAt, bool SiteSettingsIgnored, IReadOnlyList<McpCollectionInfo> Collections);

/// <summary>Every module the MCP server has reported, by module id.</summary>
public sealed record McpToolCatalogue(string? UmbrellaVersion, IReadOnlyDictionary<string, McpModuleCatalogue> Modules)
{
    public static McpToolCatalogue Empty { get; } = new(null, new Dictionary<string, McpModuleCatalogue>());
}
```

`src/Umbraco.Mcp/ToolSettings/McpCatalogueReport.cs`:

```csharp
namespace Umbraco.Mcp.ToolSettings;

/// <summary>One module in the catalogue the MCP server reports when it starts.</summary>
public sealed record McpModuleReport(string Id, bool SiteSettingsIgnored, IReadOnlyList<McpCollectionInfo> Collections);

/// <summary>The body of <c>POST /mcp/catalogue</c>: the modules the MCP server loaded, before any filter.</summary>
public sealed record McpCatalogueReport(string UmbrellaVersion, IReadOnlyList<McpModuleReport> Modules);
```

`src/Umbraco.Mcp/ToolSettings/IMcpToolSettingsStore.cs`:

```csharp
namespace Umbraco.Mcp.ToolSettings;

/// <summary>The tool groups switched off in the backoffice, and the groups the MCP server last reported.</summary>
public interface IMcpToolSettingsStore
{
    /// <summary>Disabled collection names by module id. Empty when nothing is stored.</summary>
    IReadOnlyDictionary<string, IReadOnlyList<string>> GetDisabledCollections();

    void SetDisabledCollections(IReadOnlyDictionary<string, IReadOnlyList<string>> disabled);

    McpToolCatalogue GetCatalogue();

    /// <summary>Overwrites the modules in <paramref name="report"/> and keeps every other module's last entry.</summary>
    void MergeCatalogue(McpCatalogueReport report, DateTimeOffset at);
}
```

- [ ] **Step 4: Write the store**

`src/Umbraco.Mcp/ToolSettings/KeyValueMcpToolSettingsStore.cs`:

```csharp
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Umbraco.Cms.Core.Services;

namespace Umbraco.Mcp.ToolSettings;

/// <summary>
/// Keeps the tool settings and the catalogue as JSON in Umbraco's key/value table (<c>umbracoKeyValue</c>), so they
/// survive restarts and are shared by every server of a load-balanced site.
/// </summary>
public sealed class KeyValueMcpToolSettingsStore(IKeyValueService keyValues, ILogger<KeyValueMcpToolSettingsStore> logger)
    : IMcpToolSettingsStore
{
    internal const string SettingsKey = "Umbraco.Mcp.ToolSettings";
    internal const string CatalogueKey = "Umbraco.Mcp.Catalogue";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public IReadOnlyDictionary<string, IReadOnlyList<string>> GetDisabledCollections() =>
        Read<Dictionary<string, IReadOnlyList<string>>>(SettingsKey) ?? new Dictionary<string, IReadOnlyList<string>>();

    public void SetDisabledCollections(IReadOnlyDictionary<string, IReadOnlyList<string>> disabled) =>
        keyValues.SetValue(SettingsKey, JsonSerializer.Serialize(disabled, Json));

    public McpToolCatalogue GetCatalogue() => Read<McpToolCatalogue>(CatalogueKey) is { Modules: not null } c ? c : McpToolCatalogue.Empty;

    public void MergeCatalogue(McpCatalogueReport report, DateTimeOffset at)
    {
        var modules = new Dictionary<string, McpModuleCatalogue>(GetCatalogue().Modules, StringComparer.Ordinal);
        foreach (McpModuleReport module in report.Modules)
        {
            modules[module.Id] = new McpModuleCatalogue(at, module.SiteSettingsIgnored, module.Collections);
        }

        keyValues.SetValue(CatalogueKey, JsonSerializer.Serialize(new McpToolCatalogue(report.UmbrellaVersion, modules), Json));
    }

    private T? Read<T>(string key)
        where T : class
    {
        string? value = keyValues.GetValue(key);
        if (string.IsNullOrEmpty(value))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(value, Json);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "The stored MCP tool settings ({Key}) are not valid JSON and are ignored.", key);
            return null;
        }
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter KeyValueMcpToolSettingsStoreTests`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/Umbraco.Mcp/ToolSettings tests/Umbraco.Mcp.Tests/KeyValueMcpToolSettingsStoreTests.cs
git commit -m "feat(addon): store MCP tool settings and catalogue in the key/value table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `disabledCollections` in the capabilities payload (.NET)

**Files:**
- Modify: `src/Umbraco.Mcp/Detection/McpProductStatus.cs`
- Modify: `src/Umbraco.Mcp/Capabilities/McpCapabilitiesService.cs`
- Modify: `src/Umbraco.Mcp/McpComposer.cs`
- Modify: `tests/Umbraco.Mcp.Tests/Fakes.cs`
- Test: `tests/Umbraco.Mcp.Tests/McpCapabilitiesServiceTests.cs`

**Interfaces:**
- Consumes: `IMcpToolSettingsStore` (Task 1).
- Produces:
  - `McpProductStatus.DisabledCollections` (`IReadOnlyList<string>`, init, default `[]`, JSON `disabledCollections`)
  - `McpCapabilitiesService(IEnumerable<IMcpProductDetector> detectors, IMcpToolSettingsStore toolSettings, ILogger<McpCapabilitiesService> logger)`
  - `FakeToolSettingsStore` in `Fakes.cs`: settable `Disabled`, `Catalogue`, `Throws`; records `Merged` reports

- [ ] **Step 1: Add the fake store**

Append to `tests/Umbraco.Mcp.Tests/Fakes.cs` (add `using Umbraco.Mcp.ToolSettings;` at the top):

```csharp
internal sealed class FakeToolSettingsStore : IMcpToolSettingsStore
{
    public Dictionary<string, IReadOnlyList<string>> Disabled { get; set; } = new();

    public McpToolCatalogue Catalogue { get; set; } = McpToolCatalogue.Empty;

    public List<(McpCatalogueReport Report, DateTimeOffset At)> Merged { get; } = [];

    public Exception? Throws { get; init; }

    public IReadOnlyDictionary<string, IReadOnlyList<string>> GetDisabledCollections() => Throws is null ? Disabled : throw Throws;

    public void SetDisabledCollections(IReadOnlyDictionary<string, IReadOnlyList<string>> disabled) =>
        Disabled = new Dictionary<string, IReadOnlyList<string>>(disabled);

    public McpToolCatalogue GetCatalogue() => Catalogue;

    public void MergeCatalogue(McpCatalogueReport report, DateTimeOffset at) => Merged.Add((report, at));
}
```

- [ ] **Step 2: Write the failing tests**

In `tests/Umbraco.Mcp.Tests/McpCapabilitiesServiceTests.cs`, add `using System.Text.Json;` and `using Microsoft.Extensions.Logging.Abstractions;`, add this helper inside the class:

```csharp
    private static McpCapabilitiesService Service(IEnumerable<IMcpProductDetector> detectors, FakeToolSettingsStore? store = null) =>
        new(detectors, store ?? new FakeToolSettingsStore(), NullLogger<McpCapabilitiesService>.Instance);
```

replace the two existing `new McpCapabilitiesService(...)` calls with `Service(...)` (same detector arrays), and add:

```csharp
    [Test]
    public void Each_product_carries_its_disabled_collections()
    {
        var a = new FakeAssemblies();
        var r = new FakeApis();
        var store = new FakeToolSettingsStore { Disabled = new() { ["forms"] = ["prevalue-source"] } };

        McpCapabilities caps = Service([new FormsDetector(a, r), new AutomateDetector(a, r)], store).GetCapabilities();

        Assert.That(caps.Products[0].DisabledCollections, Is.EqualTo(new[] { "prevalue-source" }));
        Assert.That(caps.Products[1].DisabledCollections, Is.Empty);
    }

    [Test]
    public void A_throwing_store_gives_empty_lists_not_an_exception()
    {
        var store = new FakeToolSettingsStore { Throws = new InvalidOperationException("database is down") };

        McpCapabilities caps = Service([new FormsDetector(new FakeAssemblies(), new FakeApis())], store).GetCapabilities();

        Assert.That(caps.Products.Single().DisabledCollections, Is.Empty);
    }

    [Test]
    public void Disabled_collections_serialise_as_camel_case()
    {
        var store = new FakeToolSettingsStore { Disabled = new() { ["forms"] = ["prevalue-source"] } };
        McpCapabilities caps = Service([new FormsDetector(new FakeAssemblies(), new FakeApis())], store).GetCapabilities();

        string json = JsonSerializer.Serialize(caps, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.That(json, Does.Contain("\"disabledCollections\":[\"prevalue-source\"]"));
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter McpCapabilitiesServiceTests`
Expected: build FAIL, `'McpCapabilitiesService' does not contain a constructor that takes 3 arguments`.

- [ ] **Step 4: Implement**

`src/Umbraco.Mcp/Detection/McpProductStatus.cs`:

```csharp
namespace Umbraco.Mcp.Detection;

public sealed record McpProductStatus(
    string Id,
    string DisplayName,
    bool Installed,
    bool Enabled,
    string? Version,
    IReadOnlyList<string> Issues)
{
    /// <summary>Tool groups switched off in the backoffice. The npm server excludes them unless its environment overrides it.</summary>
    public IReadOnlyList<string> DisabledCollections { get; init; } = [];
}
```

`src/Umbraco.Mcp/Capabilities/McpCapabilitiesService.cs`:

```csharp
using Microsoft.Extensions.Logging;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Capabilities;

public sealed class McpCapabilitiesService(
    IEnumerable<IMcpProductDetector> detectors,
    IMcpToolSettingsStore toolSettings,
    ILogger<McpCapabilitiesService> logger) : IMcpCapabilitiesService
{
    public McpCapabilities GetCapabilities()
    {
        IReadOnlyDictionary<string, IReadOnlyList<string>> disabled = SafeDisabledCollections();
        return new(
            McpAddon.Version,
            detectors.Select(d => SafeDetect(d) with { DisabledCollections = disabled.GetValueOrDefault(d.Id) ?? [] }).ToList());
    }

    private IReadOnlyDictionary<string, IReadOnlyList<string>> SafeDisabledCollections()
    {
        try
        {
            return toolSettings.GetDisabledCollections();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read the MCP tool settings. No tool groups are disabled in the capabilities.");
            return new Dictionary<string, IReadOnlyList<string>>();
        }
    }

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

In `src/Umbraco.Mcp/McpComposer.cs` add `using Umbraco.Mcp.ToolSettings;` and, after the connection store line:

```csharp
        builder.Services.AddSingleton<IMcpToolSettingsStore, KeyValueMcpToolSettingsStore>();
```

- [ ] **Step 5: Run all .NET tests**

Run: `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`
Expected: all pass (existing health-check tests construct `McpProductStatus` positionally and are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/Umbraco.Mcp/Detection/McpProductStatus.cs src/Umbraco.Mcp/Capabilities/McpCapabilitiesService.cs src/Umbraco.Mcp/McpComposer.cs tests/Umbraco.Mcp.Tests/Fakes.cs tests/Umbraco.Mcp.Tests/McpCapabilitiesServiceTests.cs
git commit -m "feat(addon): report backoffice-disabled tool groups in capabilities

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tool settings API (.NET)

**Files:**
- Create: `src/Umbraco.Mcp/ToolSettings/McpToolSettingsValidation.cs`
- Create: `src/Umbraco.Mcp/Api/McpToolSettingsController.cs`
- Test: `tests/Umbraco.Mcp.Tests/McpToolSettingsControllerTests.cs`

**Interfaces:**
- Consumes: `IMcpToolSettingsStore`, `McpCatalogueReport`, `McpModuleReport`, `McpCollectionInfo` (Task 1); `IMcpCapabilitiesService`, `McpProductStatus.DisabledCollections` (Task 2); `FakeToolSettingsStore`, `FakeBackOfficeSecurityAccessor` (`Fakes.cs`).
- Produces:
  - `GET /umbraco/management/api/v1/mcp/tool-settings` → `McpToolSettingsResponse(IReadOnlyList<McpProductStatus> Products, McpToolCatalogue Catalogue, IReadOnlyDictionary<string, IReadOnlyList<string>> DisabledCollections)` (JSON: `products`, `catalogue`, `disabledCollections`)
  - `PUT  .../tool-settings` body `McpToolSettingsRequest(IReadOnlyDictionary<string, IReadOnlyList<string>?>? DisabledCollections)` → 200 with the normalised `IReadOnlyDictionary<string, IReadOnlyList<string>>`, or 400 `ProblemDetails`
  - `POST .../catalogue` body `McpCatalogueReport` → 204, 400 or 403
  - `McpToolSettingsValidation.MaxModules = 50`, `MaxCollections = 200`, `MaxNameLength = 100`

- [ ] **Step 1: Write the failing tests**

`tests/Umbraco.Mcp.Tests/McpToolSettingsControllerTests.cs`:

```csharp
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NUnit.Framework;
using Umbraco.Cms.Core.Configuration.Models;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.Api;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpToolSettingsControllerTests
{
    private sealed class StubCapabilities(params string[] ids) : IMcpCapabilitiesService
    {
        public McpCapabilities GetCapabilities() =>
            new("17.0.0", ids.Select(id => new McpProductStatus(id, id, true, true, "17.0.0", [])).ToList());
    }

    private static IUser User(UserKind kind) => new User(new GlobalSettings()) { Key = Guid.NewGuid(), Kind = kind };

    private static McpToolSettingsController Controller(FakeToolSettingsStore store, IUser? user = null) =>
        new(store, new StubCapabilities("cms", "forms"), new FakeBackOfficeSecurityAccessor(user ?? User(UserKind.Default)));

    private static McpCatalogueReport Report(string id = "forms", int collections = 1, string name = "prevalue-source") =>
        new("17.0.0-alpha.1", [new McpModuleReport(id, false, Enumerable.Range(0, collections).Select(i => new McpCollectionInfo(collections == 1 ? name : $"{name}-{i}", 10)).ToList())]);

    private static string? PolicyOf(string method) =>
        typeof(McpToolSettingsController).GetMethod(method)!.GetCustomAttribute<AuthorizeAttribute>()?.Policy;

    [Test]
    public void Controller_requires_back_office_access_and_settings_for_the_dashboard_endpoints()
    {
        Assert.That(typeof(McpToolSettingsController).GetCustomAttribute<AuthorizeAttribute>(inherit: false)!.Policy,
            Is.EqualTo(AuthorizationPolicies.BackOfficeAccess));
        Assert.That(PolicyOf(nameof(McpToolSettingsController.GetToolSettings)), Is.EqualTo(AuthorizationPolicies.SectionAccessSettings));
        Assert.That(PolicyOf(nameof(McpToolSettingsController.PutToolSettings)), Is.EqualTo(AuthorizationPolicies.SectionAccessSettings));
        Assert.That(PolicyOf(nameof(McpToolSettingsController.PostCatalogue)), Is.Null);
    }

    [Test]
    public void Get_returns_products_catalogue_and_disabled_lists()
    {
        var store = new FakeToolSettingsStore { Disabled = new() { ["forms"] = ["prevalue-source"] } };

        var body = (McpToolSettingsResponse)((OkObjectResult)Controller(store).GetToolSettings()).Value!;

        Assert.That(body.Products.Select(p => p.Id), Is.EqualTo(new[] { "cms", "forms" }));
        Assert.That(body.Catalogue, Is.SameAs(store.Catalogue));
        Assert.That(body.DisabledCollections["forms"], Is.EqualTo(new[] { "prevalue-source" }));
    }

    [Test]
    public void Put_trims_drops_empty_and_deduplicates_names()
    {
        var store = new FakeToolSettingsStore();

        IActionResult result = Controller(store).PutToolSettings(new McpToolSettingsRequest(new Dictionary<string, IReadOnlyList<string>?>
        {
            ["forms"] = [" prevalue-source ", "", "prevalue-source", "data-source"],
            ["cms"] = null,
        }));

        Assert.That(result, Is.InstanceOf<OkObjectResult>());
        Assert.That(store.Disabled["forms"], Is.EqualTo(new[] { "prevalue-source", "data-source" }));
        Assert.That(store.Disabled["cms"], Is.Empty);
    }

    [TestCase("commerce")]
    [TestCase("Forms")]
    public void Put_rejects_a_module_id_that_is_not_a_detected_product(string id)
    {
        var store = new FakeToolSettingsStore();

        IActionResult result = Controller(store).PutToolSettings(
            new McpToolSettingsRequest(new Dictionary<string, IReadOnlyList<string>?> { [id] = ["x"] }));

        Assert.That(result, Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(store.Disabled, Is.Empty);
    }

    [Test]
    public void Put_rejects_a_missing_body_and_oversized_lists()
    {
        var store = new FakeToolSettingsStore();
        var tooMany = Enumerable.Range(0, McpToolSettingsValidation.MaxCollections + 1).Select(i => $"c{i}").ToList();
        var tooLong = new string('x', McpToolSettingsValidation.MaxNameLength + 1);

        Assert.That(Controller(store).PutToolSettings(new McpToolSettingsRequest(null)), Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(Controller(store).PutToolSettings(new McpToolSettingsRequest(new Dictionary<string, IReadOnlyList<string>?> { ["forms"] = tooMany })),
            Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(Controller(store).PutToolSettings(new McpToolSettingsRequest(new Dictionary<string, IReadOnlyList<string>?> { ["forms"] = [tooLong] })),
            Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(store.Disabled, Is.Empty);
    }

    [Test]
    public void Post_from_a_normal_backoffice_user_is_forbidden_and_not_stored()
    {
        var store = new FakeToolSettingsStore();

        IActionResult result = Controller(store, User(UserKind.Default)).PostCatalogue(Report());

        Assert.That(result, Is.InstanceOf<StatusCodeResult>().With.Property(nameof(StatusCodeResult.StatusCode)).EqualTo(403));
        Assert.That(store.Merged, Is.Empty);
    }

    [Test]
    public void Post_from_an_api_user_merges_the_report_with_the_current_time()
    {
        var store = new FakeToolSettingsStore();
        DateTimeOffset before = DateTimeOffset.UtcNow;

        IActionResult result = Controller(store, User(UserKind.Api)).PostCatalogue(Report());

        Assert.That(result, Is.InstanceOf<NoContentResult>());
        Assert.That(store.Merged.Single().Report.Modules.Single().Collections.Single(), Is.EqualTo(new McpCollectionInfo("prevalue-source", 10)));
        Assert.That(store.Merged.Single().At, Is.InRange(before, DateTimeOffset.UtcNow));
    }

    // Review Focus 4: a newer npm may report a module this add-on has no detector for.
    [Test]
    public void Post_accepts_a_module_the_add_on_does_not_know()
    {
        var store = new FakeToolSettingsStore();

        Assert.That(Controller(store, User(UserKind.Api)).PostCatalogue(Report("commerce")), Is.InstanceOf<NoContentResult>());
        Assert.That(store.Merged.Single().Report.Modules.Single().Id, Is.EqualTo("commerce"));
    }

    [Test]
    public void Post_rejects_oversized_reports()
    {
        var store = new FakeToolSettingsStore();
        var api = User(UserKind.Api);

        Assert.That(Controller(store, api).PostCatalogue(Report(collections: McpToolSettingsValidation.MaxCollections + 1)), Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(Controller(store, api).PostCatalogue(Report(name: new string('x', McpToolSettingsValidation.MaxNameLength + 1))), Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(Controller(store, api).PostCatalogue(Report(id: "")), Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(store.Merged, Is.Empty);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter McpToolSettingsControllerTests`
Expected: build FAIL, `The type or namespace name 'McpToolSettingsController' could not be found`.

- [ ] **Step 3: Write the validation**

`src/Umbraco.Mcp/ToolSettings/McpToolSettingsValidation.cs`:

```csharp
namespace Umbraco.Mcp.ToolSettings;

/// <summary>Normalises and size-caps what clients send, so a stray client cannot bloat the key/value table.</summary>
internal static class McpToolSettingsValidation
{
    public const int MaxModules = 50;
    public const int MaxCollections = 200;
    public const int MaxNameLength = 100;

    /// <returns>An error message, or null when <paramref name="result"/> holds the normalised lists.</returns>
    public static string? TryNormalizeSettings(
        IReadOnlyDictionary<string, IReadOnlyList<string>?>? input,
        ISet<string> knownModuleIds,
        out Dictionary<string, IReadOnlyList<string>> result)
    {
        result = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        if (input is null)
        {
            return "disabledCollections is required.";
        }

        if (input.Count > MaxModules)
        {
            return $"At most {MaxModules} modules are allowed.";
        }

        foreach ((string id, IReadOnlyList<string>? names) in input)
        {
            if (!knownModuleIds.Contains(id))
            {
                return $"\"{id}\" is not a product this site detects.";
            }

            string? error = TryNormalizeNames(names, out List<string> clean);
            if (error is not null)
            {
                return $"{id}: {error}";
            }

            result[id] = clean;
        }

        return null;
    }

    /// <returns>An error message, or null when <paramref name="result"/> holds the normalised report.</returns>
    public static string? TryNormalizeReport(McpCatalogueReport? report, out McpCatalogueReport result)
    {
        result = new McpCatalogueReport(string.Empty, []);
        if (report?.Modules is null)
        {
            return "modules is required.";
        }

        if (report.Modules.Count > MaxModules)
        {
            return $"At most {MaxModules} modules are allowed.";
        }

        var modules = new List<McpModuleReport>();
        foreach (McpModuleReport? module in report.Modules)
        {
            string id = module?.Id?.Trim() ?? string.Empty;
            if (id.Length == 0 || id.Length > MaxNameLength)
            {
                return $"Module ids must be 1 to {MaxNameLength} characters.";
            }

            IReadOnlyList<McpCollectionInfo> collections = module!.Collections ?? [];
            string? error = TryNormalizeNames(collections.Select(c => c?.Name).ToList(), out List<string> names);
            if (error is not null)
            {
                return $"{id}: {error}";
            }

            var counts = collections.Where(c => c?.Name is not null).GroupBy(c => c.Name.Trim()).ToDictionary(g => g.Key, g => Math.Max(0, g.First().ToolCount));
            modules.Add(new McpModuleReport(id, module.SiteSettingsIgnored, names.Select(n => new McpCollectionInfo(n, counts[n])).ToList()));
        }

        string version = report.UmbrellaVersion?.Trim() ?? string.Empty;
        result = new McpCatalogueReport(version.Length > MaxNameLength ? version[..MaxNameLength] : version, modules);
        return null;
    }

    private static string? TryNormalizeNames(IReadOnlyList<string?>? names, out List<string> clean)
    {
        clean = (names ?? []).Where(n => n is not null).Select(n => n!.Trim()).Where(n => n.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        if (clean.Count > MaxCollections)
        {
            return $"At most {MaxCollections} collections are allowed.";
        }

        return clean.Any(n => n.Length > MaxNameLength) ? $"Collection names must be at most {MaxNameLength} characters." : null;
    }
}
```

- [ ] **Step 4: Write the controller**

`src/Umbraco.Mcp/Api/McpToolSettingsController.cs`:

```csharp
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Api;

public sealed record McpToolSettingsResponse(
    IReadOnlyList<McpProductStatus> Products,
    McpToolCatalogue Catalogue,
    IReadOnlyDictionary<string, IReadOnlyList<string>> DisabledCollections);

public sealed record McpToolSettingsRequest(IReadOnlyDictionary<string, IReadOnlyList<string>?>? DisabledCollections);

[ApiVersion("1.0")]
[VersionedApiBackOfficeRoute("mcp")]
[ApiExplorerSettings(GroupName = "MCP")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess)]
public sealed class McpToolSettingsController(
    IMcpToolSettingsStore store,
    IMcpCapabilitiesService capabilities,
    IBackOfficeSecurityAccessor backOfficeSecurityAccessor) : ManagementApiControllerBase
{
    /// <summary>What the "Umbrella" dashboard shows: the products, the groups the MCP server reported, and what is switched off.</summary>
    [HttpGet("tool-settings")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(McpToolSettingsResponse), StatusCodes.Status200OK)]
    public IActionResult GetToolSettings() =>
        Ok(new McpToolSettingsResponse(capabilities.GetCapabilities().Products, store.GetCatalogue(), store.GetDisabledCollections()));

    [HttpPut("tool-settings")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(IReadOnlyDictionary<string, IReadOnlyList<string>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    public IActionResult PutToolSettings([FromBody] McpToolSettingsRequest request)
    {
        var known = capabilities.GetCapabilities().Products.Select(p => p.Id).ToHashSet(StringComparer.Ordinal);
        string? error = McpToolSettingsValidation.TryNormalizeSettings(request?.DisabledCollections, known, out var disabled);
        if (error is not null)
        {
            return BadRequest(new ProblemDetails { Title = "Invalid MCP tool settings", Detail = error });
        }

        store.SetDisabledCollections(disabled);
        return Ok(disabled);
    }

    /// <summary>
    /// The MCP server calls this once when it starts, signed in as its API user, with every tool group it loaded. Calls
    /// from normal backoffice users (for example Swagger) are not the MCP server and are refused.
    /// </summary>
    [HttpPost("catalogue")]
    [MapToApiVersion("1.0")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public IActionResult PostCatalogue([FromBody] McpCatalogueReport report)
    {
        if (backOfficeSecurityAccessor.BackOfficeSecurity?.CurrentUser?.Kind != UserKind.Api)
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }

        string? error = McpToolSettingsValidation.TryNormalizeReport(report, out McpCatalogueReport normalized);
        if (error is not null)
        {
            return BadRequest(new ProblemDetails { Title = "Invalid MCP catalogue", Detail = error });
        }

        store.MergeCatalogue(normalized, DateTimeOffset.UtcNow);
        return NoContent();
    }
}
```

- [ ] **Step 5: Run all .NET tests**

Run: `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/Umbraco.Mcp/ToolSettings/McpToolSettingsValidation.cs src/Umbraco.Mcp/Api/McpToolSettingsController.cs tests/Umbraco.Mcp.Tests/McpToolSettingsControllerTests.cs
git commit -m "feat(addon): tool-settings and catalogue endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Read `disabledCollections` from capabilities (npm)

**Files:**
- Modify: `npm/src/core/capabilities.ts`
- Test: `npm/src/core/__tests__/capabilities.test.ts`

**Interfaces:**
- Produces: `ProductCapability.disabledCollections?: string[] | null`; `siteDisabledCollections(caps: CapabilitiesResult, moduleId: string): string[]`

- [ ] **Step 1: Write the failing tests**

In `npm/src/core/__tests__/capabilities.test.ts`, change the import to `import { fetchCapabilities, interpretCapabilitiesResponse, siteDisabledCollections } from "../capabilities.js";`, add to the malformed `it.each` table:

```ts
    ["disabledCollections not a string array", { addonVersion: "1", products: [{ ...payload.products[0], disabledCollections: [1] }] }],
```

and append:

```ts
describe("siteDisabledCollections", () => {
  const withDisabled = (disabledCollections: unknown) =>
    interpretCapabilitiesResponse({ status: 200, data: { ...payload, products: [{ ...payload.products[1], disabledCollections }] } });

  it("returns the module's list", () => {
    expect(siteDisabledCollections(withDisabled(["prevalue-source"]), "forms")).toEqual(["prevalue-source"]);
  });

  it("is empty for an old add-on without the field, another module, or no add-on", () => {
    expect(siteDisabledCollections(interpretCapabilitiesResponse({ status: 200, data: payload }), "forms")).toEqual([]);
    expect(siteDisabledCollections(withDisabled(["prevalue-source"]), "cms")).toEqual([]);
    expect(siteDisabledCollections({ kind: "no-addon" }, "forms")).toEqual([]);
    expect(siteDisabledCollections({ kind: "unavailable", reason: "x" }, "forms")).toEqual([]);
  });

  // Review Focus 1: a null must not make the whole payload unexpected.
  it("treats null as empty and keeps the payload ok", () => {
    const r = withDisabled(null);
    expect(r.kind).toBe("ok");
    expect(siteDisabledCollections(r, "forms")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd npm && npm test -- capabilities`
Expected: FAIL, `siteDisabledCollections is not a function` (and the new malformed case is accepted as ok).

- [ ] **Step 3: Implement**

In `npm/src/core/capabilities.ts`, add to `ProductCapability`:

```ts
  /** Tool groups switched off in the backoffice. Missing on add-ons before 17.0.0-alpha.2. */
  disabledCollections?: string[] | null;
```

Extend `isProduct`'s return expression with:

```ts
    (o.disabledCollections === undefined ||
      o.disabledCollections === null ||
      (Array.isArray(o.disabledCollections) && o.disabledCollections.every((c) => typeof c === "string"))) &&
```

(insert before `Array.isArray(o.issues)`), and append:

```ts
/** The collections the site disabled for a module; empty without the add-on or on add-ons that predate the field. */
export function siteDisabledCollections(caps: CapabilitiesResult, moduleId: string): string[] {
  if (caps.kind !== "ok") return [];
  return caps.payload.products.find((p) => p.id === moduleId)?.disabledCollections ?? [];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd npm && npm test -- capabilities && npm run compile`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add npm/src/core/capabilities.ts npm/src/core/__tests__/capabilities.test.ts
git commit -m "feat(npm): read backoffice-disabled collections from capabilities

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fold the site list into each module's filter, env wins (npm)

**Files:**
- Modify: `npm/src/core/filter-config.ts`
- Test: `npm/src/core/__tests__/filter-config.test.ts`

**Interfaces:**
- Consumes: existing `buildModuleFilterInput(env, moduleId, isDefaultModule)` (unchanged).
- Produces:
  - `envSetsCollectionFilter(env: NodeJS.ProcessEnv, moduleId: string, isDefaultModule: boolean): boolean`
  - `buildEffectiveFilterInput(env, moduleId, isDefaultModule, siteDisabled: readonly string[]): { config: ServerConfigForCollections; siteSettingsIgnored: boolean }`

- [ ] **Step 1: Write the failing tests**

Append to `npm/src/core/__tests__/filter-config.test.ts` (and change the import to `import { buildEffectiveFilterInput, buildModuleFilterInput, envSetsCollectionFilter } from "../filter-config.js";`, plus `import { createCollectionConfigLoader, shouldIncludeTool } from "@umbraco-cms/mcp-server-sdk";`):

```ts
describe("envSetsCollectionFilter", () => {
  it.each([
    ["forms exclude", { UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "forms:record" }, "forms", false, true],
    ["forms include", { UMBRACO_INCLUDE_TOOL_COLLECTIONS: "forms:form" }, "forms", false, true],
    ["forms:*", { UMBRACO_INCLUDE_TOOL_COLLECTIONS: "forms:*" }, "forms", false, true],
    ["unprefixed counts for CMS", { UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "log-viewer" }, "cms", true, true],
    ["unprefixed does not count for forms", { UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "log-viewer" }, "forms", false, false],
    ["another module only", { UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "engage:persona" }, "forms", false, false],
    // Review Focus 3
    ["empty item forms:", { UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "forms:, " }, "forms", false, false],
    ["tool-level lists", { UMBRACO_EXCLUDE_TOOLS: "forms:delete-form", UMBRACO_INCLUDE_TOOLS: "forms--list-forms" }, "forms", false, false],
    ["modes", { UMBRACO_TOOL_MODES: "forms:forms" }, "forms", false, false],
    ["nothing set", {}, "forms", false, false],
  ])("%s", (_label, env, id, isDefault, expected) => {
    expect(envSetsCollectionFilter(env as NodeJS.ProcessEnv, id, isDefault)).toBe(expected);
  });
});

describe("buildEffectiveFilterInput", () => {
  it("turns the site list into excludeToolCollections when env is silent", () => {
    const r = buildEffectiveFilterInput({ UMBRACO_EXCLUDE_TOOLS: "forms:delete-form" }, "forms", false, ["prevalue-source"]);
    expect(r).toEqual({ config: { excludeTools: ["delete-form"], excludeToolCollections: ["prevalue-source"] }, siteSettingsIgnored: false });
  });

  it("ignores the site list when env sets collection filters for the module", () => {
    const r = buildEffectiveFilterInput({ UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "forms:record" }, "forms", false, ["prevalue-source"]);
    expect(r).toEqual({ config: { excludeToolCollections: ["record"] }, siteSettingsIgnored: true });
  });

  it("flags ignored even when the site disabled nothing, so the dashboard can warn", () => {
    expect(buildEffectiveFilterInput({ UMBRACO_INCLUDE_TOOL_COLLECTIONS: "forms:*" }, "forms", false, []).siteSettingsIgnored).toBe(true);
  });

  it("leaves the config unchanged when the site disabled nothing", () => {
    expect(buildEffectiveFilterInput({}, "cms", true, [])).toEqual({ config: {}, siteSettingsIgnored: false });
  });

  const include = (config: ReturnType<typeof buildEffectiveFilterInput>["config"], name: string, collectionName: string) =>
    shouldIncludeTool(
      { name, slices: ["read"] },
      { collectionName, config: createCollectionConfigLoader({ modeRegistry: [], allModeNames: [], allSliceNames: ["read"] }).loadFromConfig(config) },
    );

  it("removes the disabled collection's tools and keeps the others", () => {
    const { config } = buildEffectiveFilterInput({}, "forms", false, ["prevalue-source"]);
    expect(include(config, "get-prevalue-source", "prevalue-source")).toBe(false);
    expect(include(config, "list-forms", "form")).toBe(true);
  });

  // Review Focus 2
  it("a disabled name the module does not have changes nothing", () => {
    const { config } = buildEffectiveFilterInput({}, "forms", false, ["no-such-collection"]);
    expect(include(config, "list-forms", "form")).toBe(true);
  });

  it("an env tool allow-list still wins over a site-disabled collection", () => {
    const { config } = buildEffectiveFilterInput({ UMBRACO_INCLUDE_TOOLS: "forms--get-prevalue-source" }, "forms", false, ["prevalue-source"]);
    expect(include(config, "get-prevalue-source", "prevalue-source")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd npm && npm test -- filter-config`
Expected: FAIL, `envSetsCollectionFilter is not a function`.

- [ ] **Step 3: Implement**

Append to `npm/src/core/filter-config.ts`:

```ts
const COLLECTION_FILTERS = [MODULE_SCOPED.includeToolCollections, MODULE_SCOPED.excludeToolCollections];

/** True when the environment sets any collection filter for this module, including `module:*`. */
export function envSetsCollectionFilter(env: NodeJS.ProcessEnv, moduleId: string, isDefaultModule: boolean): boolean {
  return COLLECTION_FILTERS.some((envName) =>
    split(env[envName]).some((entry) => {
      const colon = entry.indexOf(":");
      if (colon === -1) return isDefaultModule;
      return entry.slice(0, colon).toLowerCase() === moduleId && entry.slice(colon + 1).trim().length > 0;
    }),
  );
}

/**
 * The module's filter input with the collections disabled in the backoffice added as exclusions.
 * The environment wins: when it sets collection filters for the module, the site's list is ignored.
 */
export function buildEffectiveFilterInput(
  env: NodeJS.ProcessEnv,
  moduleId: string,
  isDefaultModule: boolean,
  siteDisabled: readonly string[],
): { config: ServerConfigForCollections; siteSettingsIgnored: boolean } {
  const config = buildModuleFilterInput(env, moduleId, isDefaultModule);
  const siteSettingsIgnored = envSetsCollectionFilter(env, moduleId, isDefaultModule);
  if (!siteSettingsIgnored && siteDisabled.length > 0) config.excludeToolCollections = [...siteDisabled];
  return { config, siteSettingsIgnored };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd npm && npm test -- filter-config && npm run compile`
Expected: PASS (old and new tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add npm/src/core/filter-config.ts npm/src/core/__tests__/filter-config.test.ts
git commit -m "feat(npm): apply backoffice-disabled collections unless env sets collection filters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Build and report the catalogue (npm)

**Files:**
- Create: `npm/src/core/catalogue.ts`
- Test: `npm/src/core/__tests__/catalogue.test.ts`

**Interfaces:**
- Consumes: `LoadedModule`, `McpProductModule` (`module-contract.ts`).
- Produces:
  - `CATALOGUE_PATH = "/umbraco/management/api/v1/mcp/catalogue"`
  - `interface CataloguePayload { umbrellaVersion: string; modules: CatalogueModule[] }`, `interface CatalogueModule { id: string; siteSettingsIgnored: boolean; collections: { name: string; toolCount: number }[] }`
  - `type CatalogueReportResult = { ok: true } | { ok: false; reason: string }`
  - `buildCatalogue(version: string, modules: Array<{ module: McpProductModule; loaded: LoadedModule; siteSettingsIgnored: boolean }>, user: unknown): CataloguePayload`
  - `reportCatalogue(payload: CataloguePayload, request?: (payload: CataloguePayload) => Promise<{ status: number; data: unknown }>): Promise<CatalogueReportResult>`

- [ ] **Step 1: Write the failing tests**

`npm/src/core/__tests__/catalogue.test.ts`:

```ts
import { buildCatalogue, reportCatalogue, type CataloguePayload } from "../catalogue.js";
import type { LoadedModule, McpProductModule } from "../module-contract.js";

const mod = (id: string): McpProductModule => ({
  id, displayName: id, toolPrefix: `${id}--`, packageName: `@x/${id}`, expectedMajor: "17", description: `${id} description`, useWhen: [`${id} requests`],
  load: async () => { throw new Error("unused"); },
});

const collection = (name: string, tools: Array<{ name: string; enabled?: (user: unknown) => boolean }>) => ({
  metadata: { name, displayName: name, description: "" },
  tools: () => tools as never,
});

const loaded = (collections: LoadedModule["collections"]): LoadedModule => ({
  collections, allModes: [], allModeNames: [], allSliceNames: [], createApiClient: () => "client",
});

describe("buildCatalogue", () => {
  it("lists every collection with the tools the user can use, before filters", () => {
    const forms = loaded([
      collection("form", [{ name: "list-forms" }, { name: "admin-only", enabled: () => false }]),
      collection("prevalue-source", [{ name: "get-prevalue-source" }]),
    ]);

    expect(buildCatalogue("17.0.0", [{ module: mod("forms"), loaded: forms, siteSettingsIgnored: true }], { id: "u" })).toEqual({
      umbrellaVersion: "17.0.0",
      modules: [{
        id: "forms",
        siteSettingsIgnored: true,
        collections: [{ name: "form", toolCount: 1 }, { name: "prevalue-source", toolCount: 1 }],
      }],
    });
  });

  it("leaves out a module whose tools cannot be listed", () => {
    const broken = loaded([{ metadata: { name: "x", displayName: "x", description: "" }, tools: () => { throw new Error("boom"); } }]);
    const ok = loaded([collection("persona", [{ name: "get-persona" }])]);

    const r = buildCatalogue("1", [
      { module: mod("automate"), loaded: broken, siteSettingsIgnored: false },
      { module: mod("engage"), loaded: ok, siteSettingsIgnored: false },
    ], {});

    expect(r.modules.map((m) => m.id)).toEqual(["engage"]);
  });
});

describe("reportCatalogue", () => {
  const payload: CataloguePayload = { umbrellaVersion: "1", modules: [] };

  it("passes the payload to the request and reports success on 2xx", async () => {
    let sent: unknown;
    await expect(reportCatalogue(payload, async (p) => { sent = p; return { status: 204, data: "" }; })).resolves.toEqual({ ok: true });
    expect(sent).toBe(payload);
  });

  it.each([403, 404, 500])("turns HTTP %i into a reason", async (status) => {
    const r = await reportCatalogue(payload, async () => ({ status, data: "" }));
    expect(r).toEqual({ ok: false, reason: `Catalogue endpoint returned HTTP ${status}.` });
  });

  it("turns a thrown error into a reason instead of throwing", async () => {
    await expect(reportCatalogue(payload, async () => { throw new Error("ECONNRESET"); }))
      .resolves.toEqual({ ok: false, reason: "Request failed: ECONNRESET" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd npm && npm test -- catalogue`
Expected: FAIL, `Could not locate module ../catalogue.js`.

- [ ] **Step 3: Implement**

`npm/src/core/catalogue.ts`:

```ts
import { CAPTURE_RAW_HTTP_RESPONSE, UmbracoManagementClient, type HttpResponse } from "@umbraco-cms/mcp-server-sdk";
import type { LoadedModule, McpProductModule } from "./module-contract.js";

export const CATALOGUE_PATH = "/umbraco/management/api/v1/mcp/catalogue";

export interface CatalogueModule {
  id: string;
  /** The environment sets collection filters for this module, so the backoffice settings do not apply. */
  siteSettingsIgnored: boolean;
  collections: { name: string; toolCount: number }[];
}

export interface CataloguePayload {
  umbrellaVersion: string;
  modules: CatalogueModule[];
}

export type CatalogueReportResult = { ok: true } | { ok: false; reason: string };

type RawResponse = { status: number; data: unknown };

/** Every collection of every loaded module, before filters, so the backoffice can also show the disabled ones. */
export function buildCatalogue(
  version: string,
  modules: Array<{ module: McpProductModule; loaded: LoadedModule; siteSettingsIgnored: boolean }>,
  user: unknown,
): CataloguePayload {
  const result: CatalogueModule[] = [];
  for (const { module, loaded, siteSettingsIgnored } of modules) {
    try {
      result.push({
        id: module.id,
        siteSettingsIgnored,
        collections: loaded.collections.map((c) => ({
          name: c.metadata.name,
          toolCount: c.tools(user).filter((t) => !t.enabled || t.enabled(user)).length,
        })),
      });
    } catch {
      // A module whose tools can't be listed already reports that when it registers.
    }
  }
  return { umbrellaVersion: version, modules: result };
}

const defaultRequest = async (payload: CataloguePayload): Promise<RawResponse> =>
  (await UmbracoManagementClient<unknown>(
    { url: CATALOGUE_PATH, method: "POST", data: payload, headers: { "Content-Type": "application/json" } },
    CAPTURE_RAW_HTTP_RESPONSE,
  )) as unknown as HttpResponse<unknown>;

/** Sends the catalogue to the site. Never throws: a failure is returned for `get-mcp-health`. */
export async function reportCatalogue(
  payload: CataloguePayload,
  request: (payload: CataloguePayload) => Promise<RawResponse> = defaultRequest,
): Promise<CatalogueReportResult> {
  try {
    const { status } = await request(payload);
    return status >= 200 && status < 300 ? { ok: true } : { ok: false, reason: `Catalogue endpoint returned HTTP ${status}.` };
  } catch (error) {
    return { ok: false, reason: `Request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd npm && npm test -- catalogue && npm run compile`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add npm/src/core/catalogue.ts npm/src/core/__tests__/catalogue.test.ts
git commit -m "feat(npm): build and report the tool collection catalogue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Health notes and server wiring (npm)

**Files:**
- Modify: `npm/src/core/health.ts`
- Modify: `npm/src/core/server.ts`
- Test: `npm/src/core/__tests__/health.test.ts`

**Interfaces:**
- Consumes: `siteDisabledCollections` (Task 4), `buildEffectiveFilterInput` (Task 5), `buildCatalogue`, `reportCatalogue`, `CatalogueReportResult` (Task 6).
- Produces:
  - `ModuleRuntimeState.siteDisabledCollections?: string[]`, `ModuleRuntimeState.siteSettingsIgnored?: boolean`
  - `HealthState.catalogueReport?: CatalogueReportResult`
  - Health `notes` lines: `"<displayName>: tool groups disabled in the backoffice: a, b."`, `"<displayName>: the backoffice tool group settings are ignored because the environment sets collection filters for this module."`, `"Could not report the tool groups to the site, so the backoffice Umbrella dashboard may be out of date: <reason>"`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("buildHealthReport", ...)` block in `npm/src/core/__tests__/health.test.ts`:

```ts
  it("notes collections disabled in the backoffice", () => {
    const r = buildHealthReport(state({ kind: "no-addon" }, [{ ...cmsLoaded, siteDisabledCollections: ["log-viewer", "webhook"] }]));
    expect(r.notes).toContain("Umbraco CMS: tool groups disabled in the backoffice: log-viewer, webhook.");
  });

  it("notes when the environment overrides the backoffice settings", () => {
    const r = buildHealthReport(state({ kind: "no-addon" }, [{ ...cmsLoaded, siteDisabledCollections: ["log-viewer"], siteSettingsIgnored: true }]));
    expect(r.notes).toContain(
      "Umbraco CMS: the backoffice tool group settings are ignored because the environment sets collection filters for this module.",
    );
    expect(r.notes.join(" ")).not.toMatch(/disabled in the backoffice/);
  });

  it("notes a failed catalogue report", () => {
    const r = buildHealthReport({ ...state({ kind: "no-addon" }, [cmsLoaded]), catalogueReport: { ok: false, reason: "HTTP 403" } });
    expect(r.notes).toContain("Could not report the tool groups to the site, so the backoffice Umbrella dashboard may be out of date: HTTP 403");
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd npm && npm test -- health`
Expected: FAIL (type errors on `siteDisabledCollections` / `catalogueReport`, or missing notes).

- [ ] **Step 3: Implement health**

In `npm/src/core/health.ts`:

Add `import type { CatalogueReportResult } from "./catalogue.js";`.

Add to `ModuleRuntimeState`:

```ts
  /** Collections the site disabled for this module (from capabilities). */
  siteDisabledCollections?: string[];
  /** The environment sets collection filters for this module, so the site's list was not applied. */
  siteSettingsIgnored?: boolean;
```

Add to `HealthState`:

```ts
  /** Absent when the catalogue was not reported (no add-on). */
  catalogueReport?: CatalogueReportResult;
```

In `buildHealthReport`, change the `state.modules.map` callback's destructuring to `({ decision, loaded, toolCount, issues, siteDisabledCollections = [], siteSettingsIgnored = false })` and add at the start of the callback body:

```ts
    const name = decision.module.displayName;
    if (siteSettingsIgnored) {
      notes.push(`${name}: the backoffice tool group settings are ignored because the environment sets collection filters for this module.`);
    } else if (siteDisabledCollections.length > 0) {
      notes.push(`${name}: tool groups disabled in the backoffice: ${siteDisabledCollections.join(", ")}.`);
    }
```

After the `forcedModules` loop, add:

```ts
  if (state.catalogueReport && !state.catalogueReport.ok) {
    notes.push(`Could not report the tool groups to the site, so the backoffice Umbrella dashboard may be out of date: ${state.catalogueReport.reason}`);
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd npm && npm test -- health`
Expected: PASS.

- [ ] **Step 5: Wire the server**

In `npm/src/core/server.ts`:

Replace the imports `import { fetchCapabilities } from "./capabilities.js";` and `import { buildModuleFilterInput } from "./filter-config.js";` with:

```ts
import { fetchCapabilities, siteDisabledCollections } from "./capabilities.js";
import { buildCatalogue, reportCatalogue, type CatalogueReportResult } from "./catalogue.js";
import { buildEffectiveFilterInput } from "./filter-config.js";
```

In the Phase 2 loop, replace the `const filter = ...loadFromConfig(buildModuleFilterInput(env, module.id, module.required === true));` statement with:

```ts
      state.siteDisabledCollections = siteDisabledCollections(capabilities, module.id);
      const { config, siteSettingsIgnored } = buildEffectiveFilterInput(
        env, module.id, module.required === true, state.siteDisabledCollections,
      );
      state.siteSettingsIgnored = siteSettingsIgnored;
      const filter = createCollectionConfigLoader({
        modeRegistry: loaded.allModes,
        allModeNames: loaded.allModeNames,
        allSliceNames: loaded.allSliceNames,
      }).loadFromConfig(config);
```

After the Phase 2 loop and before `const healthState`, add:

```ts
  // Tell the site which tool groups exist, for the backoffice "Umbrella" dashboard. Without the add-on there is nowhere to send it.
  let catalogueReport: CatalogueReportResult | undefined;
  if (capabilities.kind === "ok") {
    catalogueReport = await reportCatalogue(buildCatalogue(
      version,
      ready.map(({ state, loaded }) => ({ module: state.decision.module, loaded, siteSettingsIgnored: state.siteSettingsIgnored ?? false })),
      user,
    ));
  }
```

and change the health state line to:

```ts
  const healthState: HealthState = { capabilities, umbracoVersion, versionCheckMessage, forcedModules, modules: states, catalogueReport };
```

- [ ] **Step 6: Run the full npm suite and build**

Run: `cd npm && npm run compile && npm test && npm run build`
Expected: no type errors; all suites pass; `dist/index.js` built.

- [ ] **Step 7: Commit**

```bash
git add npm/src/core/health.ts npm/src/core/server.ts npm/src/core/__tests__/health.test.ts
git commit -m "feat(npm): apply site tool settings at startup and report the catalogue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Backoffice "Umbrella" dashboard

**Files:**
- Modify: `src/Umbraco.Mcp/Umbraco.Mcp.csproj`
- Create: `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbraco-package.json`
- Create: `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-dashboard.js`

**Interfaces:**
- Consumes: `GET`/`PUT /umbraco/management/api/v1/mcp/tool-settings` (Task 3). Response JSON: `{ products: [{ id, displayName, installed, ... }], catalogue: { umbrellaVersion, modules: { <id>: { reportedAt, siteSettingsIgnored, collections: [{ name, toolCount }] } } }, disabledCollections: { <id>: string[] } }`.
- Backoffice import map (verified in Umbraco 17.7.0): `@umbraco-cms/backoffice/external/lit`, `@umbraco-cms/backoffice/lit-element` (`UmbLitElement`), `@umbraco-cms/backoffice/auth` (`UMB_AUTH_CONTEXT`, `getOpenApiConfiguration()` → `{ base, credentials, token() }`), `@umbraco-cms/backoffice/notification` (`UMB_NOTIFICATION_CONTEXT`, `peek(color, { data: { headline, message } })`), `@umbraco-cms/backoffice/style` (`UmbTextStyles`).

- [ ] **Step 1: Switch the add-on to the Razor SDK**

In `src/Umbraco.Mcp/Umbraco.Mcp.csproj`, change the first line to `<Project Sdk="Microsoft.NET.Sdk.Razor">` and add inside the first `<PropertyGroup>`:

```xml
    <!-- wwwroot/App_Plugins/Umbrella is served at /App_Plugins/Umbrella, where the backoffice looks for umbraco-package.json. -->
    <StaticWebAssetBasePath>/</StaticWebAssetBasePath>
```

Also update `<Description>` to end with: `adds MCP health checks and an "Umbrella" dashboard to switch tool groups off in the backoffice.`

- [ ] **Step 2: Add the manifest**

`src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbraco-package.json`:

```json
{
  "name": "Umbraco.Community.Umbrella",
  "extensions": [
    {
      "type": "dashboard",
      "alias": "Umbrella.Dashboard.ToolGroups",
      "name": "Umbrella MCP tool groups",
      "element": "/App_Plugins/Umbrella/umbrella-dashboard.js",
      "weight": -100,
      "meta": { "label": "Umbrella", "pathname": "umbrella" },
      "conditions": [{ "alias": "Umb.Condition.SectionAlias", "match": "Umb.Section.Settings" }]
    }
  ]
}
```

- [ ] **Step 3: Add the dashboard element**

`src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-dashboard.js`:

```js
import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";

const API_PATH = "/umbraco/management/api/v1/mcp/tool-settings";

const pad = (n) => String(n).padStart(2, "0");
/** DD-MM-YYYY HH:mm in the browser's time zone. */
const formatDate = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Settings → Umbrella: switch the MCP server's tool groups (collections) on or off per product. */
export class UmbrellaDashboardElement extends UmbLitElement {
  static properties = {
    _data: { state: true },
    _disabled: { state: true },
    _error: { state: true },
    _saving: { state: true },
  };

  #auth;
  #notifications;

  constructor() {
    super();
    this._data = null;
    this._disabled = {};
    this._error = null;
    this._saving = false;
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (ctx) => (this.#notifications = ctx));
    this.consumeContext(UMB_AUTH_CONTEXT, (ctx) => {
      if (!ctx) return;
      this.#auth = ctx;
      this.#load();
    });
  }

  async #request(method, body) {
    const config = this.#auth.getOpenApiConfiguration();
    const response = await fetch(`${config.base}${API_PATH}`, {
      method,
      credentials: config.credentials,
      headers: {
        Authorization: `Bearer ${await config.token()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      throw new Error(problem?.detail ?? `HTTP ${response.status}`);
    }
    return response.json();
  }

  async #load() {
    try {
      this._data = await this.#request("GET");
      this._disabled = Object.fromEntries(
        Object.entries(this._data.disabledCollections ?? {}).map(([id, names]) => [id, new Set(names)]),
      );
      this._error = null;
    } catch (error) {
      this._error = error.message;
    }
  }

  #toggle(moduleId, name, enabled) {
    const set = new Set(this._disabled[moduleId] ?? []);
    if (enabled) set.delete(name);
    else set.add(name);
    this._disabled = { ...this._disabled, [moduleId]: set };
  }

  async #save() {
    this._saving = true;
    // Only modules and names the MCP reported: a name it no longer reports is dropped here.
    const modules = this._data.catalogue.modules;
    const disabledCollections = Object.fromEntries(
      this.#visibleProducts()
        .filter((p) => modules[p.id])
        .map((p) => [p.id, modules[p.id].collections.map((c) => c.name).filter((n) => this._disabled[p.id]?.has(n))]),
    );
    try {
      await this.#request("PUT", { disabledCollections });
      this.#notifications?.peek("positive", {
        data: { headline: "Tool groups saved", message: "Reconnect the MCP server in your AI tool to apply the change." },
      });
      await this.#load();
    } catch (error) {
      this.#notifications?.peek("danger", { data: { headline: "Could not save tool groups", message: error.message } });
    } finally {
      this._saving = false;
    }
  }

  #visibleProducts() {
    const modules = this._data?.catalogue?.modules ?? {};
    return (this._data?.products ?? []).filter((p) => p.installed || modules[p.id]);
  }

  #renderProduct(product) {
    const module = this._data.catalogue.modules[product.id];
    if (!module) {
      return html`<uui-box headline=${product.displayName}>
        <p>Not reported yet: start the MCP server once.</p>
      </uui-box>`;
    }
    const off = module.collections.filter((c) => this._disabled[product.id]?.has(c.name)).length;
    return html`<uui-box headline=${product.displayName}>
      <span slot="header-actions">${off} of ${module.collections.length} groups off</span>
      ${module.siteSettingsIgnored
        ? html`<p class="warning">
            Your MCP server's environment sets collection filters for this product, so these settings are ignored there.
          </p>`
        : nothing}
      <div class="groups">
        ${module.collections.map(
          (c) => html`<uui-checkbox
            label="${c.name} (${c.toolCount})"
            ?checked=${!this._disabled[product.id]?.has(c.name)}
            @change=${(e) => this.#toggle(product.id, c.name, e.target.checked)}
          ></uui-checkbox>`,
        )}
      </div>
    </uui-box>`;
  }

  render() {
    if (this._error) return html`<uui-box headline="Umbrella"><p>Could not load the tool groups: ${this._error}</p></uui-box>`;
    if (!this._data) return html`<uui-loader></uui-loader>`;

    const reported = Object.values(this._data.catalogue.modules);
    if (reported.length === 0) {
      return html`<uui-box headline="Umbrella – MCP tool groups">
        <p>No tool groups reported yet. Start your MCP client once (it runs umbrella-mcp), then reload this page.</p>
      </uui-box>`;
    }
    const last = reported.map((m) => m.reportedAt).sort().at(-1);

    return html`
      <uui-box headline="Umbrella – MCP tool groups">
        <p>Last reported by umbrella-mcp ${this._data.catalogue.umbrellaVersion} · ${formatDate(last)}</p>
        <p>Changes apply the next time the MCP server starts. Reconnect it in your AI tool.</p>
      </uui-box>
      ${this.#visibleProducts().map((p) => this.#renderProduct(p))}
      <div class="actions">
        <uui-button look="primary" color="positive" label="Save" ?disabled=${this._saving} @click=${this.#save}></uui-button>
      </div>
    `;
  }

  static styles = [
    UmbTextStyles,
    css`
      :host { display: block; padding: var(--uui-size-layout-1); }
      uui-box { margin-bottom: var(--uui-size-space-5); }
      .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: var(--uui-size-space-3); }
      .warning { color: var(--uui-color-warning-standalone); }
      .actions { display: flex; justify-content: flex-end; }
    `,
  ];
}

customElements.define("umbrella-dashboard", UmbrellaDashboardElement);
export default UmbrellaDashboardElement;
```

- [ ] **Step 4: Build and verify the asset ships**

Run: `dotnet build src/Umbraco.Mcp/Umbraco.Mcp.csproj && dotnet pack src/Umbraco.Mcp/Umbraco.Mcp.csproj -o /private/tmp/claude-501/-Users-marcusk-Desktop-Umbraco-MCPS-Umbraco-MCP/2e01cad8-b35d-4ab3-b2c5-a7d672586053/scratchpad/pack && unzip -l /private/tmp/claude-501/-Users-marcusk-Desktop-Umbraco-MCPS-Umbraco-MCP/2e01cad8-b35d-4ab3-b2c5-a7d672586053/scratchpad/pack/*.nupkg | grep App_Plugins`
Expected: build succeeds; the listing shows `staticwebassets/App_Plugins/Umbrella/umbraco-package.json` and `umbrella-dashboard.js`.

- [ ] **Step 5: Verify in the demo site**

1. Stop any running demo site, then start it: `dotnet run --project demo-site --launch-profile Umbraco.Web.UI` (run in the background).
2. Run the MCP once so it reports: `cd npm && npm run build && node --env-file=.env dist/index.js --list-tools > /dev/null`.
3. In the browser pane open `https://localhost:44399/umbraco`, sign in with the demo admin from `demo-site/appsettings.Development.json`, go to Settings → **Umbrella**.
4. Check: header shows the umbrella-mcp version and a DD-MM-YYYY time; boxes for Umbraco CMS, Forms, Automate, Engage; Forms lists `prevalue-source (10)`.
5. Untick Forms → `prevalue-source`, Save: a "Tool groups saved" notification appears; reload keeps it unticked; the box says "1 of 25 groups off".
6. Run `node --env-file=.env dist/index.js --list-tools | grep prevalue-source` → no output. Tick it again, Save, re-run → the 10 tools are back.
7. Check the browser console for errors (`read_console_messages`, onlyErrors).

Expected: all checks as described. If the dashboard tab does not appear, confirm `https://localhost:44399/App_Plugins/Umbrella/umbraco-package.json` returns the manifest.

- [ ] **Step 6: Commit**

```bash
git add src/Umbraco.Mcp/Umbraco.Mcp.csproj src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella
git commit -m "feat(addon): Umbrella backoffice dashboard to switch tool groups off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end check and docs

**Files:**
- Modify: `scripts/e2e.sh`
- Modify: `README.md`, `npm/README.md`, `src/Umbraco.Mcp/README.md`, `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-10-12-backoffice-tool-toggles-design.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Extend `scripts/e2e.sh`**

Insert after the `2. Tool list` block (before `echo "3. Smoke calls"`), and renumber `3. Smoke calls` to `4. Smoke calls`:

```bash
echo "3. Backoffice tool settings"
API="$UMBRACO_BASE_URL/umbraco/management/api/v1/mcp"
SETTINGS=$(curl -sfk -H "Authorization: Bearer $TOKEN" "$API/tool-settings") || fail "GET tool-settings failed"
# The --list-tools run above reported the catalogue.
node -e "
  const s = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const forms = s.catalogue.modules.forms;
  if (!forms || !forms.collections.some((c) => c.name === 'prevalue-source')) { console.error('forms not reported'); process.exit(1); }" <<<"$SETTINGS" \
  || fail "catalogue does not list forms/prevalue-source (excerpt: ${SETTINGS:0:300})"
ORIGINAL=$(node -e "const s = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(JSON.stringify({ disabledCollections: s.disabledCollections }));" <<<"$SETTINGS")
put_settings() {
  curl -sfk -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$1" "$API/tool-settings" >/dev/null
}
trap 'put_settings "$ORIGINAL" || true' EXIT
put_settings '{"disabledCollections":{"forms":["prevalue-source"]}}' || fail "PUT tool-settings failed"
TOOLS_OFF=$(node dist/index.js --list-tools)
if grep -q "^forms--.*prevalue-source" <<<"$TOOLS_OFF"; then fail "prevalue-source tools still listed after disabling them"; fi
grep -qx "forms--list-forms" <<<"$TOOLS_OFF" || fail "other forms tools vanished"
put_settings "$ORIGINAL" || fail "could not restore tool settings"
trap - EXIT
echo "   disabling forms prevalue-source removed its tools"
```

Note: this requires that `npm/.env` sets no `UMBRACO_*_TOOL_COLLECTIONS` entry for forms.

- [ ] **Step 2: Run the end-to-end check**

Run (demo site running, `npm/dist` built): `scripts/e2e.sh`
Expected: ends with `PASS`.

- [ ] **Step 3: Update the docs**

In `README.md`, add a new section before `## Health checks`:

```markdown
## Turning tool groups off

Settings → **Umbrella** lists every product the MCP server loaded, with one checkbox per tool group (for example Umbraco Forms → `prevalue-source`). Untick a group and save to stop exposing its tools. Fewer tools means less context for the AI and better tool choice.

- **When it applies:** the next time the MCP server starts. Reconnect it in your AI tool after saving.
- **Before the first start:** the dashboard is empty until the MCP server has connected once, because the server reports its tool groups when it starts.
- **Environment wins:** if the MCP server's environment sets `UMBRACO_INCLUDE_TOOL_COLLECTIONS` or `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` for a product (including `forms:*`, or an unprefixed entry for CMS), the dashboard settings are ignored for that product and the dashboard shows a warning. `UMBRACO_INCLUDE_TOOLS` also still includes a tool from a switched-off group.
- **Not a security control:** anyone with the API user's credentials can call the Management API directly. Use the API user's groups and sections to limit what it can do.

The settings and the reported tool groups are stored in the `umbracoKeyValue` table. Changing them needs access to the Settings section.
```

In the `### MCP server (environment variables)` table row for `UMBRACO_TOOL_MODES, ...`, append to the meaning: `. Collection filters set here for a product override the Umbrella dashboard for that product`.

In `npm/README.md`, append after the "Use the same version as the NuGet package" paragraph:

```markdown
Tool groups switched off in the backoffice (Settings → Umbrella) are left out on the next start, unless the environment sets `UMBRACO_INCLUDE_TOOL_COLLECTIONS` or `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` for that product.
```

In `src/Umbraco.Mcp/README.md`, under `## What it adds`, add after the capabilities bullet:

```markdown
- Settings → **Umbrella**: switch the MCP server's tool groups off per product. Changes apply the next time the MCP server starts.
```

In `CLAUDE.md`, under `### The cross-language contract`:
- change the **Capabilities payload** bullet's shape to `{ addonVersion, products: [{ id, displayName, installed, enabled, version, issues, disabledCollections }] }` and add: `disabledCollections` is optional on the npm side (`null`/missing → `[]`).
- add a bullet: `- **Tool settings:** \`POST /mcp/catalogue\` (API users only) receives \`{ umbrellaVersion, modules: [{ id, siteSettingsIgnored, collections: [{ name, toolCount }] }] }\` from \`catalogue.ts\` on every start, including \`--list-tools\`; \`GET/PUT /mcp/tool-settings\` (Settings section) back the "Umbrella" dashboard in \`wwwroot/App_Plugins/Umbrella\`. Both live in \`umbracoKeyValue\` rows \`Umbraco.Mcp.ToolSettings\` and \`Umbraco.Mcp.Catalogue\`. Env collection filters for a module override the site list (\`buildEffectiveFilterInput\`).`

- [ ] **Step 4: Update the spec**

In `docs/superpowers/specs/2026-10-12-backoffice-tool-toggles-design.md` §5.2 `server.ts` bullet, replace `` `--list-tools` does not report.`` with `` It reports on every start, including `--list-tools` (which lets `scripts/e2e.sh` verify the report).`` and set the status line to `Implemented`.

- [ ] **Step 5: Run every suite once more**

Run: `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj && cd npm && npm run compile && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e.sh README.md npm/README.md src/Umbraco.Mcp/README.md CLAUDE.md docs/superpowers/specs/2026-10-12-backoffice-tool-toggles-design.md
git commit -m "docs: backoffice tool group toggles; e2e check for disabling a group

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
