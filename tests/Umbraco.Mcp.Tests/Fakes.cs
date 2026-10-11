using System.Reflection;
using Umbraco.Mcp.Detection;

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
