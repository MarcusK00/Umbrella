using Umbraco.Cms.Core.Models.Membership;

namespace Umbraco.Mcp.ApiUser;

/// <summary>
/// An API user the MCP server has connected as, reduced to what the health check and the Overview need.
/// <paramref name="Groups"/> holds the names of its user groups; null when they were not read.
/// </summary>
public sealed record McpApiUser(
    Guid Key,
    string Name,
    UserState State,
    IReadOnlyCollection<string> AllowedSections,
    IReadOnlyCollection<string> ClientIds,
    DateTimeOffset LastConnected,
    IReadOnlyList<string>? Groups = null);
