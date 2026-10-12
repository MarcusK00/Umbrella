using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
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
        public string? SectionAlias => null;
        public McpProductStatus Detect() => throw new InvalidOperationException("boom");
    }

    private static McpCapabilitiesService Service(IEnumerable<IMcpProductDetector> detectors, FakeToolSettingsStore? store = null) =>
        new(detectors, store ?? new FakeToolSettingsStore(), NullLogger<McpCapabilitiesService>.Instance);

    [Test]
    public void Returns_one_status_per_detector_in_order_with_addon_version()
    {
        var assemblies = new FakeAssemblies(("Umbraco.Forms.Core", typeof(Assert).Assembly));
        var apis = new FakeApis("forms-management");
        var service = Service(new IMcpProductDetector[]
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
        var service = Service(new IMcpProductDetector[] { new ThrowingDetector() });

        McpProductStatus s = service.GetCapabilities().Products.Single();

        Assert.That(s.Installed, Is.False);
        Assert.That(s.Issues, Has.Some.Contains("boom"));
    }

    [Test]
    public void Engage_is_detected_by_its_core_assembly_and_management_api()
    {
        var assemblies = new FakeAssemblies(("Umbraco.Engage.Core", typeof(Assert).Assembly));
        var apis = new FakeApis("engage-management");

        McpProductStatus s = new EngageDetector(assemblies, apis).Detect();

        Assert.That(s.Id, Is.EqualTo("engage"));
        Assert.That(s.DisplayName, Is.EqualTo("Umbraco Engage"));
        Assert.That(s.Installed && s.Enabled, Is.True);
        Assert.That(s.Issues, Is.Empty);
    }

    [Test]
    public void Detector_section_aliases_match_backoffice_sections()
    {
        var a = new FakeAssemblies();
        var r = new FakeApis();
        Assert.That(new FormsDetector(a, r).SectionAlias, Is.EqualTo("Umb.Section.Forms"));
        Assert.That(new AutomateDetector(a, r).SectionAlias, Is.EqualTo("Ua.Section.Automate"));
        Assert.That(new EngageDetector(a, r).SectionAlias, Is.EqualTo("Umb.Section.Engage"));
    }

    [Test]
    public void Detector_ids_match_npm_module_ids()
    {
        var a = new FakeAssemblies();
        var r = new FakeApis();
        Assert.That(new FormsDetector(a, r).Id, Is.EqualTo("forms"));
        Assert.That(new AutomateDetector(a, r).Id, Is.EqualTo("automate"));
    }

    [Test]
    public void Each_product_carries_its_disabled_collections()
    {
        var a = new FakeAssemblies();
        var r = new FakeApis();
        var store = new FakeToolSettingsStore { Disabled = new() { ["forms"] = ["prevalue-source"] } };

        McpCapabilities caps = Service([new FormsDetector(a, r), new AutomateDetector(a, r)], store).GetCapabilities();

        Assert.That(caps.Products[0].DisabledCollections, Is.EqualTo(new[] { "prevalue-source" }));
        Assert.That(caps.Products[1].DisabledCollections, Is.Null);
    }

    [Test]
    public void No_stored_entry_is_returned_as_null()
    {
        McpCapabilities caps = Service([new FormsDetector(new FakeAssemblies(), new FakeApis())]).GetCapabilities();

        Assert.That(caps.Products.Single().DisabledCollections, Is.Null);
    }

    [Test]
    public void Stored_empty_list_is_returned_as_empty_not_null()
    {
        var store = new FakeToolSettingsStore { Disabled = new() { ["forms"] = [] } };

        McpCapabilities caps = Service([new FormsDetector(new FakeAssemblies(), new FakeApis())], store).GetCapabilities();

        Assert.That(caps.Products.Single().DisabledCollections, Is.Not.Null.And.Empty);
    }

    [Test]
    public void Failing_store_returns_null_for_every_product()
    {
        var store = new FakeToolSettingsStore { Throws = new InvalidOperationException("database is down") };

        McpCapabilities caps = Service([new FormsDetector(new FakeAssemblies(), new FakeApis())], store).GetCapabilities();

        Assert.That(caps.Products.Single().DisabledCollections, Is.Null);
        Assert.That(caps.Products.Single().ReadOnly, Is.False);
    }

    [Test]
    public void Each_product_carries_its_read_only_flag()
    {
        var a = new FakeAssemblies();
        var r = new FakeApis();
        var store = new FakeToolSettingsStore { ReadOnly = ["forms"] };

        McpCapabilities caps = Service([new FormsDetector(a, r), new AutomateDetector(a, r)], store).GetCapabilities();

        Assert.That(caps.Products[0].ReadOnly, Is.True);
        Assert.That(caps.Products[1].ReadOnly, Is.False);
    }

    [Test]
    public void No_destructive_comes_from_the_store()
    {
        var a = new FakeAssemblies();
        var r = new FakeApis();
        var store = new FakeToolSettingsStore { NoDestructive = ["forms"] };

        McpCapabilities caps = Service([new FormsDetector(a, r), new AutomateDetector(a, r)], store).GetCapabilities();

        Assert.That(caps.Products[0].NoDestructive, Is.True);
        Assert.That(caps.Products[1].NoDestructive, Is.False);
        Assert.That(JsonSerializer.Serialize(caps, new JsonSerializerOptions(JsonSerializerDefaults.Web)), Does.Contain("\"noDestructive\":true"));
    }

    [Test]
    public void No_destructive_store_failure_means_false()
    {
        var store = new FakeToolSettingsStore { Throws = new InvalidOperationException("db down") };

        McpCapabilities caps = Service([new FormsDetector(new FakeAssemblies(), new FakeApis())], store).GetCapabilities();

        Assert.That(caps.Products.Single().NoDestructive, Is.False);
    }

    [Test]
    public void Disabled_collections_and_read_only_serialise_as_camel_case()
    {
        var store = new FakeToolSettingsStore { Disabled = new() { ["forms"] = ["prevalue-source"] }, ReadOnly = ["forms"] };
        McpCapabilities caps = Service([new FormsDetector(new FakeAssemblies(), new FakeApis())], store).GetCapabilities();

        string json = JsonSerializer.Serialize(caps, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.That(json, Does.Contain("\"disabledCollections\":[\"prevalue-source\"]"));
        Assert.That(json, Does.Contain("\"readOnly\":true"));
    }
}
