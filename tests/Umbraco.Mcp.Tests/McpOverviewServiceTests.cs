using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.Overview;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpOverviewServiceTests
{
    private const string Addon = "17.0.0";

    private static readonly DateTimeOffset Reported = new(2026, 10, 12, 8, 46, 0, TimeSpan.Zero);

    private static readonly Dictionary<string, string?> Sections = new()
    {
        ["cms"] = null,
        ["forms"] = "Umb.Section.Forms",
        ["automate"] = "Ua.Section.Automate",
    };

    private sealed class StubCapabilities(McpCapabilities caps, Dictionary<Guid, McpCapabilities>? perUser = null) : IMcpCapabilitiesService
    {
        public McpCapabilities GetCapabilities(Guid? apiUserKey = null) =>
            apiUserKey is { } key && perUser is not null && perUser.TryGetValue(key, out McpCapabilities? own) ? own : caps;
    }

    private sealed class StubDetector(string id, string? section) : IMcpProductDetector
    {
        public string Id => id;

        public string DisplayName => id;

        public string? SectionAlias => section;

        public McpProductStatus Detect() => throw new NotSupportedException();
    }

    private static McpProductStatus Product(string id, string name, bool installed = true, bool enabled = true, params string[] issues) =>
        new(id, name, installed, enabled, "17.0.0", issues);

    private static readonly McpProductStatus[] AllProducts =
    [
        Product("cms", "Umbraco CMS"),
        Product("forms", "Umbraco Forms"),
        Product("automate", "Umbraco Automate"),
    ];

    private static McpApiUser User(UserState state = UserState.Active, params string[] sections) =>
        new(Guid.NewGuid(), "MCP API user", state, sections, ["umbraco-back-office-mcp"], Reported);

    private static McpApiUser NamedUser(string name) =>
        new(Guid.NewGuid(), name, UserState.Active, ["Umb.Section.Forms", "Ua.Section.Automate"], ["umbraco-back-office-mcp"], Reported);

    private static McpToolCatalogue OwnCatalogue(string version, DateTimeOffset at, params (string Id, int Tools)[] modules) =>
        new(version, modules.ToDictionary(m => m.Id, m => new McpModuleCatalogue(at, false, [new McpCollectionInfo("a", m.Tools)])));

    private static McpToolCatalogue Catalogue(string? version = Addon, params (string Id, int Tools)[] modules) =>
        new(version, modules.ToDictionary(
            m => m.Id,
            m => new McpModuleCatalogue(Reported, false, [new McpCollectionInfo("a", m.Tools)])));

    private static IReadOnlyList<McpFinding> Findings(
        McpCapabilities? caps = null,
        McpToolCatalogue? catalogue = null,
        IReadOnlyList<McpApiUser>? users = null) =>
        McpOverviewService.BuildFindings(
            caps ?? new McpCapabilities(Addon, AllProducts),
            catalogue ?? Catalogue(Addon, ("cms", 1)),
            users ?? [User(UserState.Active, "Umb.Section.Forms", "Ua.Section.Automate")],
            Sections,
            Addon);

    private static McpOverviewService Service(
        IMcpToolSettingsStore? settings = null,
        IMcpApiUserProvider? users = null,
        IMcpCapabilitiesService? caps = null,
        FakeMcpJsonFile? json = null) =>
        new(
            caps ?? new StubCapabilities(new McpCapabilities(Addon, AllProducts)),
            settings ?? new FakeToolSettingsStore { Catalogue = Catalogue(Addon, ("cms", 1)) },
            users ?? new FakeApiUserProvider(User(UserState.Active, "Umb.Section.Forms", "Ua.Section.Automate")),
            Sections.Select(s => (IMcpProductDetector)new StubDetector(s.Key, s.Value)).ToList(),
            json ?? new FakeMcpJsonFile(),
            new ConfigurationBuilder().Build(),
            NullLogger<McpOverviewService>.Instance);

    [Test]
    public void No_problems_gives_no_warnings()
    {
        Assert.That(Findings(), Is.Empty);
    }

    [Test]
    public void Product_with_issues_is_a_products_warning()
    {
        var caps = new McpCapabilities(Addon, [Product("forms", "Umbraco Forms", true, true, "First issue.", "Second issue.")]);

        McpFinding finding = Findings(caps).Single();

        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Warning));
        Assert.That(finding.Area, Is.EqualTo(McpFindingArea.Products));
        Assert.That(finding.Message, Is.EqualTo("Umbraco Forms 17.0.0: First issue. Second issue."));
    }

    [Test]
    public void Installed_product_without_api_is_a_products_warning()
    {
        var caps = new McpCapabilities(Addon, [Product("forms", "Umbraco Forms", true, false)]);

        McpFinding finding = Findings(caps).Single();

        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Warning));
        Assert.That(finding.Message, Is.EqualTo("Umbraco Forms 17.0.0: Installed, but its API is not available."));
    }

    [Test]
    public void No_report_is_a_server_info()
    {
        McpFinding finding = Findings(catalogue: McpToolCatalogue.Empty).Single();

        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Info));
        Assert.That(finding.Area, Is.EqualTo(McpFindingArea.Server));
        Assert.That(finding.Message, Is.EqualTo("The MCP server has not reported to this site yet. It reports when your AI tool starts it."));
    }

    [Test]
    public void Other_mcp_version_is_a_server_warning_with_the_version_to_run()
    {
        McpFinding finding = Findings(catalogue: Catalogue("16.9.0", ("cms", 5))).Single();

        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Warning));
        Assert.That(finding.Area, Is.EqualTo(McpFindingArea.Server));
        Assert.That(finding.Message, Is.EqualTo(
            "The MCP server last started as umbrella-mcp 16.9.0 on 12-10-2026 08:46 UTC, but the add-on is 17.0.0. " +
            "The two are released together: set umbrella-mcp@17.0.0 in your AI tool's MCP configuration. " +
            "A .mcp.json the site wrote and nobody edited is upgraded when the site next starts in Development."));
    }

    [Test]
    public void No_users_is_an_api_users_info()
    {
        McpFinding finding = Findings(users: []).Single();

        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Info));
        Assert.That(finding.Area, Is.EqualTo(McpFindingArea.ApiUsers));
        Assert.That(finding.Message, Is.EqualTo(
            "No MCP server has connected to this site yet. The MCP server connects when your AI tool starts it; start it, then check again."));
    }

    [Test]
    public void Locked_out_user_is_a_warning()
    {
        McpFinding finding = Findings(users: [User(UserState.LockedOut, "Umb.Section.Forms", "Ua.Section.Automate")]).Single();

        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Warning));
        Assert.That(finding.Area, Is.EqualTo(McpFindingArea.ApiUsers));
        Assert.That(finding.Message, Is.EqualTo(
            "The API user \"MCP API user\" (umbraco-back-office-mcp) is locked out, so the MCP server can no longer sign in with it."));
    }

    [Test]
    public void Missing_section_is_a_warning_naming_the_section()
    {
        McpFinding finding = Findings(users: [User(UserState.Active, "Ua.Section.Automate")]).Single();

        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Warning));
        Assert.That(finding.Message, Is.EqualTo(
            "The API user \"MCP API user\" cannot use Umbraco Forms tools: none of its user groups grant the Umb.Section.Forms section."));
    }

    [Test]
    public void Warnings_come_before_info_in_area_order()
    {
        var caps = new McpCapabilities(Addon, [Product("forms", "Umbraco Forms", true, false)]);

        IReadOnlyList<McpFinding> findings = Findings(caps, McpToolCatalogue.Empty, []);

        Assert.That(
            findings.Select(f => (f.Severity, f.Area)),
            Is.EqualTo(new[]
            {
                (McpFinding.Warning, McpFindingArea.Products),
                (McpFinding.Info, McpFindingArea.Server),
                (McpFinding.Info, McpFindingArea.ApiUsers),
            }));
    }

    [Test]
    public async Task Catalogue_failure_is_an_info_finding_and_the_rest_still_builds()
    {
        var service = Service(settings: new FakeToolSettingsStore { Throws = new InvalidOperationException("boom") });

        McpOverview overview = await service.GetOverviewAsync(null);

        Assert.That(overview.Products, Has.Count.EqualTo(3));
        Assert.That(overview.ApiUsers, Has.Count.EqualTo(1));
        Assert.That(overview.Server, Is.Null);
        McpFinding finding = overview.Findings.Single();
        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Info));
        Assert.That(finding.Area, Is.EqualTo(McpFindingArea.Server));
    }

    [Test]
    public async Task Api_user_failure_is_an_info_finding()
    {
        var service = Service(users: new FakeApiUserProvider { Throws = new InvalidOperationException("boom") });

        McpOverview overview = await service.GetOverviewAsync(null);

        Assert.That(overview.ApiUsers, Is.Empty);
        McpFinding finding = overview.Findings.Single();
        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Info));
        Assert.That(finding.Area, Is.EqualTo(McpFindingArea.ApiUsers));
        Assert.That(finding.Message, Is.EqualTo("Could not read the API users the MCP server connected as. See the log."));
    }

    [Test]
    public async Task Access_follows_the_level()
    {
        McpProductStatus[] products =
        [
            Product("cms", "Umbraco CMS") with { ReadOnly = true, NoDestructive = true },
            Product("forms", "Umbraco Forms") with { NoDestructive = true },
            Product("automate", "Umbraco Automate"),
        ];
        var service = Service(caps: new StubCapabilities(new McpCapabilities(Addon, products)));

        McpOverview overview = await service.GetOverviewAsync(null);

        Assert.That(overview.Products.Single(p => p.Id == "cms").Access, Is.EqualTo("readOnly"));
        Assert.That(overview.Products.Single(p => p.Id == "forms").Access, Is.EqualTo("noDestructive"));
        Assert.That(overview.Products.Single(p => p.Id == "automate").Access, Is.EqualTo("full"));
    }

    [Test]
    public async Task Module_missing_from_the_latest_report_is_not_loaded()
    {
        var catalogue = new McpToolCatalogue(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["forms"] = new(Reported.AddHours(-1), false, [new McpCollectionInfo("a", 4)]),
            ["cms"] = new(Reported, false, [new McpCollectionInfo("a", 7)]),
        });
        var service = Service(settings: new FakeToolSettingsStore { Catalogue = catalogue });

        McpOverview overview = await service.GetOverviewAsync(null);

        McpOverviewProduct forms = overview.Products.Single(p => p.Id == "forms");
        Assert.That(forms.Loaded, Is.False);
        Assert.That(forms.ToolCount, Is.EqualTo(0));
        McpOverviewProduct cms = overview.Products.Single(p => p.Id == "cms");
        Assert.That(cms.Loaded, Is.True);
        Assert.That(cms.ToolCount, Is.EqualTo(7));
    }

    [Test]
    public async Task Version_without_modules_counts_as_no_report()
    {
        var service = Service(settings: new FakeToolSettingsStore { Catalogue = Catalogue(Addon) });

        McpOverview overview = await service.GetOverviewAsync(null);

        Assert.That(overview.Server, Is.Null);
        McpFinding finding = overview.Findings.Single();
        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Info));
        Assert.That(finding.Message, Is.EqualTo("The MCP server has not reported to this site yet. It reports when your AI tool starts it."));
    }

    [Test]
    public async Task Product_tool_count_sums_the_reported_collections()
    {
        var catalogue = new McpToolCatalogue(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["forms"] = new(Reported, false, [new McpCollectionInfo("a", 4), new McpCollectionInfo("b", 6)]),
        });
        var service = Service(settings: new FakeToolSettingsStore { Catalogue = catalogue });

        McpOverview overview = await service.GetOverviewAsync(null);

        McpOverviewProduct forms = overview.Products.Single(p => p.Id == "forms");
        Assert.That(forms.Loaded, Is.True);
        Assert.That(forms.ToolCount, Is.EqualTo(10));
        McpOverviewProduct automate = overview.Products.Single(p => p.Id == "automate");
        Assert.That(automate.Loaded, Is.False);
        Assert.That(automate.ToolCount, Is.EqualTo(0));
    }

    [Test]
    public async Task Server_report_uses_the_latest_module_time()
    {
        var catalogue = new McpToolCatalogue(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["cms"] = new(Reported.AddHours(-2), false, []),
            ["forms"] = new(Reported, false, []),
        });
        var service = Service(settings: new FakeToolSettingsStore { Catalogue = catalogue });

        McpOverview overview = await service.GetOverviewAsync(null);

        Assert.That(overview.Server, Is.EqualTo(new McpServerReport(Addon, Reported, true)));
    }

    [Test]
    public async Task Api_user_state_and_reach()
    {
        var service = Service(users: new FakeApiUserProvider(User(UserState.LockedOut, "Ua.Section.Automate")));

        McpOverview overview = await service.GetOverviewAsync(null);

        McpOverviewApiUser user = overview.ApiUsers.Single();
        Assert.That(user.State, Is.EqualTo("lockedOut"));
        Assert.That(user.Reachable, Is.EqualTo(new[] { "Umbraco Automate" }));
        Assert.That(user.Unreachable, Is.EqualTo(new[] { "Umbraco Forms" }));
    }

    [Test]
    public async Task Overview_without_a_site_url_still_builds()
    {
        McpOverview overview = await Service().GetOverviewAsync(null);

        Assert.That(overview.AddonVersion, Is.EqualTo(Addon));
        Assert.That(overview.Clients, Has.Count.EqualTo(5));
        Assert.That(overview.Clients.Select(c => c.Content), Has.All.Contain("https://your-site"));
    }

    [Test]
    public async Task Mcp_json_status_comes_from_the_file_service()
    {
        var service = Service(json: new FakeMcpJsonFile(true, "C:/site/.mcp.json"));

        McpOverview overview = await service.GetOverviewAsync(null);

        Assert.That(overview.McpJson, Is.EqualTo(new McpJsonStatus(true, "C:/site/.mcp.json")));
    }

    [Test]
    public async Task User_row_shows_its_own_report_and_access()
    {
        McpApiUser user = NamedUser("Anna");
        McpProductStatus[] own =
        [
            Product("cms", "Umbraco CMS"),
            Product("forms", "Umbraco Forms") with { ReadOnly = true, SettingsScope = McpSettingsScope.User },
            Product("automate", "Umbraco Automate", installed: false, enabled: false),
        ];
        var catalogue = new McpToolCatalogue(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["cms"] = new(Reported, false, [new McpCollectionInfo("a", 3)]),
            ["forms"] = new(Reported, false, [new McpCollectionInfo("a", 4, 1), new McpCollectionInfo("b", 6, 2)]),
        });
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = { [user.Key] = catalogue } },
            users: new FakeApiUserProvider(user),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [user.Key] = new McpCapabilities(Addon, own) }));

        McpOverviewApiUser row = (await service.GetOverviewAsync(null)).ApiUsers.Single();

        Assert.That(row.ServerVersion, Is.EqualTo(Addon));
        Assert.That(row.LastReportedAt, Is.EqualTo(Reported));
        Assert.That(row.ToolCount, Is.EqualTo(6));
        Assert.That(row.Access, Is.EqualTo(new[]
        {
            new McpOverviewAccess("cms", "Umbraco CMS", "full", "site", 3),
            new McpOverviewAccess("forms", "Umbraco Forms", "readOnly", "user", 3),
        }));
    }

    [Test]
    public async Task User_tool_counts_leave_out_switched_off_groups_and_count_unloaded_products_as_none()
    {
        McpApiUser user = NamedUser("Anna");
        McpProductStatus[] own =
        [
            Product("cms", "Umbraco CMS") with { DisabledCollections = ["b"] },
            Product("forms", "Umbraco Forms"),
            Product("automate", "Umbraco Automate"),
        ];
        var catalogue = new McpToolCatalogue(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["cms"] = new(Reported, false, [new McpCollectionInfo("a", 3), new McpCollectionInfo("b", 5)]),
            ["forms"] = new(Reported, false, [new McpCollectionInfo("a", 4)]),
        });
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = { [user.Key] = catalogue } },
            users: new FakeApiUserProvider(user),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [user.Key] = new McpCapabilities(Addon, own) }));

        McpOverviewApiUser row = (await service.GetOverviewAsync(null)).ApiUsers.Single();

        Assert.That(row.Access.Select(a => a.ToolCount), Is.EqualTo(new int?[] { 3, 4, 0 }));
        Assert.That(row.ToolCount, Is.EqualTo(7));
    }

    [Test]
    public async Task User_tool_counts_are_unknown_where_the_server_environment_sets_its_own_filters()
    {
        McpApiUser user = NamedUser("Anna");
        var catalogue = new McpToolCatalogue(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["cms"] = new(Reported, false, [new McpCollectionInfo("a", 3)]),
            ["forms"] = new(Reported, true, [new McpCollectionInfo("a", 4)]),
        });
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = { [user.Key] = catalogue } },
            users: new FakeApiUserProvider(user));

        McpOverviewApiUser row = (await service.GetOverviewAsync(null)).ApiUsers.Single();

        Assert.That(row.Access.Single(a => a.ProductId == "forms").ToolCount, Is.Null);
        Assert.That(row.Access.Single(a => a.ProductId == "cms").ToolCount, Is.EqualTo(3));
        Assert.That(row.ToolCount, Is.Null);
    }

    [Test]
    public async Task User_without_own_report_has_null_report_fields()
    {
        McpApiUser user = NamedUser("Anna");
        var service = Service(users: new FakeApiUserProvider(user));

        McpOverviewApiUser row = (await service.GetOverviewAsync(null)).ApiUsers.Single();

        Assert.That(row.ServerVersion, Is.Null);
        Assert.That(row.LastReportedAt, Is.Null);
        Assert.That(row.ToolCount, Is.Null);
        Assert.That(row.Access.Select(a => a.ProductId), Is.EqualTo(new[] { "cms", "forms", "automate" }));
        Assert.That(row.Access.Select(a => a.ToolCount), Has.All.Null);
    }

    [Test]
    public async Task Version_warning_per_user()
    {
        McpApiUser anna = NamedUser("Anna");
        McpApiUser ben = NamedUser("Ben");
        var service = Service(
            settings: new FakeToolSettingsStore
            {
                Catalogue = Catalogue(Addon, ("cms", 1)),
                UserCatalogues =
                {
                    [anna.Key] = OwnCatalogue("16.9.0", Reported, ("cms", 5)),
                    [ben.Key] = OwnCatalogue(Addon, Reported, ("cms", 5)),
                },
            },
            users: new FakeApiUserProvider(anna, ben));

        McpOverview overview = await service.GetOverviewAsync(null);

        McpFinding finding = overview.Findings.Single(f => f.Area == McpFindingArea.Server);
        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Warning));
        Assert.That(finding.Message, Is.EqualTo(
            "\"Anna\" last started umbrella-mcp 16.9.0 on 12-10-2026 08:46 UTC, but the add-on is 17.0.0. " +
            "The two are released together: set umbrella-mcp@17.0.0 in your AI tool's MCP configuration. " +
            "A .mcp.json the site wrote and nobody edited is upgraded when the site next starts in Development."));
    }

    [Test]
    public async Task Shared_row_finding_when_no_user_has_its_own_report()
    {
        var service = Service(settings: new FakeToolSettingsStore { Catalogue = Catalogue("16.9.0", ("cms", 5)) });

        McpOverview overview = await service.GetOverviewAsync(null);

        McpFinding finding = overview.Findings.Single(f => f.Area == McpFindingArea.Server);
        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Warning));
        Assert.That(finding.Message, Does.StartWith("The MCP server last started as umbrella-mcp 16.9.0 on 12-10-2026 08:46 UTC"));
    }

    [Test]
    public async Task Loaded_when_any_connected_user_loaded_it()
    {
        McpApiUser a = NamedUser("Anna");
        McpApiUser b = NamedUser("Ben");
        var service = Service(
            settings: new FakeToolSettingsStore
            {
                UserCatalogues =
                {
                    [a.Key] = OwnCatalogue(Addon, Reported, ("cms", 1), ("forms", 4)),
                    [b.Key] = OwnCatalogue(Addon, Reported.AddHours(1), ("cms", 9)),
                },
            },
            users: new FakeApiUserProvider(a, b));

        McpOverview overview = await service.GetOverviewAsync(null);

        McpOverviewProduct forms = overview.Products.Single(p => p.Id == "forms");
        Assert.That(forms.Loaded, Is.True);
        Assert.That(forms.ToolCount, Is.EqualTo(4));
        McpOverviewProduct cms = overview.Products.Single(p => p.Id == "cms");
        Assert.That(cms.Loaded, Is.True);
        Assert.That(cms.ToolCount, Is.EqualTo(9));
        Assert.That(overview.Products.Single(p => p.Id == "automate").Loaded, Is.False);
    }

    [Test]
    public async Task Overview_survives_a_failing_per_user_read()
    {
        McpApiUser anna = NamedUser("Anna");
        var service = Service(
            settings: new FakeToolSettingsStore
            {
                Catalogue = Catalogue("16.9.0", ("cms", 5)),
                UserReadsThrow = new InvalidOperationException("boom"),
            },
            users: new FakeApiUserProvider(anna));

        McpOverview overview = await service.GetOverviewAsync(null);

        McpOverviewApiUser row = overview.ApiUsers.Single();
        Assert.That(row.ServerVersion, Is.Null);
        Assert.That(row.ToolCount, Is.Null);
        McpOverviewProduct cms = overview.Products.Single(p => p.Id == "cms");
        Assert.That(cms.Loaded, Is.True);
        Assert.That(cms.ToolCount, Is.EqualTo(5));
        McpFinding finding = overview.Findings.Single(f => f.Area == McpFindingArea.Server);
        Assert.That(finding.Message, Does.StartWith("The MCP server last started as umbrella-mcp 16.9.0"));
    }
}
