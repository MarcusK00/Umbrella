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

    private sealed class StubCapabilities(McpCapabilities caps) : IMcpCapabilitiesService
    {
        public McpCapabilities GetCapabilities() => caps;
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
            catalogue ?? Catalogue(),
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
            settings ?? new FakeToolSettingsStore { Catalogue = Catalogue() },
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
}
