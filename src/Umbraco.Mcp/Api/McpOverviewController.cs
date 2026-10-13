using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Web.Common.Authorization;
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
    IMcpJsonFile mcpJson,
    ILogger<McpOverviewController> logger) : ManagementApiControllerBase
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

    /// <summary>Writes (or upgrades) the site's <c>.mcp.json</c>. Never overwrites a file someone edited.</summary>
    [HttpPost("mcp-json")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(McpJsonResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status500InternalServerError)]
    public IActionResult WriteMcpJson()
    {
        if (!mcpJson.IsAvailable)
        {
            return NotFound();
        }

        try
        {
            return Ok(mcpJson.WriteOrUpgrade());
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning(ex, "Umbrella could not write .mcp.json");
            return Problem(detail: ex.Message, statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    internal static string? SiteUrlFrom(HttpRequest? request) =>
        request is null || !request.Host.HasValue
            ? null
            : $"{request.Scheme}://{request.Host}{request.PathBase}";
}
