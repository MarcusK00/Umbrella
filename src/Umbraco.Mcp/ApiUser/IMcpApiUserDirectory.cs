using Umbraco.Cms.Core.Models.Membership;

namespace Umbraco.Mcp.ApiUser;

/// <summary>
/// An API user of the site, whether or not its MCP server has ever connected. <paramref name="AllowedSections"/> holds
/// the section names its user groups grant; null when they were not read.
/// </summary>
public sealed record McpApiUserInfo(
    Guid Key,
    string Name,
    UserState State,
    IReadOnlyList<string> ClientIds,
    IReadOnlyCollection<string>? AllowedSections = null);

/// <summary>The site's API users (users of kind API), for choosing whose tool settings to edit.</summary>
public interface IMcpApiUserDirectory
{
    /// <summary>Every API user, sorted by name (ordinal, ignoring case).</summary>
    Task<IReadOnlyList<McpApiUserInfo>> GetAllAsync();

    /// <summary>The API user with this key. Null when there is none, or the user is not an API user.</summary>
    Task<McpApiUserInfo?> GetAsync(Guid key);
}
