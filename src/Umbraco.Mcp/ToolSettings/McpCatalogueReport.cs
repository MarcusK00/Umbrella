namespace Umbraco.Mcp.ToolSettings;

/// <summary>One module in the catalogue the MCP server reports when it starts.</summary>
public sealed record McpModuleReport(string Id, bool SiteSettingsIgnored, IReadOnlyList<McpCollectionInfo> Collections);

/// <summary>The body of <c>POST /mcp/catalogue</c>: the modules the MCP server loaded, before any filter.</summary>
public sealed record McpCatalogueReport(string UmbrellaVersion, IReadOnlyList<McpModuleReport> Modules);
