namespace Umbraco.Mcp.Connections;

/// <summary>Remembers which API users the MCP server has connected as, one entry per user.</summary>
public interface IMcpConnectionStore
{
    void Record(Guid userKey, DateTimeOffset at);

    IReadOnlyCollection<McpConnection> GetAll();
}
