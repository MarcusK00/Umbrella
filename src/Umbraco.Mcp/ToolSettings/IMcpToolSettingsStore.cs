namespace Umbraco.Mcp.ToolSettings;

/// <summary>The tool groups switched off in the backoffice, and the groups the MCP server last reported.</summary>
public interface IMcpToolSettingsStore
{
    /// <summary>Disabled collection names by module id. Empty when nothing is stored.</summary>
    IReadOnlyDictionary<string, IReadOnlyList<string>> GetDisabledCollections();

    void SetDisabledCollections(IReadOnlyDictionary<string, IReadOnlyList<string>> disabled);

    McpToolCatalogue GetCatalogue();

    /// <summary>Overwrites the modules in <paramref name="report"/> and keeps every other module's last entry.</summary>
    void MergeCatalogue(McpCatalogueReport report, DateTimeOffset at);
}
