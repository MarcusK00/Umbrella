using Umbraco.Cms.Core.Models.Membership;

namespace Umbraco.Mcp.ApiUser;

/// <summary>The backoffice user behind the MCP's client id, reduced to what the health check needs.</summary>
public sealed record McpApiUser(string Name, UserState State, IReadOnlyCollection<string> AllowedSections);
