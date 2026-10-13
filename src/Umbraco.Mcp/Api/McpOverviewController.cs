using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Client;
using Umbraco.Mcp.Connections;
using Umbraco.Mcp.Overview;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Api;

[ApiVersion("1.0")]
[VersionedApiBackOfficeRoute("mcp")]
[ApiExplorerSettings(GroupName = "MCP")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess)]
public sealed class McpOverviewController(
    IMcpOverviewService overview,
    IMcpConnectionStore connections,
    IMcpToolSettingsStore toolSettings,
    IMcpApiUserDirectory apiUsers,
    IConfiguration configuration,
    ILogger<McpOverviewController> logger) : ManagementApiControllerBase
{
    /// <summary>What the Overview dashboard shows: status, findings and the connected API users.</summary>
    [HttpGet("overview")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(McpOverview), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetOverview() => Ok(await overview.GetOverviewAsync());

    /// <summary>
    /// The client config for one client id: <paramref name="clientId"/>, or the configured one when it is not given. Any
    /// other client id must belong to an API user, else 404. A failing read of the API users logs a warning and leaves
    /// only the configured client id.
    /// </summary>
    [HttpGet("client-setup")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(McpClientSetup), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetClientSetup(string? clientId = null)
    {
        string configured = McpClientConfig.ReadClientId(configuration);
        List<McpClientSetupUser> users = [];
        try
        {
            users = (await apiUsers.GetAllAsync())
                .Where(u => u.ClientIds.Count > 0)
                .Select(u => new McpClientSetupUser(u.Key, u.Name, u.ClientIds))
                .ToList();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Umbrella could not read the API users; the client config uses the configured client id only");
        }

        string chosen = string.IsNullOrEmpty(clientId) ? configured : clientId;
        if (chosen != configured && !users.Any(u => u.ClientIds.Contains(chosen, StringComparer.Ordinal)))
        {
            return NotFound();
        }

        return Ok(new McpClientSetup(
            chosen,
            configured,
            users,
            McpClientSnippets.Build(SiteUrlFrom(Request), chosen, McpAddon.Version)));
    }

    /// <summary>
    /// Forgets that an API user has connected, and what its MCP server last reported. The user's own tool settings are kept.
    /// It shows up again the next time the MCP server signs in.
    /// </summary>
    [HttpDelete("connections/{userKey:guid}")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult ForgetConnection(Guid userKey)
    {
        if (!connections.Remove(userKey))
        {
            return NotFound();
        }

        toolSettings.ClearUserCatalogue(userKey);
        return NoContent();
    }

    internal static string? SiteUrlFrom(HttpRequest? request) =>
        request is null || !request.Host.HasValue
            ? null
            : $"{request.Scheme}://{request.Host}{request.PathBase}";
}
