using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.Capabilities;

public sealed record McpCapabilities(string AddonVersion, IReadOnlyList<McpProductStatus> Products);
