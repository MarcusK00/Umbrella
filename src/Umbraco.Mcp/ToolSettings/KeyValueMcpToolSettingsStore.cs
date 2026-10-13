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
    internal const string NoDestructiveKey = "Umbraco.Mcp.NoDestructiveModules";
    internal const string OffKey = "Umbraco.Mcp.OffModules";
    internal const string UserOverridesKeyPrefix = "Umbraco.Mcp.UserToolSettings.";
    internal const string UserCatalogueKeyPrefix = "Umbraco.Mcp.UserCatalogue.";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public IReadOnlyDictionary<string, IReadOnlyList<string>> GetDisabledCollections() =>
        Read<Dictionary<string, IReadOnlyList<string>>>(SettingsKey) ?? new Dictionary<string, IReadOnlyList<string>>();

    public void SetDisabledCollections(IReadOnlyDictionary<string, IReadOnlyList<string>> disabled) =>
        keyValues.SetValue(SettingsKey, JsonSerializer.Serialize(disabled, Json));

    public IReadOnlyList<string> GetReadOnlyModules() => Read<List<string>>(ReadOnlyKey) ?? [];

    public void SetReadOnlyModules(IReadOnlyList<string> moduleIds) =>
        keyValues.SetValue(ReadOnlyKey, JsonSerializer.Serialize(moduleIds, Json));

    public IReadOnlyList<string> GetNoDestructiveModules() => Read<List<string>>(NoDestructiveKey) ?? [];

    public void SetNoDestructiveModules(IReadOnlyList<string> moduleIds) =>
        keyValues.SetValue(NoDestructiveKey, JsonSerializer.Serialize(moduleIds, Json));

    public IReadOnlyList<string> GetOffModules() => Read<List<string>>(OffKey) ?? [];

    public void SetOffModules(IReadOnlyList<string> moduleIds) =>
        keyValues.SetValue(OffKey, JsonSerializer.Serialize(moduleIds, Json));

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

    public IReadOnlyDictionary<string, McpProductOverride> GetUserOverrides(Guid userKey) =>
        NormalizeOverrides(Read<Dictionary<string, McpProductOverride?>>(UserOverridesKeyPrefix + userKey.ToString("D")));

    /// <summary>IKeyValueService has no delete, so an empty map blanks the row; readers skip blank values.</summary>
    public void SetUserOverrides(Guid userKey, IReadOnlyDictionary<string, McpProductOverride> overrides) =>
        keyValues.SetValue(
            UserOverridesKeyPrefix + userKey.ToString("D"),
            overrides.Count == 0 ? "" : JsonSerializer.Serialize(overrides, Json));

    public IReadOnlyDictionary<Guid, IReadOnlyDictionary<string, McpProductOverride>> GetAllUserOverrides()
    {
        var result = new Dictionary<Guid, IReadOnlyDictionary<string, McpProductOverride>>();
        foreach ((string key, string? _) in keyValues.FindByKeyPrefix(UserOverridesKeyPrefix) ?? new Dictionary<string, string?>())
        {
            if (Guid.TryParse(key[UserOverridesKeyPrefix.Length..], out Guid userKey)
                && GetUserOverrides(userKey) is { Count: > 0 } overrides)
            {
                result[userKey] = overrides;
            }
        }

        return result;
    }

    public McpToolCatalogue? GetUserCatalogue(Guid userKey) =>
        Read<McpToolCatalogue>(UserCatalogueKeyPrefix + userKey.ToString("D")) is { Modules: not null } c ? c : null;

    public void SetUserCatalogue(Guid userKey, McpCatalogueReport report, DateTimeOffset at)
    {
        var modules = new Dictionary<string, McpModuleCatalogue>(StringComparer.Ordinal);
        foreach (McpModuleReport module in report.Modules)
        {
            modules[module.Id] = new McpModuleCatalogue(at, module.SiteSettingsIgnored, module.Collections);
        }

        keyValues.SetValue(
            UserCatalogueKeyPrefix + userKey.ToString("D"),
            JsonSerializer.Serialize(new McpToolCatalogue(report.UmbrellaVersion, modules), Json));
    }

    public IReadOnlyDictionary<Guid, McpToolCatalogue> GetAllUserCatalogues()
    {
        var result = new Dictionary<Guid, McpToolCatalogue>();
        foreach ((string key, string? _) in keyValues.FindByKeyPrefix(UserCatalogueKeyPrefix) ?? new Dictionary<string, string?>())
        {
            if (Guid.TryParse(key[UserCatalogueKeyPrefix.Length..], out Guid userKey) && GetUserCatalogue(userKey) is { } catalogue)
            {
                result[userKey] = catalogue;
            }
        }

        return result;
    }

    /// <summary>IKeyValueService has no delete, so the row is blanked; readers skip blank values.</summary>
    public void ClearUserCatalogue(Guid userKey) => keyValues.SetValue(UserCatalogueKeyPrefix + userKey.ToString("D"), "");

    /// <summary>Drops entries without a valid level (a hand-edited row), so that product follows the defaults.</summary>
    private static Dictionary<string, McpProductOverride> NormalizeOverrides(Dictionary<string, McpProductOverride?>? stored)
    {
        var result = new Dictionary<string, McpProductOverride>(StringComparer.Ordinal);
        foreach ((string productId, McpProductOverride? value) in stored ?? [])
        {
            if (value is not null && McpToolLevel.IsValid(value.Level))
            {
                result[productId] = value with { DisabledCollections = value.DisabledCollections ?? [] };
            }
        }

        return result;
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
