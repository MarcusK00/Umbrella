using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Web.Common.Authorization;
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
    IMcpToolSettingsStore toolSettings) : ManagementApiControllerBase
{
    /// <summary>What the Overview dashboard shows: status, findings, connected API users and client snippets.</summary>
    [HttpGet("overview")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(McpOverview), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetOverview() => Ok(await overview.GetOverviewAsync(SiteUrlFrom(Request)));

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
