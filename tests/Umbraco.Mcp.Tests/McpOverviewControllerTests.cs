using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.Api;
using Umbraco.Mcp.Client;
using Umbraco.Mcp.Connections;
using Umbraco.Mcp.Overview;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpOverviewControllerTests
{
    private sealed class StubOverview : IMcpOverviewService
    {
        public string? SeenSiteUrl { get; private set; } = "not called";

        public McpOverview Result { get; } = new("17.0.0", [], [], null, [], [], new McpJsonStatus(false, null));

        public Task<McpOverview> GetOverviewAsync(string? siteUrl)
        {
            SeenSiteUrl = siteUrl;
            return Task.FromResult(Result);
        }
    }

    private static McpOverviewController Controller(
        StubOverview? overview = null,
        FakeConnectionStore? connections = null,
        FakeMcpJsonFile? mcpJson = null,
        FakeToolSettingsStore? settings = null) =>
        new(overview ?? new StubOverview(), connections ?? new FakeConnectionStore(), settings ?? new FakeToolSettingsStore(),
            mcpJson ?? new FakeMcpJsonFile(), NullLogger<McpOverviewController>.Instance);

    private static string? PolicyOf(string method) =>
        typeof(McpOverviewController).GetMethod(method)!.GetCustomAttribute<AuthorizeAttribute>()?.Policy;

    [Test]
    public void Controller_requires_back_office_access_and_settings_for_every_endpoint()
    {
        Assert.That(typeof(McpOverviewController).GetCustomAttribute<AuthorizeAttribute>(inherit: false)!.Policy,
            Is.EqualTo(AuthorizationPolicies.BackOfficeAccess));
        Assert.That(PolicyOf(nameof(McpOverviewController.GetOverview)), Is.EqualTo(AuthorizationPolicies.SectionAccessSettings));
        Assert.That(PolicyOf(nameof(McpOverviewController.ForgetConnection)), Is.EqualTo(AuthorizationPolicies.SectionAccessSettings));
        Assert.That(PolicyOf(nameof(McpOverviewController.WriteMcpJson)), Is.EqualTo(AuthorizationPolicies.SectionAccessSettings));
    }

    [Test]
    public async Task Get_passes_the_request_site_url()
    {
        var overview = new StubOverview();
        McpOverviewController controller = Controller(overview);
        var http = new DefaultHttpContext();
        http.Request.Scheme = "https";
        http.Request.Host = new HostString("example.com");
        http.Request.PathBase = "/sub";
        controller.ControllerContext = new ControllerContext { HttpContext = http };

        IActionResult result = await controller.GetOverview();

        Assert.That(overview.SeenSiteUrl, Is.EqualTo("https://example.com/sub"));
        Assert.That(((OkObjectResult)result).Value, Is.SameAs(overview.Result));
    }

    [Test]
    public void Forget_known_connection_is_no_content()
    {
        Guid key = Guid.NewGuid();
        var connections = new FakeConnectionStore();
        connections.Record(key, DateTimeOffset.UtcNow);

        Assert.That(Controller(connections: connections).ForgetConnection(key), Is.InstanceOf<NoContentResult>());
        Assert.That(connections.Removed, Is.EqualTo(new[] { key }));
    }

    [Test]
    public void Forget_unknown_connection_is_not_found()
    {
        var settings = new FakeToolSettingsStore();

        Assert.That(Controller(settings: settings).ForgetConnection(Guid.NewGuid()), Is.InstanceOf<NotFoundResult>());
        Assert.That(settings.ClearedCatalogues, Is.Empty);
    }

    [Test]
    public void Forget_clears_the_user_catalogue_and_keeps_overrides()
    {
        Guid key = Guid.NewGuid();
        var connections = new FakeConnectionStore();
        connections.Record(key, DateTimeOffset.UtcNow);
        var overrides = new Dictionary<string, McpProductOverride> { ["forms"] = new([], "readOnly") };
        var settings = new FakeToolSettingsStore
        {
            UserOverrides = { [key] = overrides },
            UserCatalogues = { [key] = new McpToolCatalogue("17.0.0", new Dictionary<string, McpModuleCatalogue>()) },
        };

        IActionResult result = Controller(connections: connections, settings: settings).ForgetConnection(key);

        Assert.That(result, Is.InstanceOf<NoContentResult>());
        Assert.That(settings.ClearedCatalogues, Is.EqualTo(new[] { key }));
        Assert.That(settings.UserCatalogues, Does.Not.ContainKey(key));
        Assert.That(settings.UserOverrides[key], Is.SameAs(overrides));
    }

    [Test]
    public void Write_when_unavailable_is_not_found_and_writes_nothing()
    {
        var file = new FakeMcpJsonFile(isAvailable: false);

        Assert.That(Controller(mcpJson: file).WriteMcpJson(), Is.InstanceOf<NotFoundResult>());
        Assert.That(file.Writes, Is.Zero);
    }

    [Test]
    public void Write_returns_the_outcome()
    {
        var file = new FakeMcpJsonFile(isAvailable: true, path: "/site/.mcp.json");

        var result = (McpJsonResult)((OkObjectResult)Controller(mcpJson: file).WriteMcpJson()).Value!;

        Assert.That(result.Outcome, Is.EqualTo(McpJsonOutcome.Written));
        Assert.That(result.Path, Is.EqualTo("/site/.mcp.json"));
        Assert.That(file.Writes, Is.EqualTo(1));
    }

    [Test]
    public void Write_io_failure_is_a_500_problem_with_the_reason()
    {
        var file = new FakeMcpJsonFile(isAvailable: true, path: "/site/.mcp.json") { Throws = new IOException("disk full") };

        var result = (ObjectResult)Controller(mcpJson: file).WriteMcpJson();

        Assert.That(result.StatusCode, Is.EqualTo(500));
        Assert.That(((ProblemDetails)result.Value!).Detail, Does.Contain("disk full"));
    }

    [Test]
    public void SiteUrlFrom_is_null_without_a_request_or_host()
    {
        Assert.That(McpOverviewController.SiteUrlFrom(null), Is.Null);
        Assert.That(McpOverviewController.SiteUrlFrom(new DefaultHttpContext().Request), Is.Null);
    }
}
