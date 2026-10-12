namespace Umbraco.Mcp.ToolSettings;

/// <summary>
/// The tool groups switched off in the backoffice, the products limited to read-only tools, and the groups the MCP
/// server last reported.
/// </summary>
public interface IMcpToolSettingsStore
{
    /// <summary>Disabled collection names by module id. Empty when nothing is stored.</summary>
    IReadOnlyDictionary<string, IReadOnlyList<string>> GetDisabledCollections();

    void SetDisabledCollections(IReadOnlyDictionary<string, IReadOnlyList<string>> disabled);

    /// <summary>Ids of the modules that only get read-only tools. Empty when nothing is stored.</summary>
    IReadOnlyList<string> GetReadOnlyModules();

    void SetReadOnlyModules(IReadOnlyList<string> moduleIds);

    McpToolCatalogue GetCatalogue();

    /// <summary>Overwrites the modules in <paramref name="report"/> and keeps every other module's last entry.</summary>
    void MergeCatalogue(McpCatalogueReport report, DateTimeOffset at);
}
