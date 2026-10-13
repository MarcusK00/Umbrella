using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.Api;
using Umbraco.Mcp.ApiUser;
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
        public McpOverview Result { get; } = new("17.0.0", [], [], null, []);

        public Task<McpOverview> GetOverviewAsync() => Task.FromResult(Result);
    }

    private static readonly McpApiUserInfo Anna =
        new(Guid.NewGuid(), "Anna", UserState.Active, ["anna-mcp", "anna-laptop"]);

    private static readonly McpApiUserInfo NoCredentials = new(Guid.NewGuid(), "No credentials", UserState.Active, []);

    private static McpOverviewController Controller(
        StubOverview? overview = null,
        FakeConnectionStore? connections = null,
        FakeToolSettingsStore? settings = null,
        FakeApiUserDirectory? directory = null,
        string? configuredClientId = null)
    {
        var config = new Dictionary<string, string?>();
        if (configuredClientId is not null)
        {
            config["Umbraco:Mcp:ClientId"] = configuredClientId;
        }

        return new(
            overview ?? new StubOverview(),
            connections ?? new FakeConnectionStore(),
            settings ?? new FakeToolSettingsStore(),
            directory ?? new FakeApiUserDirectory(Anna, NoCredentials),
            new ConfigurationBuilder().AddInMemoryCollection(config).Build(),
            NullLogger<McpOverviewController>.Instance);
    }

    private static string? PolicyOf(string method) =>
        typeof(McpOverviewController).GetMethod(method)!.GetCustomAttribute<AuthorizeAttribute>()?.Policy;

    private static McpClientSetup Setup(IActionResult result) => (McpClientSetup)((OkObjectResult)result).Value!;

    [Test]
    public void Controller_requires_back_office_access_and_settings_for_every_endpoint()
    {
        Assert.That(typeof(McpOverviewController).GetCustomAttribute<AuthorizeAttribute>(inherit: false)!.Policy,
            Is.EqualTo(AuthorizationPolicies.BackOfficeAccess));
        Assert.That(PolicyOf(nameof(McpOverviewController.GetOverview)), Is.EqualTo(AuthorizationPolicies.SectionAccessSettings));
        Assert.That(PolicyOf(nameof(McpOverviewController.GetClientSetup)), Is.EqualTo(AuthorizationPolicies.SectionAccessSettings));
        Assert.That(PolicyOf(nameof(McpOverviewController.ForgetConnection)), Is.EqualTo(AuthorizationPolicies.SectionAccessSettings));
    }

    [Test]
    public async Task Get_returns_the_overview()
    {
        var overview = new StubOverview();

        IActionResult result = await Controller(overview).GetOverview();

        Assert.That(((OkObjectResult)result).Value, Is.SameAs(overview.Result));
    }

    [Test]
    public async Task Client_setup_defaults_to_the_configured_client_id()
    {
        McpClientSetup setup = Setup(await Controller().GetClientSetup());

        Assert.That(setup.ClientId, Is.EqualTo(McpClientConfig.DefaultClientId));
        Assert.That(setup.ConfiguredClientId, Is.EqualTo(McpClientConfig.DefaultClientId));
        Assert.That(setup.Clients.Select(c => c.Content), Has.All.Contain(McpClientConfig.DefaultClientId));
    }

    [Test]
    public async Task Client_setup_follows_the_client_id_setting()
    {
        McpClientSetup setup = Setup(await Controller(configuredClientId: "site-mcp").GetClientSetup());

        Assert.That(setup.ClientId, Is.EqualTo("site-mcp"));
        Assert.That(setup.ConfiguredClientId, Is.EqualTo("site-mcp"));
    }

    [Test]
    public async Task Client_setup_lists_only_api_users_with_a_client_id()
    {
        McpClientSetup setup = Setup(await Controller().GetClientSetup());

        Assert.That(setup.ApiUsers, Has.Count.EqualTo(1));
        Assert.That(setup.ApiUsers[0].Key, Is.EqualTo(Anna.Key));
        Assert.That(setup.ApiUsers[0].Name, Is.EqualTo("Anna"));
        Assert.That(setup.ApiUsers[0].ClientIds, Is.EqualTo(new[] { "anna-mcp", "anna-laptop" }));
    }

    [Test]
    public async Task Client_setup_fills_the_snippets_with_an_api_users_client_id()
    {
        McpClientSetup setup = Setup(await Controller().GetClientSetup("anna-laptop"));

        Assert.That(setup.ClientId, Is.EqualTo("anna-laptop"));
        Assert.That(setup.ConfiguredClientId, Is.EqualTo(McpClientConfig.DefaultClientId));
        Assert.That(setup.Clients.Select(c => c.Content), Has.All.Contain("anna-laptop"));
        Assert.That(setup.Clients.Select(c => c.Content), Has.None.Contain(McpClientConfig.DefaultClientId));
    }

    [Test]
    public async Task Client_setup_for_a_client_id_no_api_user_has_is_not_found() =>
        Assert.That(await Controller().GetClientSetup("ANNA-MCP"), Is.InstanceOf<NotFoundResult>());

    [Test]
    public async Task Client_setup_when_the_api_users_cannot_be_read_uses_the_configured_client_id()
    {
        var directory = new FakeApiUserDirectory(Anna) { Throws = new InvalidOperationException("db down") };

        McpClientSetup setup = Setup(await Controller(directory: directory).GetClientSetup());

        Assert.That(setup.ClientId, Is.EqualTo(McpClientConfig.DefaultClientId));
        Assert.That(setup.ApiUsers, Is.Empty);
        Assert.That(await Controller(directory: directory).GetClientSetup("anna-mcp"), Is.InstanceOf<NotFoundResult>());
    }

    [Test]
    public async Task Client_setup_uses_the_request_site_url()
    {
        McpOverviewController controller = Controller();
        var http = new DefaultHttpContext();
        http.Request.Scheme = "https";
        http.Request.Host = new HostString("example.com");
        http.Request.PathBase = "/sub";
        controller.ControllerContext = new ControllerContext { HttpContext = http };

        McpClientSetup setup = Setup(await controller.GetClientSetup());

        Assert.That(setup.Clients.Select(c => c.Content), Has.All.Contain("https://example.com/sub"));
    }

    [Test]
    public async Task Client_setup_without_a_request_uses_the_site_placeholder() =>
        Assert.That(Setup(await Controller().GetClientSetup()).Clients.Select(c => c.Content),
            Has.All.Contain(McpClientSnippets.SiteUrlPlaceholder));

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
}
