namespace Umbraco.Mcp.Detection.Detectors;

public sealed class FormsDetector(ILoadedAssemblyProvider assemblies, IRegisteredApiProvider apis)
    : ProductDetectorBase(assemblies, apis)
{
    public override string Id => "forms";
    public override string DisplayName => "Umbraco Forms";
    protected override string AssemblyName => "Umbraco.Forms.Core";
    protected override string ApiName => "forms-management";
}
