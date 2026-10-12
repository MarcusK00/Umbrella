namespace Umbraco.Mcp.Connections;

/// <summary>Remembers which API users the MCP server has connected as, one entry per user.</summary>
public interface IMcpConnectionStore
{
    void Record(Guid userKey, DateTimeOffset at);

    IReadOnlyCollection<McpConnection> GetAll();

    /// <summary>Forgets a user's connection. True when there was one to forget.</summary>
    bool Remove(Guid userKey);
}
