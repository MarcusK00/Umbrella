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
