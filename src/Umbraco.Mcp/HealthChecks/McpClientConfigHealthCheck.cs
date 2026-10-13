using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.Overview;

namespace Umbraco.Mcp.HealthChecks;

[HealthCheck(
    "0c7e5a91-2d4b-4f63-8e1a-9b5d3c7f2e48",
    "MCP client setup",
    Description = "Checks that the MCP server the AI tool last started is the add-on's version. " + McpHealthCheckRows.DashboardPointer,
    Group = "MCP")]
public sealed class McpClientConfigHealthCheck(IMcpOverviewService overview) : HealthCheck
{
    public override async Task<IEnumerable<HealthCheckStatus>> GetStatusAsync() =>
        McpHealthCheckRows.Build(await overview.GetOverviewAsync(), McpFindingArea.Server);

    public override HealthCheckStatus ExecuteAction(HealthCheckAction action) =>
        throw new InvalidOperationException("The MCP client setup health check has no actions.");
}
