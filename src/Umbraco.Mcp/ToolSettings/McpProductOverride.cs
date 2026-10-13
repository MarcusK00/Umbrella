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
/// empty <paramref name="DisabledCollections"/> means every tool group is on.
/// </summary>
public sealed record McpProductOverride(IReadOnlyList<string> DisabledCollections, string Level);
