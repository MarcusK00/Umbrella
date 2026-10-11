namespace Umbraco.Mcp.ApiUser;

public interface IMcpApiUserProvider
{
    /// <summary>
    /// The API users the MCP server has connected as, most recent first. Users that no longer exist are left out.
    /// </summary>
    Task<IReadOnlyList<McpApiUser>> GetConnectedAsync();
}
