using Umbraco.Mcp.Api;

namespace Umbraco.Mcp.ToolSettings;

internal static class McpCatalogueFallback
{
    /// <summary>
    /// Picks the catalogue to show for an API user whose own MCP server may never have reported: its own, else the most
    /// recent one of another existing API user, else the shared row, else none. Catalogues of users that are not in
    /// <paramref name="apiUserNames"/> (deleted, or no longer API users) are never used.
    /// </summary>
    public static (McpToolCatalogue Catalogue, McpCatalogueSource Source) Resolve(
        Guid userKey,
        IReadOnlyDictionary<Guid, McpToolCatalogue> userCatalogues,
        McpToolCatalogue shared,
        IReadOnlyDictionary<Guid, string> apiUserNames)
    {
        if (userCatalogues.TryGetValue(userKey, out McpToolCatalogue? own) && own.Modules.Count > 0)
        {
            return (own, new McpCatalogueSource("user", LatestReportedAt(own)));
        }

        (Guid Key, McpToolCatalogue Catalogue, DateTimeOffset At)? latest = null;
        foreach ((Guid key, McpToolCatalogue catalogue) in userCatalogues)
        {
            if (key == userKey || catalogue.Modules.Count == 0 || !apiUserNames.ContainsKey(key))
            {
                continue;
            }

            DateTimeOffset at = LatestReportedAt(catalogue);
            if (latest is null || at > latest.Value.At)
            {
                latest = (key, catalogue, at);
            }
        }

        if (latest is { } other)
        {
            return (other.Catalogue, new McpCatalogueSource("latest", other.At, apiUserNames[other.Key]));
        }

        if (shared.Modules.Count > 0)
        {
            return (shared, new McpCatalogueSource("latest", LatestReportedAt(shared)));
        }

        return (McpToolCatalogue.Empty, new McpCatalogueSource("none"));
    }

    /// <summary>
    /// The catalogue for "All API users": per group, the highest counts any existing API user's MCP server reported, so
    /// the defaults show what the best-permitted user gets. Counts depend on each user's permissions, and a user whose
    /// server never started adds nothing yet. Before any API user has a report of its own, the shared row is used.
    /// The result has no version: versions are per user.
    /// </summary>
    public static McpToolCatalogue Highest(
        IReadOnlyDictionary<Guid, McpToolCatalogue> userCatalogues,
        McpToolCatalogue shared,
        IReadOnlySet<Guid> apiUserKeys)
    {
        McpToolCatalogue[] reports = userCatalogues
            .Where(c => apiUserKeys.Contains(c.Key) && c.Value.Modules.Count > 0)
            .Select(c => c.Value)
            .ToArray();
        if (reports.Length == 0)
        {
            return shared;
        }

        var modules = new Dictionary<string, McpModuleCatalogue>(StringComparer.Ordinal);
        foreach ((string id, McpModuleCatalogue module) in reports.SelectMany(r => r.Modules))
        {
            modules[id] = modules.TryGetValue(id, out McpModuleCatalogue? seen) ? Higher(seen, module) : module;
        }

        return new McpToolCatalogue(null, modules);
    }

    private static McpModuleCatalogue Higher(McpModuleCatalogue a, McpModuleCatalogue b)
    {
        // Keep the order the groups were first reported in; a group only one report has is kept as it is.
        var collections = a.Collections.ToList();
        foreach (McpCollectionInfo other in b.Collections)
        {
            int i = collections.FindIndex(c => c.Name == other.Name);
            if (i < 0)
            {
                collections.Add(other);
                continue;
            }

            McpCollectionInfo mine = collections[i];
            collections[i] = mine with
            {
                ToolCount = Math.Max(mine.ToolCount, other.ToolCount),
                ReadOnlyToolCount = Max(mine.ReadOnlyToolCount, other.ReadOnlyToolCount),
                NonDestructiveToolCount = Max(mine.NonDestructiveToolCount, other.NonDestructiveToolCount),
                DisabledByDefault = mine.DisabledByDefault || other.DisabledByDefault,
            };
        }

        return new McpModuleCatalogue(
            a.ReportedAt > b.ReportedAt ? a.ReportedAt : b.ReportedAt,
            a.SiteSettingsIgnored || b.SiteSettingsIgnored,
            collections);
    }

    private static int? Max(int? a, int? b) => a is null ? b : b is null ? a : Math.Max(a.Value, b.Value);

    internal static DateTimeOffset LatestReportedAt(McpToolCatalogue catalogue) => catalogue.Modules.Values.Max(m => m.ReportedAt);
}
