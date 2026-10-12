using System.Text.Json;
using Microsoft.Extensions.Logging;
using Umbraco.Cms.Core.Services;

namespace Umbraco.Mcp.ToolSettings;

/// <summary>
/// Keeps the tool settings and the catalogue as JSON in Umbraco's key/value table (<c>umbracoKeyValue</c>), so they
/// survive restarts and are shared by every server of a load-balanced site.
/// </summary>
public sealed class KeyValueMcpToolSettingsStore(IKeyValueService keyValues, ILogger<KeyValueMcpToolSettingsStore> logger)
    : IMcpToolSettingsStore
{
    internal const string SettingsKey = "Umbraco.Mcp.ToolSettings";
    internal const string CatalogueKey = "Umbraco.Mcp.Catalogue";
    internal const string ReadOnlyKey = "Umbraco.Mcp.ReadOnlyModules";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public IReadOnlyDictionary<string, IReadOnlyList<string>> GetDisabledCollections() =>
        Read<Dictionary<string, IReadOnlyList<string>>>(SettingsKey) ?? new Dictionary<string, IReadOnlyList<string>>();

    public void SetDisabledCollections(IReadOnlyDictionary<string, IReadOnlyList<string>> disabled) =>
        keyValues.SetValue(SettingsKey, JsonSerializer.Serialize(disabled, Json));

    public IReadOnlyList<string> GetReadOnlyModules() => Read<List<string>>(ReadOnlyKey) ?? [];

    public void SetReadOnlyModules(IReadOnlyList<string> moduleIds) =>
        keyValues.SetValue(ReadOnlyKey, JsonSerializer.Serialize(moduleIds, Json));

    public McpToolCatalogue GetCatalogue() => Read<McpToolCatalogue>(CatalogueKey) is { Modules: not null } c ? c : McpToolCatalogue.Empty;

    public void MergeCatalogue(McpCatalogueReport report, DateTimeOffset at)
    {
        var modules = new Dictionary<string, McpModuleCatalogue>(GetCatalogue().Modules, StringComparer.Ordinal);
        foreach (McpModuleReport module in report.Modules)
        {
            modules[module.Id] = new McpModuleCatalogue(at, module.SiteSettingsIgnored, module.Collections);
        }

        keyValues.SetValue(CatalogueKey, JsonSerializer.Serialize(new McpToolCatalogue(report.UmbrellaVersion, modules), Json));
    }

    private T? Read<T>(string key)
        where T : class
    {
        string? value = keyValues.GetValue(key);
        if (string.IsNullOrEmpty(value))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(value, Json);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "The stored MCP tool settings ({Key}) are not valid JSON and are ignored.", key);
            return null;
        }
    }
}
