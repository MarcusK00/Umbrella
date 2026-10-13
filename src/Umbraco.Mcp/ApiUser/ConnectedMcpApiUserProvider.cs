using Umbraco.Cms.Api.Management.Mapping;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Services;
using Umbraco.Mcp.Connections;

namespace Umbraco.Mcp.ApiUser;

public sealed class ConnectedMcpApiUserProvider(IMcpConnectionStore connections, IUserService users) : IMcpApiUserProvider
{
    public async Task<IReadOnlyList<McpApiUser>> GetConnectedAsync()
    {
        var result = new List<McpApiUser>();
        foreach (McpConnection connection in connections.GetAll().OrderByDescending(c => c.LastConnected))
        {
            IUser? user = await users.GetAsync(connection.UserKey);
            // A connection row outlives its user being deleted, or turned into a normal backoffice user.
            if (user is null || user.Kind != UserKind.Api)
            {
                continue;
            }

            IEnumerable<string> clientIds = await users.GetClientIdsAsync(user.Key);
            result.Add(new McpApiUser(
                user.Key,
                user.Name ?? user.Username,
                user.UserState,
                ToSectionNames(user.AllowedSections),
                clientIds.ToList(),
                connection.LastConnected));
        }

        return result;
    }

    /// <summary>
    /// The database keeps some sections under legacy aliases (Forms stores "forms"), while products such as Automate
    /// store their backoffice name. Map them the way the Management API does, so they match <c>SectionAlias</c>.
    /// </summary>
    internal static IReadOnlyCollection<string> ToSectionNames(IEnumerable<string> aliases) =>
        aliases.Select(SectionMapper.GetName).ToList();
}
