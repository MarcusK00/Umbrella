using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.Overview;

namespace Umbraco.Mcp.HealthChecks;

[HealthCheck(
    "b3a9e0d4-5c2f-4f8e-a6d1-7e4b2c9f0a35",
    "MCP API user",
    Description = "Checks the API users the Umbraco MCP has connected as: that they can still sign in and can reach each detected product.",
    Group = "MCP")]
public sealed class McpApiUserHealthCheck(IMcpOverviewService overview) : HealthCheck
{
    public override async Task<IEnumerable<HealthCheckStatus>> GetStatusAsync() =>
        McpHealthCheckRows.Build(await overview.GetOverviewAsync(), McpFindingArea.ApiUsers);

    public override HealthCheckStatus ExecuteAction(HealthCheckAction action) =>
        throw new InvalidOperationException("The MCP API user health check has no actions.");
}
