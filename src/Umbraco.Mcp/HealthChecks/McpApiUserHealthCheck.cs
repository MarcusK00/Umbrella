using System.Globalization;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.HealthChecks;

[HealthCheck(
    "b3a9e0d4-5c2f-4f8e-a6d1-7e4b2c9f0a35",
    "MCP API user",
    Description = "Checks the API users the Umbraco MCP has connected as: that they can still sign in and can reach each detected product.",
    Group = "MCP")]
public sealed class McpApiUserHealthCheck(
    IMcpApiUserProvider apiUser,
    IMcpCapabilitiesService capabilities,
    IEnumerable<IMcpProductDetector> detectors) : HealthCheck
{
    public override async Task<IEnumerable<HealthCheckStatus>> GetStatusAsync() =>
        BuildStatuses(
            await apiUser.GetConnectedAsync(),
            capabilities.GetCapabilities(),
            detectors.ToDictionary(d => d.Id, d => d.SectionAlias));

    public override HealthCheckStatus ExecuteAction(HealthCheckAction action) =>
        throw new InvalidOperationException("The MCP API user health check has no actions.");

    internal static IEnumerable<HealthCheckStatus> BuildStatuses(
        IReadOnlyList<McpApiUser> users,
        McpCapabilities caps,
        IReadOnlyDictionary<string, string?> sectionByProduct)
    {
        if (users.Count == 0)
        {
            return
            [
                new("No MCP server has connected to this site yet. The MCP server connects when your AI tool starts it; " +
                    "start it, then run this check again.")
                    { ResultType = StatusResultType.Info },
            ];
        }

        return users.SelectMany(user => BuildUserStatuses(user, caps, sectionByProduct)).ToList();
    }

    private static List<HealthCheckStatus> BuildUserStatuses(
        McpApiUser user,
        McpCapabilities caps,
        IReadOnlyDictionary<string, string?> sectionByProduct)
    {
        var rows = new List<HealthCheckStatus>();
        string name = user.ClientIds.Count > 0
            ? $"\"{user.Name}\" ({string.Join(", ", user.ClientIds)})"
            : $"\"{user.Name}\"";

        string? blocked = user.State switch
        {
            UserState.Disabled => "disabled",
            UserState.LockedOut => "locked out",
            _ => null,
        };
        if (blocked is not null)
        {
            rows.Add(new($"The API user {name} is {blocked}, so the MCP server can no longer sign in with it.")
                { ResultType = StatusResultType.Warning });
        }

        var reachable = new List<string>();
        foreach (McpProductStatus p in caps.Products.Where(p => p.Installed && p.Enabled))
        {
            if (!sectionByProduct.TryGetValue(p.Id, out string? section) || section is null)
            {
                continue;
            }

            if (user.AllowedSections.Contains(section, StringComparer.OrdinalIgnoreCase))
            {
                reachable.Add(p.DisplayName);
            }
            else
            {
                rows.Add(new($"The API user \"{user.Name}\" cannot use {p.DisplayName} tools: none of its user groups grant the {section} section.")
                    { ResultType = StatusResultType.Warning });
            }
        }

        if (rows.Count == 0)
        {
            string lastConnected = user.LastConnected.UtcDateTime.ToString("dd-MM-yyyy HH:mm", CultureInfo.InvariantCulture);
            string products = reachable.Count > 0 ? $" and can reach {string.Join(", ", reachable)}" : string.Empty;
            rows.Add(new($"The API user {name} last connected {lastConnected} UTC{products}.")
                { ResultType = StatusResultType.Success });
        }

        return rows;
    }
}
