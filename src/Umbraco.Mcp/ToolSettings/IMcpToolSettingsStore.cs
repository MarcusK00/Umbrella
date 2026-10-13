namespace Umbraco.Mcp.ToolSettings;

/// <summary>
/// The tool groups switched off in the backoffice, the products limited to read-only or non-destructive tools, and the groups the MCP
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

    /// <summary>Ids of the modules that only get non-destructive tools. Empty when nothing is stored.</summary>
    IReadOnlyList<string> GetNoDestructiveModules();

    void SetNoDestructiveModules(IReadOnlyList<string> moduleIds);

    /// <summary>Ids of the modules switched off: the npm server does not load them. Empty when nothing is stored.</summary>
    IReadOnlyList<string> GetOffModules();

    void SetOffModules(IReadOnlyList<string> moduleIds);

    McpToolCatalogue GetCatalogue();

    /// <summary>Overwrites the modules in <paramref name="report"/> and keeps every other module's last entry.</summary>
    void MergeCatalogue(McpCatalogueReport report, DateTimeOffset at);

    /// <summary>One API user's own settings by product id. Empty when none are stored or the row is blank or invalid.</summary>
    IReadOnlyDictionary<string, McpProductOverride> GetUserOverrides(Guid userKey);

    /// <summary>Replaces the user's settings. An empty map blanks the row, so the user follows the defaults.</summary>
    void SetUserOverrides(Guid userKey, IReadOnlyDictionary<string, McpProductOverride> overrides);

    /// <summary>Every user's own settings. Leaves out blank, invalid and empty rows.</summary>
    IReadOnlyDictionary<Guid, IReadOnlyDictionary<string, McpProductOverride>> GetAllUserOverrides();

    /// <summary>What this user's MCP server last reported. Null when none is stored or the row is blank or invalid.</summary>
    McpToolCatalogue? GetUserCatalogue(Guid userKey);

    /// <summary>Replaces the user's catalogue with <paramref name="report"/>; every module is stamped with <paramref name="at"/>.</summary>
    void SetUserCatalogue(Guid userKey, McpCatalogueReport report, DateTimeOffset at);

    /// <summary>Every stored per-user catalogue. Leaves out blank and invalid rows.</summary>
    IReadOnlyDictionary<Guid, McpToolCatalogue> GetAllUserCatalogues();

    /// <summary>Blanks the user's catalogue row.</summary>
    void ClearUserCatalogue(Guid userKey);
}
