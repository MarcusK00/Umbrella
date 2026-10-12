using Umbraco.Cms.Core.Models.Membership;

namespace Umbraco.Mcp.ApiUser;

/// <summary>An API user the MCP server has connected as, reduced to what the health check needs.</summary>
public sealed record McpApiUser(
    Guid Key,
    string Name,
    UserState State,
    IReadOnlyCollection<string> AllowedSections,
    IReadOnlyCollection<string> ClientIds,
    DateTimeOffset LastConnected);
