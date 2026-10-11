namespace Umbraco.Mcp.Connections;

/// <summary>The last time the MCP server connected to the site as the API user with this key.</summary>
public sealed record McpConnection(Guid UserKey, DateTimeOffset LastConnected);
