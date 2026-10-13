namespace Umbraco.Mcp.Client;

/// <summary>An API user whose client id the Overview can fill the client config with.</summary>
public sealed record McpClientSetupUser(Guid Key, string Name, IReadOnlyList<string> ClientIds);

/// <summary>
/// The Overview's "Connect an AI tool": the client config filled in with <paramref name="ClientId"/>, the configured
/// client id (<c>Umbraco:Mcp:ClientId</c>), and the API users with a client id to pick from.
/// </summary>
public sealed record McpClientSetup(
    string ClientId,
    string ConfiguredClientId,
    IReadOnlyList<McpClientSetupUser> ApiUsers,
    IReadOnlyList<McpClientSnippet> Clients);
