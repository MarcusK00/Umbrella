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

    internal static DateTimeOffset LatestReportedAt(McpToolCatalogue catalogue) => catalogue.Modules.Values.Max(m => m.ReportedAt);
}
