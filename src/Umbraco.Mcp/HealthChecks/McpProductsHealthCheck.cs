using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.Overview;

namespace Umbraco.Mcp.HealthChecks;

[HealthCheck(
    "6f1d2c3a-8b47-4e2a-9c51-3d7e0b9a4f12",
    "MCP products",
    Description = "Shows which Umbraco HQ products the Umbraco MCP can see on this site and whether their APIs are available.",
    Group = "MCP")]
public sealed class McpProductsHealthCheck(IMcpOverviewService overview) : HealthCheck
{
    public override async Task<IEnumerable<HealthCheckStatus>> GetStatusAsync() =>
        McpHealthCheckRows.Build(await overview.GetOverviewAsync(null), McpFindingArea.Products);

    public override HealthCheckStatus ExecuteAction(HealthCheckAction action) =>
        throw new InvalidOperationException("The MCP products health check has no actions.");
}
