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
    private static readonly DateTimeOffset LastConnected = new(2026, 10, 11, 9, 5, 0, TimeSpan.Zero);

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

    private static List<HealthCheckStatus> Build(IReadOnlyList<McpApiUser> users, params McpProductStatus[] products) =>
        McpApiUserHealthCheck.BuildStatuses(users, new McpCapabilities("17.0.0", products), Sections).ToList();

    private static List<HealthCheckStatus> Build(McpApiUser user, params McpProductStatus[] products) =>
        Build([user], products);

    private static McpApiUser User(UserState state = UserState.Active, params string[] sections) =>
        new("MCP API user", state, sections, ["umbraco-back-office-mcp"], LastConnected);

    [Test]
    public void No_connection_yet_is_a_single_info_row()
    {
        List<HealthCheckStatus> rows = Build([], AllProducts);

        Assert.That(rows, Has.Count.EqualTo(1));
        Assert.That(rows[0].ResultType, Is.EqualTo(StatusResultType.Info));
        Assert.That(rows[0].Message, Does.Contain("No MCP server has connected"));
    }

    [Test]
    public void Any_user_name_and_client_id_the_mcp_connected_with_is_success()
    {
        var user = new McpApiUser("DoctorUserApi", UserState.Active, ["Umb.Section.Forms", "Ua.Section.Automate"],
            ["random-client-id-name-here"], LastConnected);

        HealthCheckStatus row = Build(user, AllProducts).Single();

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Success));
        Assert.That(row.Message, Does.Contain("DoctorUserApi").And.Contain("random-client-id-name-here"));
    }

    [Test]
    public void Success_names_when_the_user_last_connected_and_the_products_it_can_reach()
    {
        HealthCheckStatus row = Build(User(UserState.Active, "Umb.Section.Forms", "Ua.Section.Automate"), AllProducts).Single();

        Assert.That(row.Message, Does.Contain("11-10-2026 09:05 UTC")
            .And.Contain("Umbraco Forms")
            .And.Contain("Umbraco Automate"));
    }

    [Test]
    public void A_user_without_client_ids_left_is_named_without_them()
    {
        var user = new McpApiUser("MCP API user", UserState.Active, [], [], LastConnected);

        HealthCheckStatus row = Build(user, Product("cms", "Umbraco CMS")).Single();

        Assert.That(row.Message, Does.Contain("\"MCP API user\" last connected").And.Not.Contain("()"));
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
    public void Each_connected_user_is_checked_on_its_own()
    {
        var editor = new McpApiUser("Editor MCP", UserState.Active, ["Umb.Section.Forms", "Ua.Section.Automate"],
            ["editor-mcp"], LastConnected);
        var developer = new McpApiUser("Developer MCP", UserState.Active, ["Umb.Section.Forms"],
            ["developer-mcp"], LastConnected.AddHours(-1));

        List<HealthCheckStatus> rows = Build([editor, developer], AllProducts);

        Assert.That(rows.Single(r => r.ResultType == StatusResultType.Success).Message, Does.Contain("Editor MCP"));
        Assert.That(rows.Single(r => r.ResultType == StatusResultType.Warning).Message,
            Does.Contain("Developer MCP").And.Contain("Umbraco Automate"));
    }
}
