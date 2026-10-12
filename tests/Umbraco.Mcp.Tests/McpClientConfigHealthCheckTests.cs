using NUnit.Framework;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.HealthChecks;
using Umbraco.Mcp.Overview;
using static Umbraco.Mcp.Tests.TestOverview;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpClientConfigHealthCheckTests
{
    private static List<HealthCheckStatus> Rows(McpOverview overview) =>
        McpHealthCheckRows.Build(overview, McpFindingArea.Server).ToList();

    [Test]
    public void Matching_version_is_a_success_row()
    {
        List<HealthCheckStatus> rows = Rows(Make(server: new("17.0.0", At, true)));

        Assert.That(rows, Has.Count.EqualTo(2));
        Assert.That(rows[0].ResultType, Is.EqualTo(StatusResultType.Success));
        Assert.That(rows[0].Message, Is.EqualTo(
            "The MCP server last started as umbrella-mcp 17.0.0 on 11-10-2026 09:05 UTC, the same version as the add-on."));
    }

    [Test]
    public void Mismatch_is_a_warning_row()
    {
        List<HealthCheckStatus> rows = Rows(Make(
            findings: [new(McpFinding.Warning, McpFindingArea.Server, "The MCP server is 16.0.0 but the add-on is 17.0.0.")],
            server: new("16.0.0", At, false)));

        Assert.That(rows, Has.Count.EqualTo(2));
        Assert.That(rows[0].ResultType, Is.EqualTo(StatusResultType.Warning));
        Assert.That(rows[0].Message, Is.EqualTo("The MCP server is 16.0.0 but the add-on is 17.0.0."));
    }

    [Test]
    public void No_report_is_an_info_row()
    {
        List<HealthCheckStatus> rows = Rows(Make(
            findings: [new(McpFinding.Info, McpFindingArea.Server, "No MCP server has reported yet.")]));

        Assert.That(rows, Has.Count.EqualTo(2));
        Assert.That(rows[0].ResultType, Is.EqualTo(StatusResultType.Info));
        Assert.That(rows[0].Message, Is.EqualTo("No MCP server has reported yet."));
    }
}
