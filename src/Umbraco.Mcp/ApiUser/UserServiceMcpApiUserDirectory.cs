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
        var result = new List<McpApiUserInfo>();
        long pageIndex = 0;
        long total;
        do
        {
            // The explicit nulls pick the IQuery overload; the string-filter overload is otherwise ambiguous.
            IEnumerable<IUser> page = users.GetAll(
                pageIndex, PageSize, out total, "Name", Direction.Ascending, null, null, null, (IQuery<IUser>?)null);
            foreach (IUser user in page.Where(u => u.Kind == UserKind.Api))
            {
                result.Add(await ToInfoAsync(user));
            }

            pageIndex++;
        }
        while (pageIndex * PageSize < total);

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
