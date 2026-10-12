using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Api;

public sealed record McpToolSettingsResponse(
    IReadOnlyList<McpProductStatus> Products,
    McpToolCatalogue Catalogue,
    IReadOnlyDictionary<string, IReadOnlyList<string>> DisabledCollections);

public sealed record McpToolSettingsRequest(IReadOnlyDictionary<string, IReadOnlyList<string>?>? DisabledCollections);

[ApiVersion("1.0")]
[VersionedApiBackOfficeRoute("mcp")]
[ApiExplorerSettings(GroupName = "MCP")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess)]
public sealed class McpToolSettingsController(
    IMcpToolSettingsStore store,
    IMcpCapabilitiesService capabilities,
    IBackOfficeSecurityAccessor backOfficeSecurityAccessor) : ManagementApiControllerBase
{
    /// <summary>What the "Umbrella" dashboard shows: the products, the groups the MCP server reported, and what is switched off.</summary>
    [HttpGet("tool-settings")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(McpToolSettingsResponse), StatusCodes.Status200OK)]
    public IActionResult GetToolSettings() =>
        Ok(new McpToolSettingsResponse(capabilities.GetCapabilities().Products, store.GetCatalogue(), store.GetDisabledCollections()));

    [HttpPut("tool-settings")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(IReadOnlyDictionary<string, IReadOnlyList<string>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    public IActionResult PutToolSettings([FromBody] McpToolSettingsRequest request)
    {
        var known = capabilities.GetCapabilities().Products.Select(p => p.Id).ToHashSet(StringComparer.Ordinal);
        string? error = McpToolSettingsValidation.TryNormalizeSettings(request?.DisabledCollections, known, out var disabled);
        if (error is not null)
        {
            return BadRequest(new ProblemDetails { Title = "Invalid MCP tool settings", Detail = error });
        }

        store.SetDisabledCollections(disabled);
        return Ok(disabled);
    }

    /// <summary>
    /// The MCP server calls this once when it starts, signed in as its API user, with every tool group it loaded. Calls
    /// from normal backoffice users (for example Swagger) are not the MCP server and are refused.
    /// </summary>
    [HttpPost("catalogue")]
    [MapToApiVersion("1.0")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public IActionResult PostCatalogue([FromBody] McpCatalogueReport report)
    {
        if (backOfficeSecurityAccessor.BackOfficeSecurity?.CurrentUser?.Kind != UserKind.Api)
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }

        string? error = McpToolSettingsValidation.TryNormalizeReport(report, out McpCatalogueReport normalized);
        if (error is not null)
        {
            return BadRequest(new ProblemDetails { Title = "Invalid MCP catalogue", Detail = error });
        }

        store.MergeCatalogue(normalized, DateTimeOffset.UtcNow);
        return NoContent();
    }
}
