using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Security;
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
    IMcpCreatedUserStore created,
    IMcpToolSettingsStore toolSettings,
    IMcpApiUserDirectory apiUsers,
    IBackOfficeSecurityAccessor backOfficeSecurityAccessor,
    IConfiguration configuration,
    ILogger<McpOverviewController> logger) : ManagementApiControllerBase
{
    /// <summary>
    /// What the Overview dashboard shows: status, findings and the API users, and whether the caller has the Users
    /// section (so the dashboard offers to create and change API users; Umbraco's own endpoints still decide).
    /// </summary>
    [HttpGet("overview")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(McpOverview), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetOverview()
    {
        bool canManageUsers = backOfficeSecurityAccessor.BackOfficeSecurity?.CurrentUser?.AllowedSections
            .Contains(Constants.Applications.Users, StringComparer.OrdinalIgnoreCase) ?? false;
        return Ok(await overview.GetOverviewAsync() with { CanManageUsers = canManageUsers });
    }

    /// <summary>
    /// Records that the dashboard's New connection flow created this API user, so the Overview lists it before its MCP
    /// server first connects. Repeating it keeps the first time. 404 when the key is not an API user.
    /// </summary>
    [HttpPost("created-users/{userKey:guid}")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessUsers)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RecordCreatedUser(Guid userKey)
    {
        if (await apiUsers.GetAsync(userKey) is null)
        {
            return NotFound();
        }

        created.Record(userKey, DateTimeOffset.UtcNow);
        return NoContent();
    }

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
    /// Forgets that an API user has connected, and what its MCP server last reported, and that the New connection flow
    /// created it. The user itself and its own tool settings are kept. It shows up again the next time the MCP server
    /// signs in. 404 when there was neither a connection nor a record.
    /// </summary>
    [HttpDelete("connections/{userKey:guid}")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult ForgetConnection(Guid userKey)
    {
        bool wasConnected = connections.Remove(userKey);
        bool wasCreated = created.Remove(userKey);
        if (!wasConnected && !wasCreated)
        {
            return NotFound();
        }

        if (wasConnected)
        {
            toolSettings.ClearUserCatalogue(userKey);
        }

        return NoContent();
    }

    internal static string? SiteUrlFrom(HttpRequest? request) =>
        request is null || !request.Host.HasValue
            ? null
            : $"{request.Scheme}://{request.Host}{request.PathBase}";
}
