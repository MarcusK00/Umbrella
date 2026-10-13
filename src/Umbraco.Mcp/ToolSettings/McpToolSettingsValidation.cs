using Umbraco.Mcp.Api;
using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.ToolSettings;

/// <summary>Normalises and size-caps what clients send, so a stray client cannot bloat the key/value table.</summary>
internal static class McpToolSettingsValidation
{
    public const int MaxModules = 50;
    public const int MaxCollections = 200;
    public const int MaxNameLength = 100;

    /// <returns>An error message, or null when <paramref name="result"/> holds the normalised lists.</returns>
    public static string? TryNormalizeSettings(
        IReadOnlyDictionary<string, IReadOnlyList<string>?>? input,
        ISet<string> knownModuleIds,
        out Dictionary<string, IReadOnlyList<string>> result)
    {
        result = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        if (input is null)
        {
            return "disabledCollections is required.";
        }

        if (input.Count > MaxModules)
        {
            return $"At most {MaxModules} modules are allowed.";
        }

        foreach ((string id, IReadOnlyList<string>? names) in input)
        {
            if (!knownModuleIds.Contains(id))
            {
                return $"\"{id}\" is not a product this site detects.";
            }

            string? error = TryNormalizeNames(names, out List<string> clean);
            if (error is not null)
            {
                return $"{id}: {error}";
            }

            result[id] = clean;
        }

        return null;
    }

    /// <returns>An error message, or null when <paramref name="result"/> holds the normalised per-user overrides.</returns>
    public static string? TryNormalizeOverrides(
        IReadOnlyDictionary<string, McpProductOverrideRequest?>? input,
        ISet<string> knownModuleIds,
        out Dictionary<string, McpProductOverride> result)
    {
        result = new Dictionary<string, McpProductOverride>(StringComparer.Ordinal);
        if (input is null)
        {
            return "overrides is required.";
        }

        if (input.Count > MaxModules)
        {
            return $"At most {MaxModules} modules are allowed.";
        }

        foreach ((string id, McpProductOverrideRequest? entry) in input)
        {
            if (!knownModuleIds.Contains(id))
            {
                return $"\"{id}\" is not a product this site detects.";
            }

            if (entry?.DisabledCollections is null)
            {
                return $"{id}: an override needs disabledCollections and level.";
            }

            if (!McpToolLevel.IsValid(entry.Level))
            {
                return $"{id}: level must be \"full\", \"noDestructive\", \"readOnly\" or \"off\".";
            }

            if (entry.Level == McpToolLevel.Off && CheckRequiredNotOff([id]) is { } requiredError)
            {
                return $"{id}: {requiredError}";
            }

            string? error = TryNormalizeNames(entry.DisabledCollections, out List<string> clean);
            if (error is not null)
            {
                return $"{id}: {error}";
            }

            result[id] = new McpProductOverride(clean, entry.Level!);
        }

        return null;
    }

    /// <returns>An error message, or null when <paramref name="result"/> holds the normalised report.</returns>
    public static string? TryNormalizeReport(McpCatalogueReport? report, out McpCatalogueReport result)
    {
        result = new McpCatalogueReport(string.Empty, []);
        if (report?.Modules is null)
        {
            return "modules is required.";
        }

        if (report.Modules.Count > MaxModules)
        {
            return $"At most {MaxModules} modules are allowed.";
        }

        var modules = new List<McpModuleReport>();
        foreach (McpModuleReport? module in report.Modules)
        {
            string id = module?.Id?.Trim() ?? string.Empty;
            if (id.Length == 0 || id.Length > MaxNameLength)
            {
                return $"Module ids must be 1 to {MaxNameLength} characters.";
            }

            IReadOnlyList<McpCollectionInfo> collections = module!.Collections ?? [];
            string? error = TryNormalizeNames(collections.Select(c => c?.Name).ToList(), out List<string> names);
            if (error is not null)
            {
                return $"{id}: {error}";
            }

            var byName = collections.Where(c => c?.Name is not null).GroupBy(c => c.Name.Trim()).ToDictionary(g => g.Key, g => NormalizeCounts(g.Key, g.First()));
            modules.Add(new McpModuleReport(id, module.SiteSettingsIgnored, names.Select(n => byName[n]).ToList()));
        }

        string version = report.UmbrellaVersion?.Trim() ?? string.Empty;
        result = new McpCatalogueReport(version.Length > MaxNameLength ? version[..MaxNameLength] : version, modules);
        return null;
    }

    /// <returns>An error message, or null when <paramref name="result"/> holds the trimmed, distinct module ids.</returns>
    public static string? TryNormalizeModuleIds(IReadOnlyList<string?>? input, ISet<string> knownModuleIds, string field, out List<string> result)
    {
        result = (input ?? []).Where(n => n is not null).Select(n => n!.Trim()).Where(n => n.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        string? unknown = result.FirstOrDefault(id => !knownModuleIds.Contains(id));
        return unknown is null ? null : $"{field}: \"{unknown}\" is not a product this site detects.";
    }

    /// <returns>An error message when a product is in both lists, otherwise null.</returns>
    /// <returns>An error message when a product is in more than one level list, else null.</returns>
    public static string? CheckLevelOverlap(IReadOnlyList<string> off, IReadOnlyList<string> readOnly, IReadOnlyList<string> noDestructive)
    {
        var offAndLimited = off.Intersect(readOnly.Concat(noDestructive), StringComparer.Ordinal).ToList();
        if (offAndLimited.Count > 0)
        {
            return $"A product that is off cannot also be read-only or limited to non-destructive tools: {string.Join(", ", offAndLimited)}.";
        }

        var both = readOnly.Intersect(noDestructive, StringComparer.Ordinal).ToList();
        return both.Count == 0 ? null : $"A product cannot be both read-only and limited to non-destructive tools: {string.Join(", ", both)}.";
    }

    /// <returns>An error message when <paramref name="offIds"/> contains the product the npm server cannot run without, else null.</returns>
    public static string? CheckRequiredNotOff(IEnumerable<string> offIds) =>
        offIds.Contains(McpProducts.RequiredId, StringComparer.Ordinal)
            ? "CMS cannot be switched off: the MCP server signs in through it."
            : null;

    private static McpCollectionInfo NormalizeCounts(string name, McpCollectionInfo info)
    {
        int toolCount = Math.Max(0, info.ToolCount);
        return new McpCollectionInfo(
            name,
            toolCount,
            info.ReadOnlyToolCount is int readOnly ? Math.Clamp(readOnly, 0, toolCount) : null,
            info.DisabledByDefault,
            info.NonDestructiveToolCount is int nonDestructive ? Math.Clamp(nonDestructive, 0, toolCount) : null);
    }

    private static string? TryNormalizeNames(IReadOnlyList<string?>? names, out List<string> clean)
    {
        clean = (names ?? []).Where(n => n is not null).Select(n => n!.Trim()).Where(n => n.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        if (clean.Count > MaxCollections)
        {
            return $"At most {MaxCollections} collections are allowed.";
        }

        return clean.Any(n => n.Length > MaxNameLength) ? $"Collection names must be at most {MaxNameLength} characters." : null;
    }
}
