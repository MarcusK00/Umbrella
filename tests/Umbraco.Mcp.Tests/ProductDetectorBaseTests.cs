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
