using NUnit.Framework;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.HealthChecks;
using Umbraco.Mcp.Overview;
using static Umbraco.Mcp.Tests.TestOverview;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpApiUserHealthCheckTests
{
    private static List<HealthCheckStatus> Rows(McpOverview overview) =>
        McpHealthCheckRows.Build(overview, McpFindingArea.ApiUsers).ToList();

    [Test]
    public void Each_healthy_user_is_a_success_row()
    {
        List<HealthCheckStatus> rows = Rows(Make(users:
        [
            User("First", reachable: ["Umbraco CMS", "Umbraco Forms"]),
            User("Second", clientIds: []),
        ]));

        Assert.That(rows, Has.Count.EqualTo(3));
        Assert.That(rows[0].ResultType, Is.EqualTo(StatusResultType.Success));
        Assert.That(rows[0].Message, Is.EqualTo(
            "The API user &quot;First&quot; (umbraco-back-office-mcp) last connected 11-10-2026 09:05 UTC and can reach Umbraco CMS, Umbraco Forms."));
        Assert.That(rows[1].Message, Is.EqualTo("The API user &quot;Second&quot; last connected 11-10-2026 09:05 UTC."));
        Assert.That(rows[2].Message, Is.EqualTo(McpHealthCheckRows.DashboardRow));
    }

    [Test]
    public void Warnings_and_healthy_users_both_show()
    {
        List<HealthCheckStatus> rows = Rows(Make(
            findings: [new(McpFinding.Warning, McpFindingArea.ApiUsers, "The API user \"Bad\" is disabled.")],
            users:
            [
                User("Bad", state: "disabled"),
                User("Limited", unreachable: ["Umbraco Forms"]),
                User("Good", reachable: ["Umbraco CMS"]),
            ]));

        Assert.That(rows, Has.Count.EqualTo(3));
        Assert.That(rows[0].ResultType, Is.EqualTo(StatusResultType.Warning));
        Assert.That(rows[1].ResultType, Is.EqualTo(StatusResultType.Success));
        Assert.That(rows[1].Message, Does.StartWith("The API user &quot;Good&quot;"));
        Assert.That(rows[2].Message, Is.EqualTo(McpHealthCheckRows.DashboardRow));
    }

    [Test]
    public void No_users_is_one_info_row()
    {
        List<HealthCheckStatus> rows = Rows(Make(
            findings: [new(McpFinding.Info, McpFindingArea.ApiUsers, "No MCP server has connected to this site yet.")]));

        Assert.That(rows, Has.Count.EqualTo(2));
        Assert.That(rows[0].ResultType, Is.EqualTo(StatusResultType.Info));
        Assert.That(rows[0].Message, Is.EqualTo("No MCP server has connected to this site yet."));
    }

    [Test]
    public void Values_in_messages_are_html_encoded()
    {
        List<HealthCheckStatus> rows = Rows(Make(users: [User("<b>x</b>")]));

        Assert.That(rows[0].Message, Does.Contain("&lt;b&gt;x&lt;/b&gt;"));
        Assert.That(rows[0].Message, Does.Not.Contain("<b>"));
    }
}
