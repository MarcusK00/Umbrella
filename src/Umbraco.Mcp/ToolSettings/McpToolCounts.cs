using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.ToolSettings;

internal static class McpToolCounts
{
    /// <summary>
    /// How many of a module's reported tools the MCP server gets with the site's settings for it: the groups that are on
    /// (the saved list, else the groups the module keeps off by default), counted at the product's level, without the
    /// tools switched off. A group reported without tools (an older server) counts its per-group numbers, and a report
    /// without level counts falls back to all tools of a group.
    /// </summary>
    public static int Effective(McpModuleCatalogue module, McpProductStatus product)
    {
        // Switched off: the npm server does not load the product, whatever the environment says about its groups.
        if (product.Off)
        {
            return 0;
        }

        return OnCollections(module, product)
            .Sum(c => c.Tools is { } tools
                ? tools.Count(t => IsKept(t, product))
                : product.ReadOnly ? c.ReadOnlyToolCount ?? c.ToolCount
                : product.NoDestructive ? c.NonDestructiveToolCount ?? c.ToolCount
                : c.ToolCount);
    }

    /// <summary>The tools the MCP server registers from the groups that report tools: group on, level, not switched off.</summary>
    public static IReadOnlyList<McpToolInfo> KeptTools(McpModuleCatalogue module, McpProductStatus product)
    {
        if (product.Off)
        {
            return [];
        }

        return OnCollections(module, product)
            .Where(c => c.Tools is not null)
            .SelectMany(c => c.Tools!)
            .Where(t => IsKept(t, product))
            .ToList();
    }

    private static IEnumerable<McpCollectionInfo> OnCollections(McpModuleCatalogue module, McpProductStatus product)
    {
        var off = product.DisabledCollections is { } saved
            ? saved.ToHashSet(StringComparer.Ordinal)
            : module.Collections.Where(c => c.DisabledByDefault).Select(c => c.Name).ToHashSet(StringComparer.Ordinal);
        return module.Collections.Where(c => !off.Contains(c.Name));
    }

    private static bool IsKept(McpToolInfo tool, McpProductStatus product) =>
        !product.DisabledTools.Contains(tool.Name, StringComparer.Ordinal)
        && (product.ReadOnly ? tool.ReadOnly : !product.NoDestructive || !tool.Destructive);
}
