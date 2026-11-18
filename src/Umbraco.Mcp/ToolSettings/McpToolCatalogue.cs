namespace Umbraco.Mcp.ToolSettings;

/// <summary>
/// One tool group (collection) of a module and how many of its tools the MCP's API user can use. The read-only
/// count is null in reports from MCP servers that predate it. <paramref name="DisabledByDefault"/> marks a group the
/// module keeps off until the site saves a list for it; false in reports from MCP servers that predate it.
/// <paramref name="NonDestructiveToolCount"/> is the tools without a destructive hint; null in reports from MCP servers
/// that predate it. <paramref name="Tools"/> lists the group's tools; null in reports from MCP servers that predate it
/// (not "no tools"). When present, the counts and sizes are derived from it. <paramref name="SizeBytes"/>,
/// <paramref name="ReadOnlySizeBytes"/> and <paramref name="NonDestructiveSizeBytes"/> are the UTF-8 byte lengths of
/// the group's tools as <c>tools/list</c> sends them; null in reports from MCP servers that predate them.
/// </summary>
public sealed record McpCollectionInfo(
    string Name,
    int ToolCount,
    int? ReadOnlyToolCount = null,
    bool DisabledByDefault = false,
    int? NonDestructiveToolCount = null,
    IReadOnlyList<McpToolInfo>? Tools = null,
    int? SizeBytes = null,
    int? ReadOnlySizeBytes = null,
    int? NonDestructiveSizeBytes = null);

/// <summary>One tool of a group, as the MCP server reported it: the unprefixed name, its short description, its hints and its <c>tools/list</c> byte length.</summary>
public sealed record McpToolInfo(string Name, string? Description, bool ReadOnly, bool Destructive, int? SizeBytes = null);

/// <summary>What the MCP server last reported for one module.</summary>
public sealed record McpModuleCatalogue(DateTimeOffset ReportedAt, IReadOnlyList<McpCollectionInfo> Collections);

/// <summary>Every module the MCP server has reported, by module id.</summary>
public sealed record McpToolCatalogue(string? UmbrellaVersion, IReadOnlyDictionary<string, McpModuleCatalogue> Modules)
{
    public static McpToolCatalogue Empty { get; } = new(null, new Dictionary<string, McpModuleCatalogue>());
}
