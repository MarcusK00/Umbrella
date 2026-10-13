namespace Umbraco.Mcp.Detection;

public sealed record McpProductStatus(
    string Id,
    string DisplayName,
    bool Installed,
    bool Enabled,
    string? Version,
    IReadOnlyList<string> Issues)
{
    /// <summary>
    /// Tool groups switched off in the backoffice. The npm server excludes them unless its environment overrides it.
    /// Null when the site has no saved list for this product; the npm server then applies its default-off groups.
    /// </summary>
    public IReadOnlyList<string>? DisabledCollections { get; init; }

    /// <summary>Set in the backoffice: the npm server registers only this product's read-only tools.</summary>
    public bool ReadOnly { get; init; }

    /// <summary>Set in the backoffice: the npm server leaves out this product's destructive tools. Read-only wins when both are set.</summary>
    public bool NoDestructive { get; init; }

    /// <summary>
    /// Whose settings the three values above are: "site" for the defaults, "user" when the calling API user has its own
    /// settings for this product. The npm server treats a missing or unknown value as "site".
    /// </summary>
    public string SettingsScope { get; init; } = McpSettingsScope.Site;
}

/// <summary>The values of <see cref="McpProductStatus.SettingsScope"/>.</summary>
public static class McpSettingsScope
{
    public const string Site = "site";
    public const string User = "user";
}
