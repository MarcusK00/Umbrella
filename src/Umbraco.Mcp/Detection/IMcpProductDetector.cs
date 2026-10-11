namespace Umbraco.Mcp.Detection;

/// <summary>
/// Detects one Umbraco HQ product. <see cref="Id"/> must equal the matching npm module id (e.g. "forms").
/// </summary>
public interface IMcpProductDetector
{
    string Id { get; }

    string DisplayName { get; }

    McpProductStatus Detect();
}
