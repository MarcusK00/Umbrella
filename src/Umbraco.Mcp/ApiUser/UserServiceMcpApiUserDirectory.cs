using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Persistence.Querying;
using Umbraco.Cms.Core.Services;

namespace Umbraco.Mcp.ApiUser;

public sealed class UserServiceMcpApiUserDirectory(IUserService users) : IMcpApiUserDirectory
{
    private const int PageSize = 100;

    public async Task<IReadOnlyList<McpApiUserInfo>> GetAllAsync()
    {
        // Paging is ordered by name only, so users with the same name can straddle a page boundary and show up twice.
        var apiUsers = new Dictionary<Guid, IUser>();
        long pageIndex = 0;
        long total;
        do
        {
            // The explicit nulls pick the IQuery overload; the string-filter overload is otherwise ambiguous.
            IEnumerable<IUser> page = users.GetAll(
                pageIndex, PageSize, out total, "Name", Direction.Ascending, null, null, null, (IQuery<IUser>?)null);
            foreach (IUser user in page.Where(u => u.Kind == UserKind.Api))
            {
                apiUsers.TryAdd(user.Key, user);
            }

            pageIndex++;
        }
        while (pageIndex * PageSize < total);

        var result = new List<McpApiUserInfo>();
        foreach (IUser user in apiUsers.Values)
        {
            result.Add(await ToInfoAsync(user));
        }

        return result.OrderBy(u => u.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public async Task<McpApiUserInfo?> GetAsync(Guid key)
    {
        IUser? user = await users.GetAsync(key);
        return user is { Kind: UserKind.Api } ? await ToInfoAsync(user) : null;
    }

    private async Task<McpApiUserInfo> ToInfoAsync(IUser user)
    {
        IEnumerable<string> clientIds = await users.GetClientIdsAsync(user.Key);
        return new McpApiUserInfo(user.Key, user.Name ?? user.Username, user.UserState, clientIds.ToList());
    }
}
