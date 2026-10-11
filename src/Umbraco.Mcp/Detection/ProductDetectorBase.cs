using System.Reflection;

namespace Umbraco.Mcp.Detection;

/// <summary>
/// Installed = <see cref="AssemblyName"/> is loaded. Enabled = the product's Management API (<see cref="ApiName"/>) is live.
/// Concrete detectors only declare these four values.
/// </summary>
public abstract class ProductDetectorBase : IMcpProductDetector
{
    private readonly ILoadedAssemblyProvider _assemblies;
    private readonly IRegisteredApiProvider _apis;

    protected ProductDetectorBase(ILoadedAssemblyProvider assemblies, IRegisteredApiProvider apis)
    {
        _assemblies = assemblies;
        _apis = apis;
    }

    public abstract string Id { get; }

    public abstract string DisplayName { get; }

    public virtual string? SectionAlias => null;

    protected abstract string AssemblyName { get; }

    protected abstract string ApiName { get; }

    /// <summary>Extension point for product-specific checks (e.g. licence, main switch). Empty by default.</summary>
    protected virtual IEnumerable<string> GetIssues() => [];

    public McpProductStatus Detect()
    {
        Assembly? assembly = _assemblies.Find(AssemblyName);
        if (assembly is null)
        {
            return new McpProductStatus(Id, DisplayName, false, false, null, []);
        }

        bool enabled = _apis.IsRegistered(ApiName);
        var issues = new List<string>();
        if (!enabled)
        {
            issues.Add($"The {ApiName} Management API is not registered.");
        }

        issues.AddRange(GetIssues());

        return new McpProductStatus(Id, DisplayName, true, enabled, AssemblyVersionReader.Read(assembly), issues);
    }
}
