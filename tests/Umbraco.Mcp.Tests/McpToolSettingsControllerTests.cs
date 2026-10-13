using System.Text.Json;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NUnit.Framework;
using Umbraco.Cms.Core.Configuration.Models;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.Api;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpToolSettingsControllerTests
{
    private sealed class StubCapabilities(params string[] ids) : IMcpCapabilitiesService
    {
        public McpCapabilities GetCapabilities(Guid? apiUserKey = null) =>
            new("17.0.0", ids.Select(id => new McpProductStatus(id, id, true, true, "17.0.0", [])).ToList());
    }

    private static IUser User(UserKind kind) => new User(new GlobalSettings()) { Key = Guid.NewGuid(), Kind = kind };

    private static McpToolSettingsController Controller(FakeToolSettingsStore store, IUser? user = null, FakeApiUserDirectory? directory = null) =>
        new(store, new StubCapabilities("cms", "forms"), directory ?? new FakeApiUserDirectory(), new FakeBackOfficeSecurityAccessor(user ?? User(UserKind.Default)));

    private static McpApiUserInfo ApiUser(string name, UserState state = UserState.Active, params string[] clientIds) =>
        new(Guid.NewGuid(), name, state, clientIds);

    private static readonly DateTimeOffset T1 = new(2026, 10, 1, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset T2 = new(2026, 10, 2, 8, 0, 0, TimeSpan.Zero);

    private static McpToolCatalogue Catalogue(DateTimeOffset at, string module = "forms") =>
        new("17.0.0", new Dictionary<string, McpModuleCatalogue> { [module] = new(at, false, [new McpCollectionInfo("form", 3)]) });

    private static McpProductOverride Override(string level = McpToolLevel.Full, params string[] disabled) => new(disabled, level);

    private static bool SameOverride(McpProductOverride x, McpProductOverride y) =>
        x.Level == y.Level && x.DisabledCollections.SequenceEqual(y.DisabledCollections);

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
    public async Task Get_returns_products_catalogue_disabled_lists_and_read_only_modules()
    {
        var store = new FakeToolSettingsStore { Disabled = new() { ["forms"] = ["prevalue-source"] }, ReadOnly = ["cms"] };

        var body = (McpToolSettingsResponse)((OkObjectResult)await Controller(store).GetToolSettings()).Value!;

        Assert.That(body.Products.Select(p => p.Id), Is.EqualTo(new[] { "cms", "forms" }));
        Assert.That(body.Catalogue, Is.SameAs(store.Catalogue));
        Assert.That(body.DisabledCollections["forms"], Is.EqualTo(new[] { "prevalue-source" }));
        Assert.That(body.ReadOnlyModules, Is.EqualTo(new[] { "cms" }));
    }

    [Test]
    public async Task Get_returns_no_destructive_modules()
    {
        var store = new FakeToolSettingsStore { NoDestructive = ["forms"] };

        var body = (McpToolSettingsResponse)((OkObjectResult)await Controller(store).GetToolSettings()).Value!;

        Assert.That(body.NoDestructiveModules, Is.EqualTo(new[] { "forms" }));
    }

    [Test]
    public void Put_stores_no_destructive_modules_trimmed_and_deduplicated()
    {
        var store = new FakeToolSettingsStore();

        IActionResult result = Controller(store).PutToolSettings(new McpToolSettingsRequest(
            new Dictionary<string, IReadOnlyList<string>?>(), null, [" forms ", "forms", ""]));

        Assert.That(result, Is.InstanceOf<OkObjectResult>());
        Assert.That(store.NoDestructive, Is.EqualTo(new[] { "forms" }));
        Assert.That(((McpToolSettings)((OkObjectResult)result).Value!).NoDestructiveModules, Is.EqualTo(new[] { "forms" }));
    }

    [Test]
    public void Put_rejects_a_module_in_both_lists_and_stores_nothing()
    {
        var store = new FakeToolSettingsStore
        {
            Disabled = new() { ["cms"] = ["a"] },
            ReadOnly = ["cms"],
            NoDestructive = ["cms"],
        };

        IActionResult result = Controller(store).PutToolSettings(new McpToolSettingsRequest(
            new Dictionary<string, IReadOnlyList<string>?> { ["forms"] = ["x"] }, ["forms"], ["forms"]));

        Assert.That(result, Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(((ProblemDetails)((BadRequestObjectResult)result).Value!).Detail,
            Is.EqualTo("A product cannot be both read-only and limited to non-destructive tools: forms."));
        Assert.That(store.Disabled.Keys, Is.EqualTo(new[] { "cms" }));
        Assert.That(store.ReadOnly, Is.EqualTo(new[] { "cms" }));
        Assert.That(store.NoDestructive, Is.EqualTo(new[] { "cms" }));
    }

    [Test]
    public void Put_without_no_destructive_modules_clears_them()
    {
        var store = new FakeToolSettingsStore { NoDestructive = ["forms"] };

        Controller(store).PutToolSettings(new McpToolSettingsRequest(new Dictionary<string, IReadOnlyList<string>?>()));

        Assert.That(store.NoDestructive, Is.Empty);
    }

    [Test]
    public void Put_rejects_an_unknown_no_destructive_module()
    {
        var store = new FakeToolSettingsStore { NoDestructive = ["cms"] };

        IActionResult result = Controller(store).PutToolSettings(new McpToolSettingsRequest(
            new Dictionary<string, IReadOnlyList<string>?>(), null, ["commerce"]));

        Assert.That(result, Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(((ProblemDetails)((BadRequestObjectResult)result).Value!).Detail, Does.StartWith("noDestructiveModules:"));
        Assert.That(store.NoDestructive, Is.EqualTo(new[] { "cms" }));
    }

    [TestCase(4, 4)]
    [TestCase(-1, 0)]
    [TestCase(99, 10)]
    [TestCase(null, null)]
    public void Post_keeps_non_destructive_counts_between_zero_and_the_tool_count(int? reported, int? stored)
    {
        var store = new FakeToolSettingsStore();
        var report = new McpCatalogueReport("17.0.0", [new McpModuleReport("forms", false, [new McpCollectionInfo("form", 10, null, false, reported)])]);

        Controller(store, User(UserKind.Api)).PostCatalogue(report);

        Assert.That(store.Merged.Single().Report.Modules.Single().Collections.Single().NonDestructiveToolCount, Is.EqualTo(stored));
    }

    [Test]
    public async Task Get_returns_the_addon_version_so_the_dashboard_can_spot_an_older_mcp_server()
    {
        var body = (McpToolSettingsResponse)((OkObjectResult)await Controller(new FakeToolSettingsStore()).GetToolSettings()).Value!;

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
        Assert.That(store.UserCatalogues, Is.Empty);
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
        Assert.That(store.UserCatalogues, Is.Empty);
    }

    [Test]
    public async Task Get_lists_every_api_user_with_last_report_and_overridden_products()
    {
        McpApiUserInfo zed = ApiUser("Zed", UserState.LockedOut, "zed-client");
        McpApiUserInfo ann = ApiUser("ann", UserState.Active, "ann-client", "ann-2");
        var store = new FakeToolSettingsStore
        {
            UserCatalogues = new() { [zed.Key] = Catalogue(T1) },
            UserOverrides = new() { [zed.Key] = new Dictionary<string, McpProductOverride> { ["forms"] = Override(McpToolLevel.ReadOnly), ["cms"] = Override() } },
        };

        var body = (McpToolSettingsResponse)((OkObjectResult)await Controller(store, directory: new FakeApiUserDirectory(zed, ann)).GetToolSettings()).Value!;

        Assert.That(body.ApiUsers.Select(u => u.Name), Is.EqualTo(new[] { "ann", "Zed" }));
        McpToolSettingsApiUser first = body.ApiUsers[0], second = body.ApiUsers[1];
        Assert.That(first.Key, Is.EqualTo(ann.Key));
        Assert.That(first.ClientIds, Is.EqualTo(new[] { "ann-client", "ann-2" }));
        Assert.That(first.State, Is.EqualTo("active"));
        Assert.That(first.LastReportedAt, Is.Null);
        Assert.That(first.OverriddenProducts, Is.Empty);
        Assert.That(second.State, Is.EqualTo("lockedOut"));
        Assert.That(second.LastReportedAt, Is.EqualTo(T1));
        Assert.That(second.OverriddenProducts, Is.EquivalentTo(new[] { "cms", "forms" }));
    }

    [Test]
    public async Task Get_ignores_rows_of_users_that_are_not_api_users()
    {
        McpApiUserInfo ann = ApiUser("ann");
        var store = new FakeToolSettingsStore
        {
            UserCatalogues = new() { [Guid.NewGuid()] = Catalogue(T2) },
            UserOverrides = new() { [Guid.NewGuid()] = new Dictionary<string, McpProductOverride> { ["forms"] = Override() } },
        };

        var body = (McpToolSettingsResponse)((OkObjectResult)await Controller(store, directory: new FakeApiUserDirectory(ann)).GetToolSettings()).Value!;

        Assert.That(body.ApiUsers.Single().LastReportedAt, Is.Null);
        Assert.That(body.ApiUsers.Single().OverriddenProducts, Is.Empty);
    }

    [Test]
    public async Task Get_user_returns_overrides_and_catalogue_source()
    {
        McpApiUserInfo ann = ApiUser("ann");
        McpToolCatalogue own = Catalogue(T1);
        var store = new FakeToolSettingsStore
        {
            UserCatalogues = new() { [ann.Key] = own },
            UserOverrides = new() { [ann.Key] = new Dictionary<string, McpProductOverride> { ["forms"] = Override(McpToolLevel.NoDestructive, "form") } },
        };

        IActionResult result = await Controller(store, directory: new FakeApiUserDirectory(ann)).GetUserToolSettings(ann.Key);

        var body = (McpUserToolSettingsResponse)((OkObjectResult)result).Value!;
        Assert.That(SameOverride(body.Overrides["forms"], Override(McpToolLevel.NoDestructive, "form")), Is.True);
        Assert.That(body.Catalogue, Is.SameAs(own));
        Assert.That(body.CatalogueSource, Is.EqualTo(new McpCatalogueSource("user", T1)));
    }

    // Review Focus 4: a forgotten connection keeps its overrides but borrows another user's counts.
    [Test]
    public async Task Forgotten_user_gets_the_fallback_catalogue()
    {
        McpApiUserInfo ann = ApiUser("ann");
        McpApiUserInfo bob = ApiUser("bob");
        McpToolCatalogue bobs = Catalogue(T2);
        var store = new FakeToolSettingsStore
        {
            UserCatalogues = new() { [bob.Key] = bobs },
            UserOverrides = new() { [ann.Key] = new Dictionary<string, McpProductOverride> { ["forms"] = Override() } },
        };

        var body = (McpUserToolSettingsResponse)((OkObjectResult)await Controller(store, directory: new FakeApiUserDirectory(ann, bob)).GetUserToolSettings(ann.Key)).Value!;

        Assert.That(body.Overrides.Keys, Is.EqualTo(new[] { "forms" }));
        Assert.That(body.Catalogue, Is.SameAs(bobs));
        Assert.That(body.CatalogueSource, Is.EqualTo(new McpCatalogueSource("latest", T2, "bob")));
    }

    [Test]
    public async Task Get_user_without_any_catalogue_has_source_none()
    {
        McpApiUserInfo ann = ApiUser("ann");

        var body = (McpUserToolSettingsResponse)((OkObjectResult)await Controller(new FakeToolSettingsStore(), directory: new FakeApiUserDirectory(ann)).GetUserToolSettings(ann.Key)).Value!;

        Assert.That(body.Catalogue, Is.SameAs(McpToolCatalogue.Empty));
        Assert.That(body.CatalogueSource.Kind, Is.EqualTo("none"));
    }

    [Test]
    public async Task Get_user_404_for_unknown_or_non_api_user()
    {
        McpApiUserInfo ann = ApiUser("ann");
        McpToolSettingsController controller = Controller(new FakeToolSettingsStore(), directory: new FakeApiUserDirectory(ann));

        Assert.That(await controller.GetUserToolSettings(Guid.NewGuid()), Is.InstanceOf<NotFoundResult>());
    }

    [Test]
    public async Task Put_user_stores_normalised_overrides()
    {
        McpApiUserInfo ann = ApiUser("ann");
        var store = new FakeToolSettingsStore();

        IActionResult result = await Controller(store, directory: new FakeApiUserDirectory(ann)).PutUserToolSettings(ann.Key,
            new McpUserToolSettingsRequest(new Dictionary<string, McpProductOverrideRequest?>
            {
                ["forms"] = new([" prevalue-source ", "", "prevalue-source", "data-source"], McpToolLevel.ReadOnly),
                ["cms"] = new([], McpToolLevel.Full),
            }));

        var saved = (McpUserOverridesSaved)((OkObjectResult)result).Value!;
        Assert.That(saved.Overrides.Keys, Is.EquivalentTo(new[] { "forms", "cms" }));
        McpProductOverride forms = store.UserOverrides[ann.Key]["forms"];
        Assert.That(forms.DisabledCollections, Is.EqualTo(new[] { "prevalue-source", "data-source" }));
        Assert.That(forms.Level, Is.EqualTo(McpToolLevel.ReadOnly));
        Assert.That(store.UserOverrides[ann.Key]["cms"].DisabledCollections, Is.Empty);
    }

    // Review Focus 5.
    [Test]
    public async Task Put_with_empty_overrides_makes_the_user_follow_defaults()
    {
        McpApiUserInfo ann = ApiUser("ann");
        var store = new FakeToolSettingsStore
        {
            UserOverrides = new() { [ann.Key] = new Dictionary<string, McpProductOverride> { ["forms"] = Override() } },
        };
        McpToolSettingsController controller = Controller(store, directory: new FakeApiUserDirectory(ann));

        IActionResult result = await controller.PutUserToolSettings(ann.Key, new McpUserToolSettingsRequest(new Dictionary<string, McpProductOverrideRequest?>()));

        Assert.That(result, Is.InstanceOf<OkObjectResult>());
        Assert.That(((McpUserOverridesSaved)((OkObjectResult)result).Value!).Overrides, Is.Empty);
        Assert.That(store.UserOverrides, Is.Empty);
        var body = (McpUserToolSettingsResponse)((OkObjectResult)await controller.GetUserToolSettings(ann.Key)).Value!;
        Assert.That(body.Overrides, Is.Empty);
    }

    [Test]
    public async Task Put_user_404_before_validation()
    {
        var store = new FakeToolSettingsStore();

        IActionResult result = await Controller(store, directory: new FakeApiUserDirectory()).PutUserToolSettings(Guid.NewGuid(), new McpUserToolSettingsRequest(null));

        Assert.That(result, Is.InstanceOf<NotFoundResult>());
        Assert.That(store.UserOverrides, Is.Empty);
    }

    private static IEnumerable<TestCaseData> InvalidOverrides()
    {
        const string levelMessage = "forms: level must be \"full\", \"noDestructive\" or \"readOnly\".";
        const string needsMessage = "forms: an override needs disabledCollections and level.";
        yield return new TestCaseData(null, "overrides is required.").SetName("missing overrides");
        yield return new TestCaseData(
            new Dictionary<string, McpProductOverrideRequest?> { ["commerce"] = new([], McpToolLevel.Full) },
            "\"commerce\" is not a product this site detects.").SetName("unknown product");
        yield return new TestCaseData(
            new Dictionary<string, McpProductOverrideRequest?> { ["forms"] = null }, needsMessage).SetName("null entry");
        yield return new TestCaseData(
            new Dictionary<string, McpProductOverrideRequest?> { ["forms"] = new(null, McpToolLevel.Full) }, needsMessage).SetName("null list");
        yield return new TestCaseData(
            new Dictionary<string, McpProductOverrideRequest?> { ["forms"] = new([], "everything") }, levelMessage).SetName("unknown level");
        yield return new TestCaseData(
            new Dictionary<string, McpProductOverrideRequest?> { ["forms"] = new([], null) }, levelMessage).SetName("null level");
        yield return new TestCaseData(
            new Dictionary<string, McpProductOverrideRequest?> { ["forms"] = new([new string('x', McpToolSettingsValidation.MaxNameLength + 1)], McpToolLevel.Full) },
            $"forms: Collection names must be at most {McpToolSettingsValidation.MaxNameLength} characters.").SetName("long name");
        yield return new TestCaseData(
            new Dictionary<string, McpProductOverrideRequest?> { ["forms"] = new(Enumerable.Range(0, McpToolSettingsValidation.MaxCollections + 1).Select(i => (string?)$"c{i}").ToList(), McpToolLevel.Full) },
            $"forms: At most {McpToolSettingsValidation.MaxCollections} collections are allowed.").SetName("too many collections");
        yield return new TestCaseData(
            Enumerable.Range(0, McpToolSettingsValidation.MaxModules + 1).ToDictionary(i => $"m{i}", _ => (McpProductOverrideRequest?)new([], McpToolLevel.Full)),
            $"At most {McpToolSettingsValidation.MaxModules} modules are allowed.").SetName("too many modules");
    }

    [TestCaseSource(nameof(InvalidOverrides))]
    public async Task Put_user_rejects(IReadOnlyDictionary<string, McpProductOverrideRequest?>? overrides, string message)
    {
        McpApiUserInfo ann = ApiUser("ann");
        var existing = new Dictionary<string, McpProductOverride> { ["cms"] = Override() };
        var store = new FakeToolSettingsStore { UserOverrides = new() { [ann.Key] = existing } };

        IActionResult result = await Controller(store, directory: new FakeApiUserDirectory(ann)).PutUserToolSettings(ann.Key, new McpUserToolSettingsRequest(overrides));

        Assert.That(result, Is.InstanceOf<BadRequestObjectResult>());
        Assert.That(((ProblemDetails)((BadRequestObjectResult)result).Value!).Detail, Is.EqualTo(message));
        Assert.That(store.UserOverrides[ann.Key], Is.SameAs(existing));
    }

    [Test]
    public void Post_catalogue_stores_the_report_for_the_caller_and_merges_the_shared_row()
    {
        var store = new FakeToolSettingsStore();
        IUser api = User(UserKind.Api);
        DateTimeOffset before = DateTimeOffset.UtcNow;

        IActionResult result = Controller(store, api).PostCatalogue(Report());

        Assert.That(result, Is.InstanceOf<NoContentResult>());
        Assert.That(store.Merged, Has.Count.EqualTo(1));
        McpToolCatalogue own = store.UserCatalogues[api.Key];
        Assert.That(own.Modules["forms"].Collections.Single(), Is.EqualTo(new McpCollectionInfo("prevalue-source", 10)));
        Assert.That(own.Modules["forms"].ReportedAt, Is.InRange(before, DateTimeOffset.UtcNow));
    }
}
