using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Connections;
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
        public McpCapabilities GetCapabilities(Guid? apiUserKey = null, IReadOnlyCollection<string>? allowedSections = null) =>
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
        new(version, modules.ToDictionary(m => m.Id, m => new McpModuleCatalogue(at, [new McpCollectionInfo("a", m.Tools)])));

    private static McpToolCatalogue Catalogue(string? version = Addon, params (string Id, int Tools)[] modules) =>
        new(version, modules.ToDictionary(
            m => m.Id,
            m => new McpModuleCatalogue(Reported, [new McpCollectionInfo("a", m.Tools)])));

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
        IMcpCreatedUserStore? created = null,
        IMcpApiUserDirectory? directory = null) =>
        new(
            caps ?? new StubCapabilities(new McpCapabilities(Addon, AllProducts)),
            settings ?? new FakeToolSettingsStore { Catalogue = Catalogue(Addon, ("cms", 1)) },
            users ?? new FakeApiUserProvider(User(UserState.Active, "Umb.Section.Forms", "Ua.Section.Automate")),
            created ?? new FakeCreatedUserStore(),
            directory ?? new FakeApiUserDirectory(),
            Sections.Select(s => (IMcpProductDetector)new StubDetector(s.Key, s.Value)).ToList(),
            NullLogger<McpOverviewService>.Instance);

    private static McpApiUserInfo Info(string name, UserState state = UserState.Active) =>
        new(Guid.NewGuid(), name, state, [$"umbraco-back-office-{name.ToLowerInvariant()}"], ["Umb.Section.Forms"], ["Form managers", "Editors"]);

    private static FakeCreatedUserStore CreatedStore(params McpApiUserInfo[] users)
    {
        var store = new FakeCreatedUserStore();
        foreach (McpApiUserInfo u in users)
        {
            store.Record(u.Key, Reported);
        }

        return store;
    }

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
    public void Other_mcp_version_is_a_server_note_with_the_version_to_run()
    {
        McpFinding finding = Findings(catalogue: Catalogue("16.9.0", ("cms", 5))).Single();

        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Info));
        Assert.That(finding.Area, Is.EqualTo(McpFindingArea.Server));
        Assert.That(finding.Message, Is.EqualTo(
            "The MCP server last started as umbrella-mcp 16.9.0 on 12-10-2026 08:46 UTC. " +
            "Set umbrella-mcp@17.0.0, the add-on's version, in the AI tool's MCP configuration."));
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
    public void Missing_section_is_not_a_finding()
    {
        Assert.That(Findings(users: [User(UserState.Active, "Ua.Section.Automate")]), Is.Empty);
    }

    [Test]
    public async Task Reach_lists_leave_out_a_product_off_for_that_user()
    {
        McpApiUser anna = new(Guid.NewGuid(), "Anna", UserState.Active, ["Ua.Section.Automate"], ["a"], Reported);
        McpProductStatus[] annaOwn = AllProducts.Select(p => p.Id == "forms" ? p with { Off = true, SettingsScope = McpSettingsScope.User } : p).ToArray();
        var service = Service(
            users: new FakeApiUserProvider(anna),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [anna.Key] = new McpCapabilities(Addon, annaOwn) }));

        McpOverviewApiUser row = (await service.GetOverviewAsync()).ApiUsers.Single();

        Assert.That(row.Reachable, Is.EqualTo(new[] { "Umbraco Automate" }));
        Assert.That(row.Unreachable, Is.Empty);
    }

    [Test]
    public async Task Access_level_is_off_with_no_tools()
    {
        McpApiUser user = NamedUser("Anna");
        McpProductStatus[] own = AllProducts.Select(p => p.Id == "forms" ? p with { Off = true, ReadOnly = false, SettingsScope = McpSettingsScope.User } : p).ToArray();
        var catalogue = new McpToolCatalogue(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["cms"] = new(Reported, [new McpCollectionInfo("a", 3)]),
            ["forms"] = new(Reported, [new McpCollectionInfo("a", 4)]),
        });
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = { [user.Key] = catalogue } },
            users: new FakeApiUserProvider(user),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [user.Key] = new McpCapabilities(Addon, own) }));

        McpOverviewAccess forms = (await service.GetOverviewAsync()).ApiUsers.Single().Access.Single(a => a.ProductId == "forms");

        Assert.That(forms.Level, Is.EqualTo("off"));
        Assert.That(forms.ToolCount, Is.EqualTo(0));
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

        McpOverview overview = await service.GetOverviewAsync();

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

        McpOverview overview = await service.GetOverviewAsync();

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

        McpOverview overview = await service.GetOverviewAsync();

        Assert.That(overview.Products.Single(p => p.Id == "cms").Access, Is.EqualTo("readOnly"));
        Assert.That(overview.Products.Single(p => p.Id == "forms").Access, Is.EqualTo("noDestructive"));
        Assert.That(overview.Products.Single(p => p.Id == "automate").Access, Is.EqualTo("full"));
    }

    [Test]
    public async Task Version_without_modules_counts_as_no_report()
    {
        var service = Service(settings: new FakeToolSettingsStore { Catalogue = Catalogue(Addon) });

        McpOverview overview = await service.GetOverviewAsync();

        Assert.That(overview.Server, Is.Null);
        McpFinding finding = overview.Findings.Single();
        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Info));
        Assert.That(finding.Message, Is.EqualTo("The MCP server has not reported to this site yet. It reports when your AI tool starts it."));
    }

    [Test]
    public async Task Server_report_uses_the_latest_module_time()
    {
        var catalogue = new McpToolCatalogue(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["cms"] = new(Reported.AddHours(-2), []),
            ["forms"] = new(Reported, []),
        });
        var service = Service(settings: new FakeToolSettingsStore { Catalogue = catalogue });

        McpOverview overview = await service.GetOverviewAsync();

        Assert.That(overview.Server, Is.EqualTo(new McpServerReport(Addon, Reported, true)));
    }

    [Test]
    public async Task Api_user_state_and_reach()
    {
        var service = Service(users: new FakeApiUserProvider(User(UserState.LockedOut, "Ua.Section.Automate")));

        McpOverview overview = await service.GetOverviewAsync();

        McpOverviewApiUser user = overview.ApiUsers.Single();
        Assert.That(user.State, Is.EqualTo("lockedOut"));
        Assert.That(user.Reachable, Is.EqualTo(new[] { "Umbraco Automate" }));
        Assert.That(user.Unreachable, Is.EqualTo(new[] { "Umbraco Forms" }));
    }

    [Test]
    public async Task Overview_has_the_addon_version()
    {
        McpOverview overview = await Service().GetOverviewAsync();

        Assert.That(overview.AddonVersion, Is.EqualTo(Addon));
    }

    [Test]
    public async Task User_row_lists_its_user_groups_sorted()
    {
        McpApiUser user = NamedUser("Anna") with { Groups = ["Sensitive data", "Administrators", "editors"] };
        var service = Service(users: new FakeApiUserProvider(user));

        McpOverviewApiUser row = (await service.GetOverviewAsync()).ApiUsers.Single();

        Assert.That(row.Groups, Is.EqualTo(new[] { "Administrators", "editors", "Sensitive data" }));
    }

    [Test]
    public async Task User_row_without_read_groups_lists_none()
    {
        var service = Service(users: new FakeApiUserProvider(NamedUser("Anna")));

        McpOverviewApiUser row = (await service.GetOverviewAsync()).ApiUsers.Single();

        Assert.That(row.Groups, Is.Empty);
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
            ["cms"] = new(Reported, [new McpCollectionInfo("a", 3)]),
            ["forms"] = new(Reported, [new McpCollectionInfo("a", 4, 1), new McpCollectionInfo("b", 6, 2)]),
        });
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = { [user.Key] = catalogue } },
            users: new FakeApiUserProvider(user),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [user.Key] = new McpCapabilities(Addon, own) }));

        McpOverviewApiUser row = (await service.GetOverviewAsync()).ApiUsers.Single();

        Assert.That(row.ServerVersion, Is.EqualTo(Addon));
        Assert.That(row.LastReportedAt, Is.EqualTo(Reported));
        Assert.That(row.ToolCount, Is.EqualTo(6));
        Assert.That(row.Access, Is.EqualTo(new[]
        {
            new McpOverviewAccess("cms", "Umbraco CMS", "full", "site", 3, true),
            new McpOverviewAccess("forms", "Umbraco Forms", "readOnly", "user", 3, true),
        }));
    }

    [Test]
    public async Task User_without_a_section_gets_no_tools_from_that_product()
    {
        McpApiUser user = new(Guid.NewGuid(), "Editor", UserState.Active, ["Umb.Section.Forms"], ["e"], Reported);
        // An older umbrella-mcp still loaded Automate; its API refuses the tools all the same.
        var catalogue = new McpToolCatalogue(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["cms"] = new(Reported, [new McpCollectionInfo("a", 3)]),
            ["forms"] = new(Reported, [new McpCollectionInfo("a", 4)]),
            ["automate"] = new(Reported, [new McpCollectionInfo("a", 9)]),
        });
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = { [user.Key] = catalogue } },
            users: new FakeApiUserProvider(user),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [user.Key] = new McpCapabilities(Addon, AllProducts) }));

        McpOverview overview = await service.GetOverviewAsync();

        McpOverviewApiUser row = overview.ApiUsers.Single();
        Assert.That(row.Access.Single(a => a.ProductId == "automate"),
            Is.EqualTo(new McpOverviewAccess("automate", "Umbraco Automate", "full", "site", 0, false, SizeBytes: 0)));
        Assert.That(row.Access.Single(a => a.ProductId == "forms").SectionAccess, Is.True);
        Assert.That(row.ToolCount, Is.EqualTo(7));
        Assert.That(row.SizeBytes, Is.Null);
        Assert.That(overview.Findings.Where(f => f.Severity == McpFinding.Warning), Is.Empty);
    }

    [Test]
    public async Task User_sizes_sum_the_effective_bytes_when_every_product_reports_them()
    {
        McpApiUser user = NamedUser("Anna");
        McpProductStatus[] own =
        [
            Product("cms", "Umbraco CMS") with { DisabledCollections = ["b"], DisabledTools = ["t2"] },
            Product("forms", "Umbraco Forms") with { ReadOnly = true },
            Product("automate", "Umbraco Automate") with { Off = true },
        ];
        var catalogue = new McpToolCatalogue(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["cms"] = new(Reported,
            [
                new McpCollectionInfo("a", 2, Tools:
                [
                    new McpToolInfo("t1", null, true, false, SizeBytes: 1200),
                    new McpToolInfo("t2", null, false, false, SizeBytes: 800),
                ], SizeBytes: 2000),
                new McpCollectionInfo("b", 1, SizeBytes: 5000),
            ]),
            ["forms"] = new(Reported, [new McpCollectionInfo("a", 4, ReadOnlyToolCount: 2, SizeBytes: 4000, ReadOnlySizeBytes: 1500)]),
        });
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = { [user.Key] = catalogue } },
            users: new FakeApiUserProvider(user),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [user.Key] = new McpCapabilities(Addon, own) }));

        McpOverviewApiUser row = (await service.GetOverviewAsync()).ApiUsers.Single();

        Assert.That(row.Access.Select(a => a.SizeBytes), Is.EqualTo(new int?[] { 1200, 1500, 0 }));
        Assert.That(row.SizeBytes, Is.EqualTo(2700));
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
            ["cms"] = new(Reported, [new McpCollectionInfo("a", 3), new McpCollectionInfo("b", 5)]),
            ["forms"] = new(Reported, [new McpCollectionInfo("a", 4)]),
        });
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = { [user.Key] = catalogue } },
            users: new FakeApiUserProvider(user),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [user.Key] = new McpCapabilities(Addon, own) }));

        McpOverviewApiUser row = (await service.GetOverviewAsync()).ApiUsers.Single();

        Assert.That(row.Access.Select(a => a.ToolCount), Is.EqualTo(new int?[] { 3, 4, 0 }));
        Assert.That(row.ToolCount, Is.EqualTo(7));
    }

    [Test]
    public async Task User_without_own_report_has_null_report_fields()
    {
        McpApiUser user = NamedUser("Anna");
        var service = Service(users: new FakeApiUserProvider(user));

        McpOverviewApiUser row = (await service.GetOverviewAsync()).ApiUsers.Single();

        Assert.That(row.ServerVersion, Is.Null);
        Assert.That(row.LastReportedAt, Is.Null);
        Assert.That(row.ToolCount, Is.Null);
        Assert.That(row.Access.Select(a => a.ProductId), Is.EqualTo(new[] { "cms", "forms", "automate" }));
        Assert.That(row.Access.Select(a => a.ToolCount), Has.All.Null);
    }

    [Test]
    public async Task Version_note_per_older_version_naming_its_users()
    {
        McpApiUser anna = NamedUser("Anna");
        McpApiUser ben = NamedUser("Ben");
        McpApiUser cleo = NamedUser("Cleo");
        McpApiUser dan = NamedUser("Dan");
        var service = Service(
            settings: new FakeToolSettingsStore
            {
                Catalogue = Catalogue(Addon, ("cms", 1)),
                UserCatalogues =
                {
                    [anna.Key] = OwnCatalogue("16.9.0", Reported, ("cms", 5)),
                    [ben.Key] = OwnCatalogue(Addon, Reported, ("cms", 5)),
                    [cleo.Key] = OwnCatalogue("16.8.0", Reported, ("cms", 5)),
                    [dan.Key] = OwnCatalogue("16.9.0", Reported.AddHours(1), ("cms", 5)),
                },
            },
            users: new FakeApiUserProvider(anna, ben, cleo, dan));

        McpOverview overview = await service.GetOverviewAsync();

        Assert.That(overview.Findings.Where(f => f.Area == McpFindingArea.Server).Select(f => (f.Severity, f.Message)), Is.EqualTo(new[]
        {
            (McpFinding.Info, "\"Anna\" and \"Dan\" last started umbrella-mcp 16.9.0. Set umbrella-mcp@17.0.0, the add-on's version, in the AI tool's MCP configuration."),
            (McpFinding.Info, "\"Cleo\" last started umbrella-mcp 16.8.0. Set umbrella-mcp@17.0.0, the add-on's version, in the AI tool's MCP configuration."),
        }));
    }

    [Test]
    public async Task Shared_row_finding_when_no_user_has_its_own_report()
    {
        var service = Service(settings: new FakeToolSettingsStore { Catalogue = Catalogue("16.9.0", ("cms", 5)) });

        McpOverview overview = await service.GetOverviewAsync();

        McpFinding finding = overview.Findings.Single(f => f.Area == McpFindingArea.Server);
        Assert.That(finding.Severity, Is.EqualTo(McpFinding.Info));
        Assert.That(finding.Message, Does.StartWith("The MCP server last started as umbrella-mcp 16.9.0 on 12-10-2026 08:46 UTC"));
    }

    [Test]
    public async Task Product_a_connected_server_did_not_load_is_a_products_warning()
    {
        McpApiUser anna = NamedUser("Anna");
        McpApiUser ben = NamedUser("Ben");
        var service = Service(
            settings: new FakeToolSettingsStore
            {
                UserCatalogues =
                {
                    [anna.Key] = OwnCatalogue(Addon, Reported, ("cms", 1), ("forms", 4)),
                    [ben.Key] = OwnCatalogue(Addon, Reported.AddHours(1), ("cms", 9)),
                },
            },
            users: new FakeApiUserProvider(anna, ben));

        McpOverview overview = await service.GetOverviewAsync();

        Assert.That(overview.Findings.Where(f => f.Area == McpFindingArea.Products).Select(f => (f.Severity, f.Message)), Is.EqualTo(new[]
        {
            (McpFinding.Warning, "Umbraco Forms 17.0.0: installed, but not loaded when \"Ben\" last started umbrella-mcp. Its get-mcp-health tool says why."),
            (McpFinding.Warning, "Umbraco Automate 17.0.0: installed, but not loaded when \"Anna\" and \"Ben\" last started umbrella-mcp. Its get-mcp-health tool says why."),
        }));
    }

    [Test]
    public async Task No_load_warning_for_a_product_off_for_the_user_or_without_its_section()
    {
        McpApiUser anna = new(Guid.NewGuid(), "Anna", UserState.Active, ["Umb.Section.Forms"], ["a"], Reported);
        McpProductStatus[] own = AllProducts.Select(p => p.Id == "forms" ? p with { Off = true, SettingsScope = McpSettingsScope.User } : p).ToArray();
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = { [anna.Key] = OwnCatalogue(Addon, Reported, ("cms", 1)) } },
            users: new FakeApiUserProvider(anna),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [anna.Key] = new McpCapabilities(Addon, own) }));

        McpOverview overview = await service.GetOverviewAsync();

        Assert.That(overview.Findings.Where(f => f.Area == McpFindingArea.Products), Is.Empty);
    }

    [Test]
    public async Task No_load_warning_for_a_product_that_already_has_one()
    {
        McpApiUser anna = NamedUser("Anna");
        McpProductStatus[] products = [Product("cms", "Umbraco CMS"), Product("forms", "Umbraco Forms", true, true, "Broken.")];
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = { [anna.Key] = OwnCatalogue(Addon, Reported, ("cms", 1)) } },
            users: new FakeApiUserProvider(anna),
            caps: new StubCapabilities(new McpCapabilities(Addon, products)));

        McpOverview overview = await service.GetOverviewAsync();

        Assert.That(overview.Findings.Where(f => f.Area == McpFindingArea.Products).Select(f => f.Message), Is.EqualTo(new[] { "Umbraco Forms 17.0.0: Broken." }));
    }

    [Test]
    public async Task No_load_warning_without_reports_of_the_users_own()
    {
        var service = Service(settings: new FakeToolSettingsStore { Catalogue = Catalogue(Addon, ("cms", 1)) });

        McpOverview overview = await service.GetOverviewAsync();

        Assert.That(overview.Findings.Where(f => f.Area == McpFindingArea.Products), Is.Empty);
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

        McpOverview overview = await service.GetOverviewAsync();

        McpOverviewApiUser row = overview.ApiUsers.Single();
        Assert.That(row.ServerVersion, Is.Null);
        Assert.That(row.ToolCount, Is.Null);
        McpFinding finding = overview.Findings.Single(f => f.Area == McpFindingArea.Server);
        Assert.That(finding.Message, Does.StartWith("The MCP server last started as umbrella-mcp 16.9.0"));
    }

    [Test]
    public async Task Created_user_that_never_connected_is_a_row_with_connected_false()
    {
        McpApiUserInfo bea = Info("Bea");
        McpProductStatus[] own =
        [
            Product("cms", "Umbraco CMS"),
            Product("forms", "Umbraco Forms") with { ReadOnly = true, SettingsScope = McpSettingsScope.User },
            Product("automate", "Umbraco Automate"),
        ];
        var service = Service(
            users: new FakeApiUserProvider(),
            created: CreatedStore(bea),
            directory: new FakeApiUserDirectory(bea),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [bea.Key] = new McpCapabilities(Addon, own) }));

        McpOverviewApiUser row = (await service.GetOverviewAsync()).ApiUsers.Single();

        Assert.That(row.Key, Is.EqualTo(bea.Key));
        Assert.That(row.Connected, Is.False);
        Assert.That(row.LastConnected, Is.Null);
        Assert.That(row.Name, Is.EqualTo("Bea"));
        Assert.That(row.ClientIds, Is.EqualTo(new[] { "umbraco-back-office-bea" }));
        Assert.That(row.Groups, Is.EqualTo(new[] { "Editors", "Form managers" }));
        Assert.That(row.Sections, Is.EqualTo(new[] { "Umb.Section.Forms" }));
        Assert.That(row.ToolCount, Is.Null);
        McpOverviewAccess forms = row.Access.Single(a => a.ProductId == "forms");
        Assert.That(forms.Level, Is.EqualTo(McpToolLevel.ReadOnly));
        Assert.That(forms.Scope, Is.EqualTo(McpSettingsScope.User));
        Assert.That(forms.ToolCount, Is.Null);
        Assert.That(row.Access.Single(a => a.ProductId == "automate").SectionAccess, Is.False);
    }

    [Test]
    public async Task Created_user_that_has_connected_appears_once_as_connected()
    {
        McpApiUser anna = NamedUser("Anna");
        McpApiUserInfo annaInfo = new(anna.Key, "Anna", UserState.Active, ["umbraco-back-office-mcp"], ["Umb.Section.Forms"]);
        var service = Service(
            users: new FakeApiUserProvider(anna),
            created: CreatedStore(annaInfo),
            directory: new FakeApiUserDirectory(annaInfo));

        McpOverviewApiUser row = (await service.GetOverviewAsync()).ApiUsers.Single();

        Assert.That(row.Connected, Is.True);
        Assert.That(row.LastConnected, Is.EqualTo(Reported));
    }

    [Test]
    public async Task Created_user_missing_from_directory_is_skipped()
    {
        McpApiUserInfo gone = Info("Gone");
        var service = Service(users: new FakeApiUserProvider(), created: CreatedStore(gone), directory: new FakeApiUserDirectory());

        McpOverview overview = await service.GetOverviewAsync();

        Assert.That(overview.ApiUsers, Is.Empty);
    }

    [Test]
    public async Task Never_connected_rows_come_after_connected_ones_sorted_by_name()
    {
        McpApiUserInfo zoe = Info("zoe");
        McpApiUserInfo bea = Info("Bea");
        var service = Service(
            users: new FakeApiUserProvider(NamedUser("Anna")),
            created: CreatedStore(zoe, bea),
            directory: new FakeApiUserDirectory(zoe, bea));

        McpOverview overview = await service.GetOverviewAsync();

        Assert.That(overview.ApiUsers.Select(u => u.Name), Is.EqualTo(new[] { "Anna", "Bea", "zoe" }));
    }

    [Test]
    public async Task Never_connected_user_raises_no_findings()
    {
        McpApiUserInfo bea = Info("Bea", UserState.Disabled);
        McpOverview without = await Service(users: new FakeApiUserProvider()).GetOverviewAsync();

        McpOverview with = await Service(
            users: new FakeApiUserProvider(),
            created: CreatedStore(bea),
            directory: new FakeApiUserDirectory(bea)).GetOverviewAsync();

        Assert.That(with.Findings, Is.EqualTo(without.Findings));
        Assert.That(with.ApiUsers.Single().State, Is.EqualTo("disabled"));
    }

    [Test]
    public async Task Reading_never_connected_users_failing_leaves_them_out()
    {
        McpApiUserInfo bea = Info("Bea");
        var service = Service(
            users: new FakeApiUserProvider(NamedUser("Anna")),
            created: new FakeCreatedUserStore { Throws = new InvalidOperationException("boom") },
            directory: new FakeApiUserDirectory(bea));

        McpOverview overview = await service.GetOverviewAsync();

        Assert.That(overview.ApiUsers.Select(u => u.Name), Is.EqualTo(new[] { "Anna" }));
    }

    [Test]
    public async Task Products_carry_their_section_alias()
    {
        McpOverview overview = await Service().GetOverviewAsync();

        Assert.That(overview.Products.Single(p => p.Id == "forms").SectionAlias, Is.EqualTo("Umb.Section.Forms"));
        Assert.That(overview.Products.Single(p => p.Id == "cms").SectionAlias, Is.Null);
    }

    [Test]
    public async Task Connected_user_row_carries_sections_and_connected_true()
    {
        var service = Service(users: new FakeApiUserProvider(NamedUser("Anna")));

        McpOverviewApiUser row = (await service.GetOverviewAsync()).ApiUsers.Single();

        Assert.That(row.Connected, Is.True);
        Assert.That(row.Sections, Is.EqualTo(new[] { "Umb.Section.Forms", "Ua.Section.Automate" }));
    }

    private static async Task<List<McpFinding>> ToolWarnings(
        McpToolCatalogue? own, McpProductStatus automate)
    {
        McpApiUser ana = NamedUser("Ana");
        McpProductStatus[] products = [AllProducts[0], AllProducts[1], automate];
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = own is not null ? new() { [ana.Key] = own } : new() },
            users: new FakeApiUserProvider(ana),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [ana.Key] = new McpCapabilities(Addon, products) }));

        McpOverview overview = await service.GetOverviewAsync();
        return overview.Findings.Where(f => f.Area == McpFindingArea.Products && f.Message.Contains("switched off")).ToList();
    }

    private static McpProductStatus AutomateWith(params string[] disabledTools) =>
        Product("automate", "Umbraco Automate") with { DisabledTools = disabledTools };

    private static McpToolCatalogue OlderReport() => OwnCatalogue(Addon, Reported, ("cms", 1), ("forms", 1), ("automate", 3));

    [Test]
    public async Task Warns_when_an_older_server_ignores_switched_off_tools()
    {
        List<McpFinding> found = await ToolWarnings(OlderReport(), AutomateWith("publish-automation", "trigger-automation"));

        Assert.That(found.Select(f => (f.Severity, f.Message)), Is.EqualTo(new[]
        {
            (McpFinding.Warning, "Umbraco Automate: 2 tools are switched off, but the MCP server of \"Ana\" is older and still offers them. Set umbrella-mcp@17.0.0, the add-on's version, in the AI tool's MCP configuration."),
        }));
    }

    [Test]
    public async Task Warning_says_1_tool_is_switched_off_for_a_single_tool()
    {
        List<McpFinding> found = await ToolWarnings(OlderReport(), AutomateWith("publish-automation"));

        Assert.That(found.Select(f => f.Message), Is.EqualTo(new[]
        {
            "Umbraco Automate: 1 tool is switched off, but the MCP server of \"Ana\" is older and still offers them. Set umbrella-mcp@17.0.0, the add-on's version, in the AI tool's MCP configuration.",
        }));
    }

    [Test]
    public async Task Access_counts_switched_off_tools()
    {
        McpApiUser ana = NamedUser("Ana");
        McpProductStatus[] products = [AllProducts[0], AllProducts[1], AutomateWith("publish-automation", "trigger-automation")];
        var service = Service(
            settings: new FakeToolSettingsStore { UserCatalogues = new() { [ana.Key] = OlderReport() } },
            users: new FakeApiUserProvider(ana),
            caps: new StubCapabilities(
                new McpCapabilities(Addon, AllProducts),
                new Dictionary<Guid, McpCapabilities> { [ana.Key] = new McpCapabilities(Addon, products) }));

        McpOverviewApiUser row = (await service.GetOverviewAsync()).ApiUsers.Single();

        Assert.That(row.Access.Single(a => a.ProductId == "automate").DisabledToolCount, Is.EqualTo(2));
        Assert.That(row.Access.Single(a => a.ProductId == "forms").DisabledToolCount, Is.EqualTo(0));
    }

    [Test]
    public async Task No_warning_when_the_server_reports_tools()
    {
        McpToolCatalogue own = new(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["cms"] = new(Reported, [new McpCollectionInfo("a", 1)]),
            ["forms"] = new(Reported, [new McpCollectionInfo("a", 1)]),
            ["automate"] = new(Reported, [new McpCollectionInfo("a", 1, Tools: [new McpToolInfo("publish-automation", null, false, false)])]),
        });

        Assert.That(await ToolWarnings(own, AutomateWith("publish-automation")), Is.Empty);
    }

    [Test]
    public async Task No_warning_when_nothing_is_switched_off()
    {
        Assert.That(await ToolWarnings(OlderReport(), AutomateWith()), Is.Empty);
    }

    [Test]
    public async Task No_warning_when_the_product_is_off_for_the_user()
    {
        Assert.That(await ToolWarnings(OlderReport(), AutomateWith("publish-automation") with { Off = true }), Is.Empty);
    }

    [Test]
    public async Task No_warning_for_a_user_without_its_own_report()
    {
        Assert.That(await ToolWarnings(null, AutomateWith("publish-automation")), Is.Empty);
    }

    [Test]
    public async Task Products_carry_default_and_total_tool_counts()
    {
        McpProductStatus[] products =
        [
            Product("cms", "Umbraco CMS"),
            Product("forms", "Umbraco Forms") with { ReadOnly = true },
            Product("automate", "Umbraco Automate") with { Off = true },
        ];
        McpToolCatalogue shared = new(Addon, new Dictionary<string, McpModuleCatalogue>
        {
            ["cms"] = new(Reported, [new McpCollectionInfo("document", 10, ReadOnlyToolCount: 4)]),
            ["forms"] = new(Reported, [new McpCollectionInfo("form", 8, ReadOnlyToolCount: 3)]),
            ["automate"] = new(Reported, [new McpCollectionInfo("automation", 6)]),
        });

        McpOverview overview = await Service(
            caps: new StubCapabilities(new McpCapabilities(Addon, products)),
            settings: new FakeToolSettingsStore { Catalogue = shared },
            users: new FakeApiUserProvider()).GetOverviewAsync();

        McpOverviewProduct cms = overview.Products.Single(p => p.Id == "cms");
        McpOverviewProduct forms = overview.Products.Single(p => p.Id == "forms");
        McpOverviewProduct automate = overview.Products.Single(p => p.Id == "automate");
        Assert.That(cms.ToolCount, Is.EqualTo(10));
        Assert.That(cms.TotalToolCount, Is.EqualTo(10));
        Assert.That(forms.ToolCount, Is.EqualTo(3));
        Assert.That(forms.TotalToolCount, Is.EqualTo(8));
        Assert.That(automate.ToolCount, Is.EqualTo(0));
        Assert.That(automate.TotalToolCount, Is.EqualTo(6));
    }

    [Test]
    public async Task Unreported_product_has_null_tool_counts()
    {
        McpOverview overview = await Service(
            settings: new FakeToolSettingsStore { Catalogue = McpToolCatalogue.Empty },
            users: new FakeApiUserProvider()).GetOverviewAsync();

        McpOverviewProduct cms = overview.Products.Single(p => p.Id == "cms");
        Assert.That(cms.ToolCount, Is.Null);
        Assert.That(cms.TotalToolCount, Is.Null);
    }
}
