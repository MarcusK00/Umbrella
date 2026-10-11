using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.Capabilities;

namespace Umbraco.Mcp.Api;

[ApiVersion("1.0")]
[VersionedApiBackOfficeRoute("mcp")]
[ApiExplorerSettings(GroupName = "MCP")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess)]
public sealed class McpCapabilitiesController(IMcpCapabilitiesService capabilities) : ManagementApiControllerBase
{
    [HttpGet("capabilities")]
    [MapToApiVersion("1.0")]
    [ProducesResponseType(typeof(McpCapabilities), StatusCodes.Status200OK)]
    public IActionResult GetCapabilities() => Ok(capabilities.GetCapabilities());
}
