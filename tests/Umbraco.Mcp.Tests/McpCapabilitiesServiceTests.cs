using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.Detection.Detectors;
using Umbraco.Mcp.ToolSettings;

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

    private sealed class StubDetector(string id) : IMcpProductDetector
    {
        public string Id => id;
        public string DisplayName => id;
        public string? SectionAlias => null;
        public McpProductStatus Detect() => new(id, id, true, true, "17.0.0", []);
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
    public void Off_comes_from_the_defaults()
    {
        var a = new FakeAssemblies();
        var r = new FakeApis();
        var store = new FakeToolSettingsStore { Off = ["forms"] };

        McpCapabilities caps = Service([new FormsDetector(a, r), new AutomateDetector(a, r)], store).GetCapabilities();

        Assert.That(caps.Products[0].Off, Is.True);
        Assert.That(caps.Products[0].ReadOnly || caps.Products[0].NoDestructive, Is.False);
        Assert.That(caps.Products[1].Off, Is.False);
        Assert.That(JsonSerializer.Serialize(caps, new JsonSerializerOptions(JsonSerializerDefaults.Web)), Does.Contain("\"off\":true"));
    }

    [Test]
    public void Off_is_false_when_nothing_is_stored_or_the_store_fails()
    {
        var detector = new FormsDetector(new FakeAssemblies(), new FakeApis());

        Assert.That(Service([detector]).GetCapabilities().Products.Single().Off, Is.False);
        var failing = new FakeToolSettingsStore { Throws = new InvalidOperationException("db down") };
        Assert.That(Service([detector], failing).GetCapabilities().Products.Single().Off, Is.False);
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

    private static readonly Guid ApiUser = Guid.NewGuid();

    private static McpCapabilitiesService TwoProducts(FakeToolSettingsStore store)
    {
        var a = new FakeAssemblies();
        var r = new FakeApis();
        return Service([new StubDetector("cms"), new FormsDetector(a, r)], store);
    }

    [Test]
    public void Products_whose_section_the_caller_lacks_are_marked()
    {
        var a = new FakeAssemblies();
        var r = new FakeApis();
        var service = Service([new StubDetector("cms"), new FormsDetector(a, r), new AutomateDetector(a, r)]);

        McpCapabilities caps = service.GetCapabilities(ApiUser, ["umb.section.forms"]);

        Assert.That(caps.Products.Where(p => p.NoSectionAccess).Select(p => p.Id), Is.EqualTo(new[] { "automate" }));
        Assert.That(JsonSerializer.Serialize(caps, new JsonSerializerOptions(JsonSerializerDefaults.Web)), Does.Contain("\"noSectionAccess\":true"));
    }

    [Test]
    public void Without_sections_no_product_is_marked()
    {
        var a = new FakeAssemblies();
        var r = new FakeApis();
        var service = Service([new FormsDetector(a, r), new AutomateDetector(a, r)]);

        Assert.That(service.GetCapabilities(ApiUser).Products.Any(p => p.NoSectionAccess), Is.False);
    }

    [Test]
    public void Api_user_override_applies_to_that_product_only()
    {
        var store = new FakeToolSettingsStore
        {
            Disabled = new() { ["cms"] = ["manifest"] },
            UserOverrides = new() { [ApiUser] = new Dictionary<string, McpProductOverride> { ["forms"] = new(["media"], McpToolLevel.ReadOnly) } },
        };

        McpCapabilities caps = TwoProducts(store).GetCapabilities(ApiUser);

        McpProductStatus cms = caps.Products.Single(p => p.Id == "cms");
        McpProductStatus forms = caps.Products.Single(p => p.Id == "forms");
        Assert.That(forms.ReadOnly, Is.True);
        Assert.That(forms.NoDestructive, Is.False);
        Assert.That(forms.DisabledCollections, Is.EqualTo(new[] { "media" }));
        Assert.That(forms.SettingsScope, Is.EqualTo("user"));
        Assert.That(cms.DisabledCollections, Is.EqualTo(new[] { "manifest" }));
        Assert.That(cms.SettingsScope, Is.EqualTo("site"));
    }

    [TestCase(McpToolLevel.ReadOnly, true, false, false)]
    [TestCase(McpToolLevel.NoDestructive, false, true, false)]
    [TestCase(McpToolLevel.Full, false, false, false)]
    [TestCase(McpToolLevel.Off, false, false, true)]
    public void Each_level_maps_to_the_flags(string level, bool readOnly, bool noDestructive, bool off)
    {
        var store = new FakeToolSettingsStore
        {
            // The defaults say the opposite, so the override has to win in both directions.
            ReadOnly = level == McpToolLevel.Full ? ["forms"] : [],
            NoDestructive = level == McpToolLevel.Full ? ["forms"] : [],
            Off = level == McpToolLevel.Off ? [] : ["forms"],
            UserOverrides = new() { [ApiUser] = new Dictionary<string, McpProductOverride> { ["forms"] = new([], level) } },
        };

        McpProductStatus forms = TwoProducts(store).GetCapabilities(ApiUser).Products.Single(p => p.Id == "forms");

        Assert.That(forms.ReadOnly, Is.EqualTo(readOnly));
        Assert.That(forms.NoDestructive, Is.EqualTo(noDestructive));
        Assert.That(forms.Off, Is.EqualTo(off));
        Assert.That(forms.SettingsScope, Is.EqualTo("user"));
    }

    [Test]
    public void Override_with_no_disabled_collections_gives_an_empty_list_not_null()
    {
        var store = new FakeToolSettingsStore
        {
            Disabled = new() { ["forms"] = ["media"] },
            UserOverrides = new() { [ApiUser] = new Dictionary<string, McpProductOverride> { ["forms"] = new([], McpToolLevel.Full) } },
        };

        McpProductStatus forms = TwoProducts(store).GetCapabilities(ApiUser).Products.Single(p => p.Id == "forms");

        Assert.That(forms.DisabledCollections, Is.Not.Null.And.Empty);
    }

    [Test]
    public void Null_user_key_gets_the_defaults()
    {
        var store = new FakeToolSettingsStore
        {
            ReadOnly = ["forms"],
            UserOverrides = new() { [ApiUser] = new Dictionary<string, McpProductOverride> { ["forms"] = new(["media"], McpToolLevel.Full) } },
        };

        McpCapabilities caps = TwoProducts(store).GetCapabilities(null);

        Assert.That(caps.Products.Select(p => p.SettingsScope), Is.All.EqualTo("site"));
        McpProductStatus forms = caps.Products.Single(p => p.Id == "forms");
        Assert.That(forms.ReadOnly, Is.True);
        Assert.That(forms.DisabledCollections, Is.Null);
    }

    [Test]
    public void Default_change_does_not_reach_an_overridden_product()
    {
        var store = new FakeToolSettingsStore
        {
            UserOverrides = new() { [ApiUser] = new Dictionary<string, McpProductOverride> { ["forms"] = new(["media"], McpToolLevel.Full) } },
        };
        McpCapabilitiesService service = TwoProducts(store);

        store.ReadOnly = ["forms"];
        store.Disabled = new() { ["forms"] = ["licensing"], ["cms"] = ["imaging"] };
        McpCapabilities caps = service.GetCapabilities(ApiUser);

        McpProductStatus forms = caps.Products.Single(p => p.Id == "forms");
        McpProductStatus cms = caps.Products.Single(p => p.Id == "cms");
        Assert.That(forms.ReadOnly, Is.False);
        Assert.That(forms.DisabledCollections, Is.EqualTo(new[] { "media" }));
        Assert.That(cms.DisabledCollections, Is.EqualTo(new[] { "imaging" }));
        Assert.That(cms.SettingsScope, Is.EqualTo("site"));
    }

    [Test]
    public void Override_for_an_undetected_product_is_ignored()
    {
        var store = new FakeToolSettingsStore
        {
            UserOverrides = new() { [ApiUser] = new Dictionary<string, McpProductOverride> { ["gone"] = new(["x"], McpToolLevel.ReadOnly) } },
        };

        McpCapabilities caps = TwoProducts(store).GetCapabilities(ApiUser);

        Assert.That(caps.Products.Select(p => p.Id), Is.EqualTo(new[] { "cms", "forms" }));
        Assert.That(caps.Products.Select(p => p.SettingsScope), Is.All.EqualTo("site"));
    }

    [Test]
    public void Override_read_failure_falls_back_to_the_defaults()
    {
        var store = new FakeToolSettingsStore
        {
            ReadOnly = ["forms"],
            Disabled = new() { ["forms"] = ["media"] },
            UserReadsThrow = new InvalidOperationException("database is down"),
        };

        McpCapabilities caps = TwoProducts(store).GetCapabilities(ApiUser);

        Assert.That(caps.Products.Select(p => p.SettingsScope), Is.All.EqualTo("site"));
        McpProductStatus forms = caps.Products.Single(p => p.Id == "forms");
        Assert.That(forms.ReadOnly, Is.True);
        Assert.That(forms.DisabledCollections, Is.EqualTo(new[] { "media" }));
    }

    [Test]
    public void Settings_scope_serialises_as_camel_case_and_defaults_to_site()
    {
        McpCapabilities caps = TwoProducts(new FakeToolSettingsStore()).GetCapabilities();

        string json = JsonSerializer.Serialize(caps, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.That(json, Does.Contain("\"settingsScope\":\"site\""));
    }
}
