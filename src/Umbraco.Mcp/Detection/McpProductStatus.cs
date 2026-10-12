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
}
