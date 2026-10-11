using NUnit.Framework;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.HealthChecks;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpApiUserHealthCheckTests
{
    private const string ClientId = "umbraco-back-office-mcp";

    private static readonly Dictionary<string, string?> Sections = new()
    {
        ["cms"] = null,
        ["forms"] = "Umb.Section.Forms",
        ["automate"] = "Ua.Section.Automate",
    };

    private static McpProductStatus Product(string id, string name, bool installed = true, bool enabled = true) =>
        new(id, name, installed, enabled, "17.0.0", []);

    private static readonly McpProductStatus[] AllProducts =
    [
        Product("cms", "Umbraco CMS"),
        Product("forms", "Umbraco Forms"),
        Product("automate", "Umbraco Automate"),
    ];

    private static List<HealthCheckStatus> Build(McpApiUser? user, params McpProductStatus[] products) =>
        McpApiUserHealthCheck.BuildStatuses(ClientId, user, new McpCapabilities("17.0.0", products), Sections).ToList();

    private static McpApiUser User(UserState state = UserState.Active, params string[] sections) =>
        new("MCP API user", state, sections);

    [Test]
    public void Missing_user_is_a_single_warning_naming_the_client_id()
    {
        List<HealthCheckStatus> rows = Build(null, AllProducts);

        Assert.That(rows, Has.Count.EqualTo(1));
        Assert.That(rows[0].ResultType, Is.EqualTo(StatusResultType.Warning));
        Assert.That(rows[0].Message, Does.Contain(ClientId).And.Contain("Umbraco:Mcp:ClientId"));
    }

    [TestCase(UserState.Disabled, "disabled")]
    [TestCase(UserState.LockedOut, "locked out")]
    public void A_user_that_cannot_sign_in_is_a_warning(UserState state, string expected)
    {
        HealthCheckStatus row = Build(User(state, "Umb.Section.Forms", "Ua.Section.Automate"), AllProducts)[0];

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Warning));
        Assert.That(row.Message, Does.Contain(expected));
    }

    [Test]
    public void An_inactive_user_can_still_sign_in()
    {
        // API users that have never had a token issued may report Inactive; that is not a problem.
        HealthCheckStatus row = Build(User(UserState.Inactive, "Umb.Section.Forms", "Ua.Section.Automate"), AllProducts)[0];

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Success));
    }

    [Test]
    public void A_missing_product_section_is_a_warning_for_that_product_only()
    {
        List<HealthCheckStatus> rows = Build(User(UserState.Active, "Umb.Section.Forms"), AllProducts);

        HealthCheckStatus warning = rows.Single(r => r.ResultType == StatusResultType.Warning);
        Assert.That(warning.Message, Does.Contain("Umbraco Automate").And.Contain("Ua.Section.Automate"));
        Assert.That(rows.Any(r => r.Message!.Contains("Umb.Section.Forms") && r.ResultType == StatusResultType.Warning), Is.False);
    }

    [Test]
    public void Products_that_are_not_installed_or_not_enabled_are_not_checked()
    {
        List<HealthCheckStatus> rows = Build(User(),
            Product("cms", "Umbraco CMS"),
            Product("forms", "Umbraco Forms", installed: false, enabled: false),
            Product("automate", "Umbraco Automate", enabled: false));

        Assert.That(rows.Single().ResultType, Is.EqualTo(StatusResultType.Success));
    }

    [Test]
    public void All_sections_granted_is_success_naming_user_and_products()
    {
        HealthCheckStatus row = Build(User(UserState.Active, "Umb.Section.Forms", "Ua.Section.Automate"), AllProducts).Single();

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Success));
        Assert.That(row.Message, Does.Contain("MCP API user")
            .And.Contain("Umbraco Forms")
            .And.Contain("Umbraco Automate")
            .And.Contain("secret"));
    }
}
