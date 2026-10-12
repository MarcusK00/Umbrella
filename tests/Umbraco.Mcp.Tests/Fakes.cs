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

    public Exception? Throws { get; init; }

    public IReadOnlyDictionary<string, IReadOnlyList<string>> GetDisabledCollections() => Throws is null ? Disabled : throw Throws;

    public void SetDisabledCollections(IReadOnlyDictionary<string, IReadOnlyList<string>> disabled) =>
        Disabled = new Dictionary<string, IReadOnlyList<string>>(disabled);

    public IReadOnlyList<string> GetReadOnlyModules() => Throws is null ? ReadOnly : throw Throws;

    public void SetReadOnlyModules(IReadOnlyList<string> moduleIds) => ReadOnly = [.. moduleIds];

    public IReadOnlyList<string> GetNoDestructiveModules() => Throws is null ? NoDestructive : throw Throws;

    public void SetNoDestructiveModules(IReadOnlyList<string> moduleIds) => NoDestructive = [.. moduleIds];

    public McpToolCatalogue GetCatalogue() => Throws is null ? Catalogue : throw Throws;

    public void MergeCatalogue(McpCatalogueReport report, DateTimeOffset at) => Merged.Add((report, at));
}

internal sealed class FakeApiUserProvider(params McpApiUser[] users) : IMcpApiUserProvider
{
    public Exception? Throws { get; init; }

    public Task<IReadOnlyList<McpApiUser>> GetConnectedAsync() =>
        Throws is null ? Task.FromResult<IReadOnlyList<McpApiUser>>(users) : throw Throws;
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
