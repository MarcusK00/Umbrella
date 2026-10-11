namespace Umbraco.Mcp.Detection;

/// <summary>
/// Detects one Umbraco HQ product. <see cref="Id"/> must equal the matching npm module id (e.g. "forms").
/// </summary>
public interface IMcpProductDetector
{
    string Id { get; }

    string DisplayName { get; }

    /// <summary>Backoffice section the MCP API user needs for this product's tools, or null when none is required.</summary>
    string? SectionAlias { get; }

    McpProductStatus Detect();
}
