using System.Reflection;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Core.Services;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Client;
using Umbraco.Mcp.Connections;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

internal sealed class FakeAssemblies(params (string Name, Assembly Assembly)[] loaded) : ILoadedAssemblyProvider
{
    public Assembly? Find(string assemblyName) =>
        loaded.FirstOrDefault(x => string.Equals(x.Name, assemblyName, StringComparison.OrdinalIgnoreCase)).Assembly;
}

internal sealed class FakeApis(params string[] registered) : IRegisteredApiProvider
{
    public bool IsRegistered(string apiName) => registered.Contains(apiName, StringComparer.OrdinalIgnoreCase);
}

internal sealed class TestDetector(ILoadedAssemblyProvider a, IRegisteredApiProvider r, params string[] extraIssues)
    : ProductDetectorBase(a, r)
{
    public override string Id => "test";
    public override string DisplayName => "Test Product";
    protected override string AssemblyName => "Test.Product.Core";
    protected override string ApiName => "test-management";
    protected override IEnumerable<string> GetIssues() => extraIssues;
}

internal sealed class FakeKeyValueService : IKeyValueService
{
    public Dictionary<string, string?> Values { get; } = new();

    public string? GetValue(string key) => Values.GetValueOrDefault(key);

    public IReadOnlyDictionary<string, string?>? FindByKeyPrefix(string keyPrefix) =>
        Values.Where(x => x.Key.StartsWith(keyPrefix, StringComparison.Ordinal)).ToDictionary(x => x.Key, x => x.Value);

    public void SetValue(string key, string value) => Values[key] = value;

    public void SetValue(string key, string originValue, string newValue) => Values[key] = newValue;

    public bool TrySetValue(string key, string originValue, string newValue)
    {
        Values[key] = newValue;
        return true;
    }
}

internal sealed class FakeConnectionStore : IMcpConnectionStore
{
    public List<McpConnection> Recorded { get; } = [];

    public Exception? Throws { get; init; }

    public void Record(Guid userKey, DateTimeOffset at)
    {
        if (Throws is not null)
        {
            throw Throws;
        }

        Recorded.Add(new McpConnection(userKey, at));
    }

    public List<Guid> Removed { get; } = [];

    public IReadOnlyCollection<McpConnection> GetAll() => Recorded;

    public bool Remove(Guid userKey)
    {
        Removed.Add(userKey);
        return Recorded.RemoveAll(c => c.UserKey == userKey) > 0;
    }
}

internal sealed class FakeBackOfficeSecurityAccessor(IUser? currentUser) : IBackOfficeSecurityAccessor, IBackOfficeSecurity
{
    public IBackOfficeSecurity? BackOfficeSecurity => this;

    public IUser? CurrentUser => currentUser;

    public bool UserHasSectionAccess(string section, IUser user) => false;

    public bool IsAuthenticated() => currentUser is not null;
}

internal sealed class FakeToolSettingsStore : IMcpToolSettingsStore
{
    public Dictionary<string, IReadOnlyList<string>> Disabled { get; set; } = new();

    public List<string> ReadOnly { get; set; } = [];

    public List<string> NoDestructive { get; set; } = [];

    public McpToolCatalogue Catalogue { get; set; } = McpToolCatalogue.Empty;

    public List<(McpCatalogueReport Report, DateTimeOffset At)> Merged { get; } = [];

    public Dictionary<Guid, IReadOnlyDictionary<string, McpProductOverride>> UserOverrides { get; set; } = new();

    public Dictionary<Guid, McpToolCatalogue> UserCatalogues { get; set; } = new();

    public List<Guid> ClearedCatalogues { get; } = [];

    public Exception? Throws { get; init; }

    /// <summary>Makes only the per-user getters throw, so tests can check the defaults still read fine.</summary>
    public Exception? UserReadsThrow { get; init; }

    public IReadOnlyDictionary<string, IReadOnlyList<string>> GetDisabledCollections() => Throws is null ? Disabled : throw Throws;

    public void SetDisabledCollections(IReadOnlyDictionary<string, IReadOnlyList<string>> disabled) =>
        Disabled = new Dictionary<string, IReadOnlyList<string>>(disabled);

