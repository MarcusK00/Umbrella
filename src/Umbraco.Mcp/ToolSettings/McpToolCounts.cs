using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.ToolSettings;

internal static class McpToolCounts
{
    /// <summary>
    /// How many of a module's reported tools the MCP server gets with the site's settings for it: the groups that are on
    /// (the saved list, else the groups the module keeps off by default), counted at the product's level. Null when the
    /// server's environment sets its own collection filters for the module, because the site cannot see those.
    /// A report from an older server without level counts falls back to all tools of a group.
    /// </summary>
    public static int? Effective(McpModuleCatalogue module, McpProductStatus product)
    {
        // Switched off: the npm server does not load the product, whatever the environment says about its groups.
        if (product.Off)
        {
            return 0;
        }

        if (module.SiteSettingsIgnored)
        {
            return null;
        }

        var off = product.DisabledCollections is { } saved
            ? saved.ToHashSet(StringComparer.Ordinal)
            : module.Collections.Where(c => c.DisabledByDefault).Select(c => c.Name).ToHashSet(StringComparer.Ordinal);
        return module.Collections
            .Where(c => !off.Contains(c.Name))
            .Sum(c => product.ReadOnly ? c.ReadOnlyToolCount ?? c.ToolCount
                : product.NoDestructive ? c.NonDestructiveToolCount ?? c.ToolCount
                : c.ToolCount);
    }
}
