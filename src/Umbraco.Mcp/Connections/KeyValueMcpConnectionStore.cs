using System.Globalization;
using Umbraco.Cms.Core.Services;

namespace Umbraco.Mcp.Connections;

/// <summary>
/// Keeps connections in Umbraco's key/value table (<c>umbracoKeyValue</c>), one row per user, so they survive
/// restarts and are shared by every server of a load-balanced site.
/// </summary>
public sealed class KeyValueMcpConnectionStore(IKeyValueService keyValues) : IMcpConnectionStore
{
    internal const string KeyPrefix = "Umbraco.Mcp.Connection.";

    public void Record(Guid userKey, DateTimeOffset at) =>
        keyValues.SetValue(KeyPrefix + userKey.ToString("D"), at.ToString("O", CultureInfo.InvariantCulture));

    /// <summary>
    /// IKeyValueService has no delete, so the row is blanked. <see cref="GetAll"/> skips values that aren't a date,
    /// and the next <see cref="Record"/> writes the row again.
    /// </summary>
    public bool Remove(Guid userKey)
    {
        string key = KeyPrefix + userKey.ToString("D");
        if (!DateTimeOffset.TryParseExact(keyValues.GetValue(key), "O", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
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
            if (Guid.TryParse(key[KeyPrefix.Length..], out Guid userKey)
                && DateTimeOffset.TryParseExact(value, "O", CultureInfo.InvariantCulture, DateTimeStyles.None, out DateTimeOffset at))
            {
                result.Add(new McpConnection(userKey, at));
            }
        }

        return result;
    }
}
