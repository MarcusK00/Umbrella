namespace Umbraco.Mcp.ToolSettings;

/// <summary>The tool level a product's tools are limited to.</summary>
public static class McpToolLevel
{
    public const string Full = "full";
    public const string NoDestructive = "noDestructive";
    public const string ReadOnly = "readOnly";

    /// <summary>The npm server does not load the product at all.</summary>
    public const string Off = "off";

    public static bool IsValid(string? level) => level is Full or NoDestructive or ReadOnly or Off;
}

/// <summary>
/// One API user's own settings for one product. They replace the site defaults for that product, all or nothing: an
/// empty <paramref name="DisabledCollections"/> means every tool group is on. <paramref name="DisabledTools"/> are the
/// switched-off tools (unprefixed names); null in rows stored before they existed, which readers treat as none.
/// </summary>
public sealed record McpProductOverride(IReadOnlyList<string> DisabledCollections, string Level, IReadOnlyList<string>? DisabledTools = null);
