using System.Globalization;
using System.Net;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.Overview;

namespace Umbraco.Mcp.HealthChecks;

/// <summary>
/// Turns the overview's findings for one area into health check rows. The wording lives in
/// <see cref="McpOverviewService"/>; this only picks the rows, encodes them and ends with a pointer to the dashboard.
/// </summary>
internal static class McpHealthCheckRows
{
    internal const string DashboardRow = "Details and setup for AI tools: Settings → Umbrella.";

    /// <summary>
    /// The backoffice renders health check messages as HTML, so every message is encoded here, once.
    /// </summary>
    internal static IReadOnlyList<HealthCheckStatus> Build(McpOverview overview, string area)
    {
        var rows = new List<HealthCheckStatus>();
        List<McpFinding> findings = overview.Findings.Where(f => f.Area == area).ToList();

        foreach (McpFinding finding in findings)
        {
            rows.Add(Row(
                finding.Severity == McpFinding.Warning ? StatusResultType.Warning : StatusResultType.Info,
                finding.Message));
        }

        if (findings.Count == 0)
        {
            rows.AddRange(SuccessRows(overview, area));
        }
        else if (area == McpFindingArea.ApiUsers)
        {
            foreach (McpOverviewApiUser user in overview.ApiUsers.Where(IsHealthy))
            {
                rows.Add(Row(StatusResultType.Success, UserSuccess(user)));
            }
        }

        if (area == McpFindingArea.Products)
        {
            string[] missing = overview.Products.Where(p => !p.Installed).Select(p => p.DisplayName).ToArray();
            if (missing.Length > 0)
            {
                rows.Add(Row(StatusResultType.Info, $"Not installed: {string.Join(", ", missing)}."));
            }
        }

        rows.Add(Row(StatusResultType.Info, DashboardRow));
        return rows;
    }

    private static IEnumerable<HealthCheckStatus> SuccessRows(McpOverview overview, string area)
    {
        switch (area)
        {
            case McpFindingArea.Products:
                string[] installed = overview.Products
                    .Where(p => p.Installed)
                    .Select(p => p.Version is null ? p.DisplayName : $"{p.DisplayName} {p.Version}")
                    .ToArray();
                if (installed.Length > 0)
                {
                    yield return Row(StatusResultType.Success,
                        $"All installed products are available to the MCP server: {string.Join(", ", installed)}.");
                }

                break;

            case McpFindingArea.Server:
                if (overview.Server is { } server)
                {
                    yield return Row(StatusResultType.Success,
                        $"The MCP server last started as umbrella-mcp {server.Version} on {Utc(server.ReportedAt)} UTC, the same version as the add-on.");
                }

                break;

            case McpFindingArea.ApiUsers:
                foreach (McpOverviewApiUser user in overview.ApiUsers)
                {
                    yield return Row(StatusResultType.Success, UserSuccess(user));
                }

                break;
        }
    }

    private static bool IsHealthy(McpOverviewApiUser user) => user.State == "active" && user.Unreachable.Count == 0;

    private static string UserSuccess(McpOverviewApiUser user)
    {
        string ids = user.ClientIds.Count > 0 ? $" ({string.Join(", ", user.ClientIds)})" : string.Empty;
        string reach = user.Reachable.Count > 0 ? $" and can reach {string.Join(", ", user.Reachable)}" : string.Empty;
        return $"The API user \"{user.Name}\"{ids} last connected {Utc(user.LastConnected)} UTC{reach}.";
    }

    private static string Utc(DateTimeOffset when) => when.UtcDateTime.ToString("dd-MM-yyyy HH:mm", CultureInfo.InvariantCulture);

    private static HealthCheckStatus Row(StatusResultType type, string message) =>
        new(WebUtility.HtmlEncode(message)) { ResultType = type };
}
