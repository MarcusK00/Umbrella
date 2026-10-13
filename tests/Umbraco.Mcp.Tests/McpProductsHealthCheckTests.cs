using NUnit.Framework;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.HealthChecks;
using Umbraco.Mcp.Overview;
using static Umbraco.Mcp.Tests.TestOverview;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpProductsHealthCheckTests
{
    private static List<HealthCheckStatus> Rows(McpOverview overview) =>
        McpHealthCheckRows.Build(overview, McpFindingArea.Products).ToList();

    [Test]
    public void All_available_is_one_success_row()
    {
        List<HealthCheckStatus> rows = Rows(Make(products: [Product("Umbraco CMS"), Product("Umbraco Forms", version: null)]));

        Assert.That(rows, Has.Count.EqualTo(1));
        Assert.That(rows[0].ResultType, Is.EqualTo(StatusResultType.Success));
        Assert.That(rows[0].Message, Is.EqualTo("All installed products are available to the MCP server: Umbraco CMS 17.0.0, Umbraco Forms."));
    }

    [Test]
    public void Not_installed_products_fold_into_one_info_row()
    {
        List<HealthCheckStatus> rows = Rows(Make(products:
            [Product("Umbraco CMS"), Product("Umbraco Forms", installed: false), Product("Umbraco Engage", installed: false)]));

        Assert.That(rows, Has.Count.EqualTo(2));
        Assert.That(rows[1].ResultType, Is.EqualTo(StatusResultType.Info));
        Assert.That(rows[1].Message, Is.EqualTo("Not installed: Umbraco Forms, Umbraco Engage."));
    }

    [Test]
    public void Not_installed_product_with_issues_is_only_a_warning()
    {
        var findings = new[] { new McpFinding(McpFinding.Warning, McpFindingArea.Products, "Umbraco Forms: Its package is broken.") };
        List<HealthCheckStatus> rows = Rows(Make(
            findings: findings,
            products: [Product("Umbraco CMS"), Product("Umbraco Forms", installed: false, issues: ["Its package is broken."]), Product("Umbraco Engage", installed: false)]));

        Assert.That(rows.Select(r => r.Message), Has.None.Contains("Umbraco Forms, "));
        Assert.That(rows.Any(r => r.Message == "Not installed: Umbraco Engage."), Is.True);
    }

    [Test]
    public void Product_warning_rows_replace_the_success_row()
    {
        List<HealthCheckStatus> rows = Rows(Make(
            findings:
            [
                new(McpFinding.Warning, McpFindingArea.Products, "Umbraco Forms 17.0.0: its API is not available."),
                new(McpFinding.Warning, McpFindingArea.Server, "other area"),
            ],
            products: [Product("Umbraco Forms")]));

        Assert.That(rows, Has.Count.EqualTo(1));
        Assert.That(rows[0].ResultType, Is.EqualTo(StatusResultType.Warning));
        Assert.That(rows[0].Message, Is.EqualTo("Umbraco Forms 17.0.0: its API is not available."));
        Assert.That(rows.Select(r => r.ResultType), Does.Not.Contain(StatusResultType.Success));
    }

    [Test]
    public void Health_check_identities_are_unchanged()
    {
        AssertIdentity<McpProductsHealthCheck>("6f1d2c3a-8b47-4e2a-9c51-3d7e0b9a4f12", "MCP products");
        AssertIdentity<McpClientConfigHealthCheck>("0c7e5a91-2d4b-4f63-8e1a-9b5d3c7f2e48", "MCP client setup");
        AssertIdentity<McpApiUserHealthCheck>("b3a9e0d4-5c2f-4f8e-a6d1-7e4b2c9f0a35", "MCP API user");
    }

    private static void AssertIdentity<T>(string id, string name)
    {
        var attribute = (HealthCheckAttribute)Attribute.GetCustomAttribute(typeof(T), typeof(HealthCheckAttribute))!;
        Assert.That(attribute.Id.ToString(), Is.EqualTo(id));
        Assert.That(attribute.Name, Is.EqualTo(name));
        Assert.That(attribute.Group, Is.EqualTo("MCP"));
    }

    [Test]
    public void No_check_repeats_the_dashboard_pointer_as_a_row()
    {
        McpOverview overview = Make(
            server: new("17.0.0", At, true),
            users: [User("First")],
            products: [Product("Umbraco CMS"), Product("Umbraco Forms", installed: false)]);
        foreach (string area in new[] { McpFindingArea.Products, McpFindingArea.Server, McpFindingArea.ApiUsers })
        {
            List<HealthCheckStatus> rows = McpHealthCheckRows.Build(overview, area).ToList();
            Assert.That(rows.Select(r => r.Message), Has.None.Contains("Settings → Umbrella"), area);
        }
    }

    [Test]
    public void Only_the_client_setup_description_points_to_the_dashboard()
    {
        Assert.That(Description<McpClientConfigHealthCheck>(), Does.EndWith(" " + McpHealthCheckRows.DashboardPointer));
        Assert.That(Description<McpProductsHealthCheck>(), Does.Not.Contain("Settings → Umbrella"));
        Assert.That(Description<McpApiUserHealthCheck>(), Does.Not.Contain("Settings → Umbrella"));
    }

    private static string? Description<T>() =>
        ((HealthCheckAttribute)Attribute.GetCustomAttribute(typeof(T), typeof(HealthCheckAttribute))!).Description;
}
