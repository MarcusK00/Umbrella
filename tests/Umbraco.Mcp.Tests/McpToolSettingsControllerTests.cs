using System.Text.Json;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NUnit.Framework;
using Umbraco.Cms.Core.Configuration.Models;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.Api;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpToolSettingsControllerTests
{
    private sealed class StubCapabilities(params string[] ids) : IMcpCapabilitiesService
    {
        public McpCapabilities GetCapabilities() =>
            new("17.0.0", ids.Select(id => new McpProductStatus(id, id, true, true, "17.0.0", [])).ToList());
    }

    private static IUser User(UserKind kind) => new User(new GlobalSettings()) { Key = Guid.NewGuid(), Kind = kind };

    private static McpToolSettingsController Controller(FakeToolSettingsStore store, IUser? user = null) =>
        new(store, new StubCapabilities("cms", "forms"), new FakeBackOfficeSecurityAccessor(user ?? User(UserKind.Default)));

    private static McpCatalogueReport Report(string id = "forms", int collections = 1, string name = "prevalue-source") =>
        new("17.0.0-alpha.1", [new McpModuleReport(id, false, Enumerable.Range(0, collections).Select(i => new McpCollectionInfo(collections == 1 ? name : $"{name}-{i}", 10)).ToList())]);

    private static string? PolicyOf(string method) =>
        typeof(McpToolSettingsController).GetMethod(method)!.GetCustomAttribute<AuthorizeAttribute>()?.Policy;

    [Test]
    public void Controller_requires_back_office_access_and_settings_for_the_dashboard_endpoints()
    {
        Assert.That(typeof(McpToolSettingsController).GetCustomAttribute<AuthorizeAttribute>(inherit: false)!.Policy,
            Is.EqualTo(AuthorizationPolicies.BackOfficeAccess));
        Assert.That(PolicyOf(nameof(McpToolSettingsController.GetToolSettings)), Is.EqualTo(AuthorizationPolicies.SectionAccessSettings));
        Assert.That(PolicyOf(nameof(McpToolSettingsController.PutToolSettings)), Is.EqualTo(AuthorizationPolicies.SectionAccessSettings));
        Assert.That(PolicyOf(nameof(McpToolSettingsController.PostCatalogue)), Is.Null);
    }

    [Test]
    public void Get_returns_products_catalogue_disabled_lists_and_read_only_modules()
    {
        var store = new FakeToolSettingsStore { Disabled = new() { ["forms"] = ["prevalue-source"] }, ReadOnly = ["cms"] };

        var body = (McpToolSettingsResponse)((OkObjectResult)Controller(store).GetToolSettings()).Value!;

        Assert.That(body.Products.Select(p => p.Id), Is.EqualTo(new[] { "cms", "forms" }));
        Assert.That(body.Catalogue, Is.SameAs(store.Catalogue));
        Assert.That(body.DisabledCollections["forms"], Is.EqualTo(new[] { "prevalue-source" }));
        Assert.That(body.ReadOnlyModules, Is.EqualTo(new[] { "cms" }));
    }

    [Test]
    public void Get_returns_the_addon_version_so_the_dashboard_can_spot_an_older_mcp_server()
    {
        var body = (McpToolSettingsResponse)((OkObjectResult)Controller(new FakeToolSettingsStore()).GetToolSettings()).Value!;

        Assert.That(body.AddonVersion, Is.EqualTo("17.0.0"));
    }

    [Test]
    public void Put_stores_read_only_modules_trimmed_and_deduplicated()
    {
        var store = new FakeToolSettingsStore();

        IActionResult result = Controller(store).PutToolSettings(new McpToolSettingsRequest(
            new Dictionary<string, IReadOnlyList<string>?>(), [" forms ", "forms", ""]));

        Assert.That(result, Is.InstanceOf<OkObjectResult>());
        Assert.That(store.ReadOnly, Is.EqualTo(new[] { "forms" }));
    }

    [Test]
    public void Put_without_read_only_modules_clears_them()
    {
        var store = new FakeToolSettingsStore { ReadOnly = ["forms"] };

        Controller(store).PutToolSettings(new McpToolSettingsRequest(new Dictionary<string, IReadOnlyList<string>?>()));

        Assert.That(store.ReadOnly, Is.Empty);
    }

    [Test]
    public void Put_rejects_an_unknown_read_only_module_and_stores_nothing()
    {
        var store = new FakeToolSettingsStore { ReadOnly = ["cms"] };

        IActionResult result = Controller(store).PutToolSettings(new McpToolSettingsRequest(
            new Dictionary<string, IReadOnlyList<string>?> { ["forms"] = ["prevalue-source"] }, ["commerce"]));

        Assert.That(result, Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(store.Disabled, Is.Empty);
        Assert.That(store.ReadOnly, Is.EqualTo(new[] { "cms" }));
    }

    [Test]
    public void PostCatalogue_keeps_disabledByDefault()
    {
        var store = new FakeToolSettingsStore();
        var report = new McpCatalogueReport("17.0.0", [new McpModuleReport("forms", false, [new McpCollectionInfo("umbraco-server", 1, 1, true)])]);

        Controller(store, User(UserKind.Api)).PostCatalogue(report);

        Assert.That(store.Merged.Single().Report.Modules.Single().Collections.Single().DisabledByDefault, Is.True);
    }

    [Test]
    public void Report_without_disabledByDefault_stores_false()
    {
        var store = new FakeToolSettingsStore();
        var report = JsonSerializer.Deserialize<McpCatalogueReport>(
            """{"umbrellaVersion":"17.0.0","modules":[{"id":"forms","siteSettingsIgnored":false,"collections":[{"name":"form","toolCount":10}]}]}""",
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        Controller(store, User(UserKind.Api)).PostCatalogue(report);

        Assert.That(store.Merged.Single().Report.Modules.Single().Collections.Single().DisabledByDefault, Is.False);
    }

    [TestCase(4, 4)]
    [TestCase(-1, 0)]
    [TestCase(99, 10)]
    [TestCase(null, null)]
    public void Post_keeps_read_only_counts_between_zero_and_the_tool_count(int? reported, int? stored)
    {
        var store = new FakeToolSettingsStore();
        var report = new McpCatalogueReport("17.0.0", [new McpModuleReport("forms", false, [new McpCollectionInfo("form", 10, reported)])]);

        Controller(store, User(UserKind.Api)).PostCatalogue(report);

        Assert.That(store.Merged.Single().Report.Modules.Single().Collections.Single().ReadOnlyToolCount, Is.EqualTo(stored));
    }

    [Test]
    public void Put_trims_drops_empty_and_deduplicates_names()
    {
        var store = new FakeToolSettingsStore();

        IActionResult result = Controller(store).PutToolSettings(new McpToolSettingsRequest(new Dictionary<string, IReadOnlyList<string>?>
        {
            ["forms"] = [" prevalue-source ", "", "prevalue-source", "data-source"],
            ["cms"] = null,
        }));

        Assert.That(result, Is.InstanceOf<OkObjectResult>());
        Assert.That(store.Disabled["forms"], Is.EqualTo(new[] { "prevalue-source", "data-source" }));
        Assert.That(store.Disabled["cms"], Is.Empty);
    }

    [TestCase("commerce")]
    [TestCase("Forms")]
    public void Put_rejects_a_module_id_that_is_not_a_detected_product(string id)
    {
        var store = new FakeToolSettingsStore();

        IActionResult result = Controller(store).PutToolSettings(
            new McpToolSettingsRequest(new Dictionary<string, IReadOnlyList<string>?> { [id] = ["x"] }));

        Assert.That(result, Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(store.Disabled, Is.Empty);
    }

    [Test]
    public void Put_rejects_a_missing_body_and_oversized_lists()
    {
        var store = new FakeToolSettingsStore();
        var tooMany = Enumerable.Range(0, McpToolSettingsValidation.MaxCollections + 1).Select(i => $"c{i}").ToList();
        var tooLong = new string('x', McpToolSettingsValidation.MaxNameLength + 1);

        Assert.That(Controller(store).PutToolSettings(new McpToolSettingsRequest(null)), Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(Controller(store).PutToolSettings(new McpToolSettingsRequest(new Dictionary<string, IReadOnlyList<string>?> { ["forms"] = tooMany })),
            Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(Controller(store).PutToolSettings(new McpToolSettingsRequest(new Dictionary<string, IReadOnlyList<string>?> { ["forms"] = [tooLong] })),
            Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(store.Disabled, Is.Empty);
    }

    [Test]
    public void Post_from_a_normal_backoffice_user_is_forbidden_and_not_stored()
    {
        var store = new FakeToolSettingsStore();

        IActionResult result = Controller(store, User(UserKind.Default)).PostCatalogue(Report());

        Assert.That(result, Is.InstanceOf<StatusCodeResult>().With.Property(nameof(StatusCodeResult.StatusCode)).EqualTo(403));
        Assert.That(store.Merged, Is.Empty);
    }

    [Test]
    public void Post_from_an_api_user_merges_the_report_with_the_current_time()
    {
        var store = new FakeToolSettingsStore();
        DateTimeOffset before = DateTimeOffset.UtcNow;

        IActionResult result = Controller(store, User(UserKind.Api)).PostCatalogue(Report());

        Assert.That(result, Is.InstanceOf<NoContentResult>());
        Assert.That(store.Merged.Single().Report.Modules.Single().Collections.Single(), Is.EqualTo(new McpCollectionInfo("prevalue-source", 10)));
        Assert.That(store.Merged.Single().At, Is.InRange(before, DateTimeOffset.UtcNow));
    }

    // Review Focus 4: a newer npm may report a module this add-on has no detector for.
    [Test]
    public void Post_accepts_a_module_the_add_on_does_not_know()
    {
        var store = new FakeToolSettingsStore();

        Assert.That(Controller(store, User(UserKind.Api)).PostCatalogue(Report("commerce")), Is.InstanceOf<NoContentResult>());
        Assert.That(store.Merged.Single().Report.Modules.Single().Id, Is.EqualTo("commerce"));
    }

    [Test]
    public void Post_rejects_oversized_reports()
    {
        var store = new FakeToolSettingsStore();
        var api = User(UserKind.Api);

        Assert.That(Controller(store, api).PostCatalogue(Report(collections: McpToolSettingsValidation.MaxCollections + 1)), Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(Controller(store, api).PostCatalogue(Report(name: new string('x', McpToolSettingsValidation.MaxNameLength + 1))), Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(Controller(store, api).PostCatalogue(Report(id: "")), Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(store.Merged, Is.Empty);
    }
}
