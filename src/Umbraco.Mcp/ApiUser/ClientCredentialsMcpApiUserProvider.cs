using Microsoft.Extensions.Configuration;
using Umbraco.Cms.Api.Management.Mapping;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Core.Services;

namespace Umbraco.Mcp.ApiUser;

public sealed class ClientCredentialsMcpApiUserProvider(
    IConfiguration configuration,
    IBackOfficeUserClientCredentialsManager clientCredentials,
    IUserService users) : IMcpApiUserProvider
{
    public const string DefaultClientId = "umbraco-back-office-mcp";

    public string ClientId => configuration["Umbraco:Mcp:ClientId"] is { Length: > 0 } id ? id : DefaultClientId;

    public async Task<McpApiUser?> FindAsync()
    {
        var identity = await clientCredentials.FindUserAsync(ClientId);
        if (identity is null)
        {
            return null;
        }

        IUser? user = await users.GetAsync(identity.Key);
        return user is null ? null : new McpApiUser(user.Name ?? user.Username, user.UserState, ToSectionNames(user.AllowedSections));
    }

    /// <summary>
    /// The database keeps some sections under legacy aliases (Forms stores "forms"), while products such as Automate
    /// store their backoffice name. Map them the way the Management API does, so they match <c>SectionAlias</c>.
    /// </summary>
    internal static IReadOnlyCollection<string> ToSectionNames(IEnumerable<string> aliases) =>
        aliases.Select(SectionMapper.GetName).ToList();
}
