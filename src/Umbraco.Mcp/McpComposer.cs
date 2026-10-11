using Microsoft.Extensions.DependencyInjection;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.Detection.Detectors;

namespace Umbraco.Mcp;

public sealed class McpComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        builder.Services.AddSingleton<ILoadedAssemblyProvider, AppDomainLoadedAssemblyProvider>();
        builder.Services.AddSingleton<IRegisteredApiProvider, ActionDescriptorRegisteredApiProvider>();

        // One line per product. Order here is the order products appear in capabilities and health.
        builder.Services.AddSingleton<IMcpProductDetector, CmsDetector>();
        builder.Services.AddSingleton<IMcpProductDetector, FormsDetector>();
        builder.Services.AddSingleton<IMcpProductDetector, AutomateDetector>();

        builder.Services.AddSingleton<IMcpCapabilitiesService, McpCapabilitiesService>();
    }
}
