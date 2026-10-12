namespace Umbraco.Mcp.ToolSettings;

/// <summary>
/// One tool group (collection) of a module and how many of its tools the MCP's API user can use. The read-only
/// count is null in reports from MCP servers that predate it.
/// </summary>
public sealed record McpCollectionInfo(string Name, int ToolCount, int? ReadOnlyToolCount = null);

/// <summary>What the MCP server last reported for one module.</summary>
public sealed record McpModuleCatalogue(DateTimeOffset ReportedAt, bool SiteSettingsIgnored, IReadOnlyList<McpCollectionInfo> Collections);

/// <summary>Every module the MCP server has reported, by module id.</summary>
public sealed record McpToolCatalogue(string? UmbrellaVersion, IReadOnlyDictionary<string, McpModuleCatalogue> Modules)
{
    public static McpToolCatalogue Empty { get; } = new(null, new Dictionary<string, McpModuleCatalogue>());
}
