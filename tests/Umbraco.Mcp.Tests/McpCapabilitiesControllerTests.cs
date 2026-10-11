using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NUnit.Framework;
using Umbraco.Mcp.Api;
using Umbraco.Mcp.Capabilities;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpCapabilitiesControllerTests
{
    private sealed class StubService(McpCapabilities caps) : IMcpCapabilitiesService
    {
        public McpCapabilities GetCapabilities() => caps;
    }

    [Test]
    public void Get_returns_ok_with_service_result()
    {
        var caps = new McpCapabilities("17.0.0", [new McpProductStatus("cms", "Umbraco CMS", true, true, "17.7.0", [])]);
        var controller = new McpCapabilitiesController(new StubService(caps));

        IActionResult result = controller.GetCapabilities();

        Assert.That(result, Is.InstanceOf<OkObjectResult>());
        Assert.That(((OkObjectResult)result).Value, Is.SameAs(caps));
    }

    [Test]
    public void Controller_requires_back_office_access()
    {
        var attribute = typeof(McpCapabilitiesController).GetCustomAttribute<AuthorizeAttribute>(inherit: false);

        Assert.That(attribute, Is.Not.Null);
        Assert.That(attribute!.Policy, Is.EqualTo(AuthorizationPolicies.BackOfficeAccess));
    }
}
