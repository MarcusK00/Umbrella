namespace Umbraco.Mcp.Connections;

/// <summary>
/// Remembers which API users the dashboard's New connection flow created, one entry per user, so the Overview lists
/// them before their MCP server first connects. Each entry's <see cref="McpConnection.LastConnected"/> holds the time
/// the user was created.
/// </summary>
public interface IMcpCreatedUserStore
{
    /// <summary>Records the user. A user already recorded keeps its first time.</summary>
    void Record(Guid userKey, DateTimeOffset at);

    IReadOnlyCollection<McpConnection> GetAll();

    /// <summary>Forgets the user. True when it was recorded.</summary>
    bool Remove(Guid userKey);
}
