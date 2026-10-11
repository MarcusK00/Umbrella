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
