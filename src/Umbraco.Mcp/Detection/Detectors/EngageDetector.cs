namespace Umbraco.Mcp.Detection.Detectors;

public sealed class EngageDetector(ILoadedAssemblyProvider assemblies, IRegisteredApiProvider apis)
    : ProductDetectorBase(assemblies, apis)
{
    public override string Id => "engage";
    public override string DisplayName => "Umbraco Engage";
    protected override string AssemblyName => "Umbraco.Engage.Core";
    protected override string ApiName => "engage-management";
    public override string? SectionAlias => "Umb.Section.Engage";
}
