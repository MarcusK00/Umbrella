using System.Reflection;

namespace Umbraco.Mcp.Detection;

public interface ILoadedAssemblyProvider
{
    Assembly? Find(string assemblyName);
}

internal sealed class AppDomainLoadedAssemblyProvider : ILoadedAssemblyProvider
{
    public Assembly? Find(string assemblyName) =>
        AppDomain.CurrentDomain.GetAssemblies()
            .FirstOrDefault(a => string.Equals(a.GetName().Name, assemblyName, StringComparison.OrdinalIgnoreCase));
}
