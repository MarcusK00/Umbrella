using System.Reflection;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Core.Services;
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

    public IReadOnlyCollection<McpConnection> GetAll() => Recorded;
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

    public McpToolCatalogue Catalogue { get; set; } = McpToolCatalogue.Empty;

    public List<(McpCatalogueReport Report, DateTimeOffset At)> Merged { get; } = [];

    public Exception? Throws { get; init; }

    public IReadOnlyDictionary<string, IReadOnlyList<string>> GetDisabledCollections() => Throws is null ? Disabled : throw Throws;

    public void SetDisabledCollections(IReadOnlyDictionary<string, IReadOnlyList<string>> disabled) =>
        Disabled = new Dictionary<string, IReadOnlyList<string>>(disabled);

    public McpToolCatalogue GetCatalogue() => Catalogue;

    public void MergeCatalogue(McpCatalogueReport report, DateTimeOffset at) => Merged.Add((report, at));
}
