using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.HealthChecks;

[HealthCheck(
    "b3a9e0d4-5c2f-4f8e-a6d1-7e4b2c9f0a35",
    "MCP API user",
    Description = "Checks that the API user the Umbraco MCP signs in with exists, can sign in and can reach each detected product.",
    Group = "MCP")]
public sealed class McpApiUserHealthCheck(
    IMcpApiUserProvider apiUser,
    IMcpCapabilitiesService capabilities,
    IEnumerable<IMcpProductDetector> detectors) : HealthCheck
{
    public override async Task<IEnumerable<HealthCheckStatus>> GetStatusAsync() =>
        BuildStatuses(
            apiUser.ClientId,
            await apiUser.FindAsync(),
            capabilities.GetCapabilities(),
            detectors.ToDictionary(d => d.Id, d => d.SectionAlias));

    public override HealthCheckStatus ExecuteAction(HealthCheckAction action) =>
        throw new InvalidOperationException("The MCP API user health check has no actions.");

    internal static IEnumerable<HealthCheckStatus> BuildStatuses(
        string clientId,
        McpApiUser? user,
        McpCapabilities caps,
        IReadOnlyDictionary<string, string?> sectionByProduct)
    {
        if (user is null)
        {
            return
            [
                new($"No API user has the client id \"{clientId}\", so the MCP server cannot sign in. " +
                    "Create an API user with this client id under Users, or set Umbraco:Mcp:ClientId to the client id the MCP server uses.")
                    { ResultType = StatusResultType.Warning },
            ];
        }

        var rows = new List<HealthCheckStatus>();

        string? blocked = user.State switch
        {
            UserState.Disabled => "disabled",
            UserState.LockedOut => "locked out",
            _ => null,
        };
        if (blocked is not null)
        {
            rows.Add(new($"The API user \"{user.Name}\" ({clientId}) is {blocked}, so the MCP server cannot sign in.")
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
            string products = reachable.Count > 0 ? $" and can reach {string.Join(", ", reachable)}" : string.Empty;
            rows.Add(new($"The API user \"{user.Name}\" ({clientId}) exists{products}. Its client secret is not checked here.")
                { ResultType = StatusResultType.Success });
        }

        return rows;
    }
}
