using System.Globalization;
using Microsoft.Extensions.Logging;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Client;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Overview;

/// <inheritdoc />
public sealed class McpOverviewService(
    IMcpCapabilitiesService capabilities,
    IMcpToolSettingsStore toolSettings,
    IMcpApiUserProvider apiUsers,
    IEnumerable<IMcpProductDetector> detectors,
    ILogger<McpOverviewService> logger) : IMcpOverviewService
{
    public async Task<McpOverview> GetOverviewAsync()
    {
        McpCapabilities? caps = Read(() => capabilities.GetCapabilities(), "the detected products");
        McpToolCatalogue? catalogue = Read(toolSettings.GetCatalogue, "what the MCP server last reported");
        IReadOnlyList<McpApiUser>? users = null;
        try
        {
            users = await apiUsers.GetConnectedAsync();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read the API users the MCP server connected as. The overview leaves them out.");
        }

        IReadOnlyDictionary<Guid, McpToolCatalogue> userCatalogues = ReadConnectedCatalogues(users);

        string addonVersion = caps?.AddonVersion ?? McpAddon.Version;
        IReadOnlyList<McpProductStatus> products = caps?.Products ?? [];
        var sectionByProduct = detectors.ToDictionary(d => d.Id, d => d.SectionAlias);

        return new McpOverview(
            addonVersion,
            BuildFindings(caps, catalogue, users, sectionByProduct, addonVersion, userCatalogues),
            products.Select(p => BuildProduct(p, catalogue, userCatalogues)).ToList(),
            BuildServer(catalogue, addonVersion),
            (users ?? []).Select(u => BuildUser(
                u,
                products,
                sectionByProduct,
                userCatalogues.GetValueOrDefault(u.Key),
                Read(() => capabilities.GetCapabilities(u.Key), $"the tool access of \"{u.Name}\""))).ToList());
    }

    private T? Read<T>(Func<T> read, string what) where T : class
    {
        try
        {
            return read();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read {What}. The overview leaves it out.", what);
            return null;
        }
    }

    /// <summary>
    /// What each connected API user's MCP server last reported, for the users that have a report of their own. Empty when
    /// there are none, or when reading them failed: the overview then falls back to the shared report.
    /// </summary>
    private IReadOnlyDictionary<Guid, McpToolCatalogue> ReadConnectedCatalogues(IReadOnlyList<McpApiUser>? users)
    {
        var result = new Dictionary<Guid, McpToolCatalogue>();
        if (users is not { Count: > 0 })
        {
            return result;
        }

        IReadOnlyDictionary<Guid, McpToolCatalogue>? all = Read(toolSettings.GetAllUserCatalogues, "what each API user's MCP server last reported");
        foreach (McpApiUser user in users.DistinctBy(u => u.Key))
        {
            if (all is not null && all.TryGetValue(user.Key, out McpToolCatalogue? own) && HasReport(own))
            {
                result[user.Key] = own;
            }
        }

        return result;
    }

    /// <summary>A catalogue counts as a report only with a version and at least one module.</summary>
    private static bool HasReport(McpToolCatalogue? catalogue) =>
        catalogue is not null && !string.IsNullOrEmpty(catalogue.UmbrellaVersion) && catalogue.Modules.Count > 0;

    /// <summary>
    /// When the last report was made. Every module in one report gets the same time (<c>MergeCatalogue</c>),
    /// so a module with an older time was not part of the latest start.
    /// </summary>
    private static DateTimeOffset LatestReportedAt(McpToolCatalogue catalogue) => catalogue.Modules.Values.Max(m => m.ReportedAt);

    /// <summary>The module's entry when it was part of the catalogue's latest report, else null.</summary>
    private static McpModuleCatalogue? FindLoadedModule(McpToolCatalogue? catalogue, string productId) =>
        HasReport(catalogue)
        && catalogue!.Modules.TryGetValue(productId, out McpModuleCatalogue? module)
        && module.ReportedAt == LatestReportedAt(catalogue)
            ? module
            : null;

    private static string AccessLevel(McpProductStatus p) => p.ReadOnly ? "readOnly" : p.NoDestructive ? "noDestructive" : "full";

    /// <summary>
    /// A product is loaded when a connected API user's MCP server loaded it; its tool count is from the most recent such
    /// start. Without any per-user report, the shared one decides.
    /// </summary>
    private static McpOverviewProduct BuildProduct(
        McpProductStatus p,
        McpToolCatalogue? catalogue,
        IReadOnlyDictionary<Guid, McpToolCatalogue> userCatalogues)
    {
        McpModuleCatalogue? module = userCatalogues.Count > 0
            ? userCatalogues.Values.Select(c => FindLoadedModule(c, p.Id)).OfType<McpModuleCatalogue>().MaxBy(m => m.ReportedAt)
            : FindLoadedModule(catalogue, p.Id);
        int toolCount = module?.Collections.Sum(c => c.ToolCount) ?? 0;
        return new McpOverviewProduct(
            p.Id, p.DisplayName, p.Installed, p.Enabled, p.Version, p.Issues, module is not null, toolCount, AccessLevel(p));
    }

    private static McpServerReport? BuildServer(McpToolCatalogue? catalogue, string addonVersion)
    {
        if (!HasReport(catalogue))
        {
            return null;
        }

        return new McpServerReport(
            catalogue!.UmbrellaVersion!,
            LatestReportedAt(catalogue),
            string.Equals(catalogue.UmbrellaVersion, addonVersion, StringComparison.Ordinal));
    }

    private static McpOverviewApiUser BuildUser(
        McpApiUser user,
        IReadOnlyList<McpProductStatus> products,
        IReadOnlyDictionary<string, string?> sectionByProduct,
        McpToolCatalogue? ownCatalogue,
        McpCapabilities? userCapabilities)
    {
        var reachable = new List<string>();
        var unreachable = new List<string>();
        foreach ((McpProductStatus p, string section) in ProductsWithSection(products, sectionByProduct))
        {
            (user.AllowedSections.Contains(section, StringComparer.OrdinalIgnoreCase) ? reachable : unreachable).Add(p.DisplayName);
        }

        List<McpOverviewAccess> access = (userCapabilities?.Products ?? [])
            .Where(p => p.Installed && p.Enabled)
            .Select(p => new McpOverviewAccess(p.Id, p.DisplayName, AccessLevel(p), p.SettingsScope, ToolCount(ownCatalogue, p)))
            .ToList();
        return new McpOverviewApiUser(
            user.Key,
            user.Name,
            user.ClientIds.ToList(),
            McpUserStates.Name(user.State),
            user.LastConnected,
            reachable,
            unreachable,
            ownCatalogue?.UmbrellaVersion,
            ownCatalogue is null ? null : LatestReportedAt(ownCatalogue),
            access.Count == 0 || access.Any(a => a.ToolCount is null) ? null : access.Sum(a => a.ToolCount),
            access);
    }

    /// <summary>
    /// The tools a user's last start got from a product with the settings the site now resolves for it. A catalogue is
    /// replaced on every start, so a product missing from it was not loaded: none.
    /// </summary>
    private static int? ToolCount(McpToolCatalogue? ownCatalogue, McpProductStatus product) =>
        ownCatalogue is null ? null
        : ownCatalogue.Modules.TryGetValue(product.Id, out McpModuleCatalogue? module) ? McpToolCounts.Effective(module, product)
        : 0;

    /// <summary>Installed and enabled products whose tools need a backoffice section. CMS needs none.</summary>
    private static IEnumerable<(McpProductStatus Product, string Section)> ProductsWithSection(
        IEnumerable<McpProductStatus> products,
        IReadOnlyDictionary<string, string?> sectionByProduct)
    {
        foreach (McpProductStatus p in products.Where(p => p.Installed && p.Enabled))
        {
            if (sectionByProduct.TryGetValue(p.Id, out string? section) && section is not null)
            {
                yield return (p, section);
            }
        }
    }

    /// <summary>
    /// The findings, with the wording of the MCP health checks, as plain text. A null input means reading it failed.
    /// Warnings come first; within a severity, products, then server, then API users. When connected API users have a
    /// report of their own (<paramref name="userCatalogues"/>), the server findings are one version warning per such
    /// user and the shared report is not looked at.
    /// </summary>
    internal static IReadOnlyList<McpFinding> BuildFindings(
        McpCapabilities? caps,
        McpToolCatalogue? catalogue,
        IReadOnlyList<McpApiUser>? users,
        IReadOnlyDictionary<string, string?> sectionByProduct,
        string addonVersion,
        IReadOnlyDictionary<Guid, McpToolCatalogue>? userCatalogues = null)
    {
        var productFindings = new List<McpFinding>();
        var serverFindings = new List<McpFinding>();
        var userFindings = new List<McpFinding>();

        if (caps is null)
        {
            productFindings.Add(new(McpFinding.Info, McpFindingArea.Products, "Could not read the detected products. See the log."));
        }
        else
        {
            foreach (McpProductStatus p in caps.Products.Where(p => p.Issues.Count > 0 || (p.Installed && !p.Enabled)))
            {
                string name = p.Version is null ? p.DisplayName : $"{p.DisplayName} {p.Version}";
                string detail = p.Issues.Count > 0 ? string.Join(" ", p.Issues) : "Installed, but its API is not available.";
                productFindings.Add(new(McpFinding.Warning, McpFindingArea.Products, $"{name}: {detail}"));
            }
        }

        if (userCatalogues is { Count: > 0 })
        {
            serverFindings.AddRange(BuildUserVersionFindings(users ?? [], userCatalogues, addonVersion));
        }
        else if (catalogue is null)
        {
            serverFindings.Add(new(McpFinding.Info, McpFindingArea.Server, "Could not read what the MCP server last reported. See the log."));
        }
        else if (!HasReport(catalogue))
        {
            serverFindings.Add(new(McpFinding.Info, McpFindingArea.Server,
                "The MCP server has not reported to this site yet. It reports when your AI tool starts it."));
        }
        else if (!string.Equals(catalogue.UmbrellaVersion, addonVersion, StringComparison.Ordinal))
        {
            serverFindings.Add(new(McpFinding.Warning, McpFindingArea.Server,
                $"The MCP server last started as umbrella-mcp {catalogue.UmbrellaVersion} on {FormatUtc(LatestReportedAt(catalogue))}, but the add-on is {addonVersion}. " +
                $"The two are released together: set {McpClientConfig.NpmPackage}@{addonVersion} in your AI tool's MCP configuration."));
        }

        if (users is null)
        {
            userFindings.Add(new(McpFinding.Info, McpFindingArea.ApiUsers, "Could not read the API users the MCP server connected as. See the log."));
        }
        else if (users.Count == 0)
        {
            userFindings.Add(new(McpFinding.Info, McpFindingArea.ApiUsers,
                "No MCP server has connected to this site yet. The MCP server connects when your AI tool starts it; start it, then check again."));
        }
        else
        {
            foreach (McpApiUser user in users)
            {
                userFindings.AddRange(BuildUserFindings(user, caps?.Products ?? [], sectionByProduct));
            }
        }

        // OrderBy is stable, so the area and input order inside a severity is kept.
        return productFindings.Concat(serverFindings).Concat(userFindings)
            .OrderBy(f => f.Severity == McpFinding.Warning ? 0 : 1)
            .ToList();
    }

    private static string FormatUtc(DateTimeOffset at) => $"{at.UtcDateTime.ToString("dd-MM-yyyy HH:mm", CultureInfo.InvariantCulture)} UTC";

    private static IEnumerable<McpFinding> BuildUserVersionFindings(
        IReadOnlyList<McpApiUser> users,
        IReadOnlyDictionary<Guid, McpToolCatalogue> userCatalogues,
        string addonVersion)
    {
        foreach (McpApiUser user in users)
        {
            if (userCatalogues.TryGetValue(user.Key, out McpToolCatalogue? own)
                && !string.Equals(own.UmbrellaVersion, addonVersion, StringComparison.Ordinal))
            {
                yield return new(McpFinding.Warning, McpFindingArea.Server,
                    $"\"{user.Name}\" last started umbrella-mcp {own.UmbrellaVersion} on {FormatUtc(LatestReportedAt(own))}, but the add-on is {addonVersion}. " +
                    $"The two are released together: set {McpClientConfig.NpmPackage}@{addonVersion} in your AI tool's MCP configuration.");
            }
        }
    }

    private static IEnumerable<McpFinding> BuildUserFindings(
        McpApiUser user,
        IReadOnlyList<McpProductStatus> products,
        IReadOnlyDictionary<string, string?> sectionByProduct)
    {
        string? blocked = user.State switch
        {
            UserState.Disabled => "disabled",
            UserState.LockedOut => "locked out",
            _ => null,
        };
        if (blocked is not null)
        {
            string name = user.ClientIds.Count > 0
                ? $"\"{user.Name}\" ({string.Join(", ", user.ClientIds)})"
                : $"\"{user.Name}\"";
            yield return new(McpFinding.Warning, McpFindingArea.ApiUsers,
                $"The API user {name} is {blocked}, so the MCP server can no longer sign in with it.");
        }

        foreach ((McpProductStatus p, string section) in ProductsWithSection(products, sectionByProduct))
        {
            if (!user.AllowedSections.Contains(section, StringComparer.OrdinalIgnoreCase))
            {
                yield return new(McpFinding.Warning, McpFindingArea.ApiUsers,
                    $"The API user \"{user.Name}\" cannot use {p.DisplayName} tools: none of its user groups grant the {section} section.");
            }
        }
    }
}
