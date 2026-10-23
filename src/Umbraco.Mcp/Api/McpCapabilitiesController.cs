using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Connections;

namespace Umbraco.Mcp.Api;

[ApiVersion("1.0")]
[VersionedApiBackOfficeRoute("mcp")]
[ApiExplorerSettings(GroupName = "MCP")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess)]
public sealed class McpCapabilitiesController(
    IMcpCapabilitiesService capabilities,
    IBackOfficeSecurityAccessor backOfficeSecurityAccessor,
    IMcpConnectionStore connections,
    ILogger<McpCapabilitiesController> logger) : ManagementApiControllerBase
{
    [HttpGet("capabilities")]
    [MapToApiVersion("1.0")]
    [ProducesResponseType(typeof(McpCapabilities), StatusCodes.Status200OK)]
    public IActionResult GetCapabilities()
    {
        IUser? apiUser = CurrentApiUser();
        RecordConnection(apiUser?.Key);
        return Ok(capabilities.GetCapabilities(
            apiUser?.Key,
            apiUser is null ? null : ConnectedMcpApiUserProvider.ToSectionNames(apiUser.AllowedSections)));
    }

    /// <summary>
    /// The calling API user, or null for a normal backoffice user (for example someone trying the endpoint in Swagger),
    /// who gets the site defaults and is not the MCP server.
    /// </summary>
    private IUser? CurrentApiUser()
    {
        try
        {
            IUser? user = backOfficeSecurityAccessor.BackOfficeSecurity?.CurrentUser;
            return user?.Kind == UserKind.Api ? user : null;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read the calling user. The default tool settings apply.");
            return null;
        }
    }

    /// <summary>
    /// The MCP server calls this endpoint once when it starts, signed in as its API user. Remembering that user lets
    /// the "MCP API user" health check report on the user the MCP really uses, whatever its name or client id.
    /// </summary>
    private void RecordConnection(Guid? apiUserKey)
    {
        if (apiUserKey is not { } key)
        {
            return;
        }

        try
        {
            connections.Record(key, DateTimeOffset.UtcNow);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not record the MCP server's connection. The capabilities are returned anyway.");
        }
    }
}
