namespace Umbraco.Mcp.ApiUser;

public interface IMcpApiUserProvider
{
    /// <summary>The client id the MCP server signs in with (<c>Umbraco:Mcp:ClientId</c>).</summary>
    string ClientId { get; }

    /// <summary>The user that owns <see cref="ClientId"/>, or null when no user has it.</summary>
    Task<McpApiUser?> FindAsync();
}
