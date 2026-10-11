namespace Umbraco.Mcp.Detection.Detectors;

public sealed class AutomateDetector(ILoadedAssemblyProvider assemblies, IRegisteredApiProvider apis)
    : ProductDetectorBase(assemblies, apis)
{
    public override string Id => "automate";
    public override string DisplayName => "Umbraco Automate";
    protected override string AssemblyName => "Umbraco.Automate.Core";
    protected override string ApiName => "automate-management";
    public override string? SectionAlias => "Ua.Section.Automate";
}
