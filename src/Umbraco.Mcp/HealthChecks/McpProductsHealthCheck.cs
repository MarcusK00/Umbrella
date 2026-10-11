using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.Capabilities;

namespace Umbraco.Mcp.HealthChecks;

[HealthCheck(
    "6f1d2c3a-8b47-4e2a-9c51-3d7e0b9a4f12",
    "MCP products",
    Description = "Shows which Umbraco HQ products the Umbraco MCP can see on this site and whether their APIs are available.",
    Group = "MCP")]
public sealed class McpProductsHealthCheck(IMcpCapabilitiesService capabilities) : HealthCheck
{
    public override Task<IEnumerable<HealthCheckStatus>> GetStatusAsync() =>
        Task.FromResult(BuildStatuses(capabilities.GetCapabilities()));

    public override HealthCheckStatus ExecuteAction(HealthCheckAction action) =>
        throw new InvalidOperationException("The MCP products health check has no actions.");

    internal static IEnumerable<HealthCheckStatus> BuildStatuses(McpCapabilities caps)
    {
        var rows = new List<HealthCheckStatus>
        {
            new($"{McpAddon.PackageId} {caps.AddonVersion} is installed.") { ResultType = StatusResultType.Info },
        };

        foreach (var p in caps.Products)
        {
            string name = p.Version is null ? p.DisplayName : $"{p.DisplayName} {p.Version}";

            if (!p.Installed && p.Issues.Count == 0)
            {
                rows.Add(new($"{p.DisplayName} is not installed.") { ResultType = StatusResultType.Info });
            }
            else if (p.Installed && p.Enabled && p.Issues.Count == 0)
            {
                rows.Add(new($"{name} is installed and its API is available.") { ResultType = StatusResultType.Success });
            }
            else
            {
                string detail = p.Issues.Count > 0 ? string.Join(" ", p.Issues) : "Installed, but its API is not available.";
                rows.Add(new($"{name}: {detail}") { ResultType = StatusResultType.Warning });
            }
        }

        return rows;
    }
}
