using System.Globalization;
using Umbraco.Cms.Core.Services;

namespace Umbraco.Mcp.Connections;

/// <summary>
/// Keeps the users the New connection flow created in Umbraco's key/value table (<c>umbracoKeyValue</c>), one row per
/// user like the connections, so two admins creating users at once never overwrite each other.
/// </summary>
public sealed class KeyValueMcpCreatedUserStore(IKeyValueService keyValues) : IMcpCreatedUserStore
{
    internal const string KeyPrefix = "Umbraco.Mcp.CreatedApiUser.";

    public void Record(Guid userKey, DateTimeOffset at)
    {
        string key = Key(userKey);
        if (TryParse(keyValues.GetValue(key), out _))
        {
            return;
        }

        keyValues.SetValue(key, at.ToString("O", CultureInfo.InvariantCulture));
    }

    /// <summary>IKeyValueService has no delete, so the row is blanked; <see cref="GetAll"/> skips it.</summary>
    public bool Remove(Guid userKey)
    {
        string key = Key(userKey);
        if (!TryParse(keyValues.GetValue(key), out _))
        {
            return false;
        }

        keyValues.SetValue(key, "");
        return true;
    }

    public IReadOnlyCollection<McpConnection> GetAll()
    {
        var result = new List<McpConnection>();
        foreach ((string key, string? value) in keyValues.FindByKeyPrefix(KeyPrefix) ?? new Dictionary<string, string?>())
        {
            if (Guid.TryParse(key[KeyPrefix.Length..], out Guid userKey) && TryParse(value, out DateTimeOffset at))
            {
                result.Add(new McpConnection(userKey, at));
            }
        }

        return result;
    }

    private static string Key(Guid userKey) => KeyPrefix + userKey.ToString("D");

    private static bool TryParse(string? value, out DateTimeOffset at) =>
        DateTimeOffset.TryParseExact(value, "O", CultureInfo.InvariantCulture, DateTimeStyles.None, out at);
}
