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
        RecordConnection();
        return Ok(capabilities.GetCapabilities());
    }

    /// <summary>
    /// The MCP server calls this endpoint once when it starts, signed in as its API user. Remembering that user lets
    /// the "MCP API user" health check report on the user the MCP really uses, whatever its name or client id.
    /// Calls from normal backoffice users (for example Swagger) are not the MCP server and are not recorded.
    /// </summary>
    private void RecordConnection()
    {
        try
        {
            IUser? user = backOfficeSecurityAccessor.BackOfficeSecurity?.CurrentUser;
            if (user?.Kind == UserKind.Api)
            {
                connections.Record(user.Key, DateTimeOffset.UtcNow);
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not record the MCP server's connection. The capabilities are returned anyway.");
        }
    }
}