    public IReadOnlyList<string> GetReadOnlyModules() => Throws is null ? ReadOnly : throw Throws;

    public void SetReadOnlyModules(IReadOnlyList<string> moduleIds) => ReadOnly = [.. moduleIds];

    public IReadOnlyList<string> GetNoDestructiveModules() => Throws is null ? NoDestructive : throw Throws;

    public void SetNoDestructiveModules(IReadOnlyList<string> moduleIds) => NoDestructive = [.. moduleIds];

    public McpToolCatalogue GetCatalogue() => Throws is null ? Catalogue : throw Throws;

    public void MergeCatalogue(McpCatalogueReport report, DateTimeOffset at) => Merged.Add((report, at));

    public IReadOnlyDictionary<string, McpProductOverride> GetUserOverrides(Guid userKey) =>
        UserReadsThrow is not null
            ? throw UserReadsThrow
            : UserOverrides.GetValueOrDefault(userKey) ?? new Dictionary<string, McpProductOverride>();

    public void SetUserOverrides(Guid userKey, IReadOnlyDictionary<string, McpProductOverride> overrides)
    {
        if (overrides.Count == 0)
        {
            UserOverrides.Remove(userKey);
        }
        else
        {
            UserOverrides[userKey] = new Dictionary<string, McpProductOverride>(overrides);
        }
    }

    public IReadOnlyDictionary<Guid, IReadOnlyDictionary<string, McpProductOverride>> GetAllUserOverrides() =>
        UserReadsThrow is not null ? throw UserReadsThrow : UserOverrides.Where(x => x.Value.Count > 0).ToDictionary(x => x.Key, x => x.Value);

    public McpToolCatalogue? GetUserCatalogue(Guid userKey) =>
        UserReadsThrow is not null ? throw UserReadsThrow : UserCatalogues.GetValueOrDefault(userKey);

    public void SetUserCatalogue(Guid userKey, McpCatalogueReport report, DateTimeOffset at) =>
        UserCatalogues[userKey] = new McpToolCatalogue(
            report.UmbrellaVersion,
            report.Modules.ToDictionary(m => m.Id, m => new McpModuleCatalogue(at, m.SiteSettingsIgnored, m.Collections)));

    public IReadOnlyDictionary<Guid, McpToolCatalogue> GetAllUserCatalogues() =>
        UserReadsThrow is not null ? throw UserReadsThrow : new Dictionary<Guid, McpToolCatalogue>(UserCatalogues);

    public void ClearUserCatalogue(Guid userKey)
    {
        UserCatalogues.Remove(userKey);
        ClearedCatalogues.Add(userKey);
    }
}

internal sealed class FakeApiUserProvider(params McpApiUser[] users) : IMcpApiUserProvider
{
    public Exception? Throws { get; init; }

    public Task<IReadOnlyList<McpApiUser>> GetConnectedAsync() =>
        Throws is null ? Task.FromResult<IReadOnlyList<McpApiUser>>(users) : throw Throws;
}

internal sealed class FakeApiUserDirectory(params McpApiUserInfo[] users) : IMcpApiUserDirectory
{
    public Task<IReadOnlyList<McpApiUserInfo>> GetAllAsync() =>
        Task.FromResult<IReadOnlyList<McpApiUserInfo>>(users.OrderBy(u => u.Name, StringComparer.OrdinalIgnoreCase).ToList());

    public Task<McpApiUserInfo?> GetAsync(Guid key) => Task.FromResult(users.FirstOrDefault(u => u.Key == key));
}

internal sealed class FakeMcpJsonFile(bool isAvailable = false, string? path = null) : IMcpJsonFile
{
    public bool IsAvailable => isAvailable;

    public string? Path => path;

    public Exception? Throws { get; init; }

    public int Writes { get; private set; }

    public McpJsonResult WriteOrUpgrade()
    {
        Writes++;
        return Throws is null ? new(McpJsonOutcome.Written, path ?? "", "Wrote it.") : throw Throws;
    }
}
