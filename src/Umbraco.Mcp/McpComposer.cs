using Microsoft.Extensions.DependencyInjection;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Client;
using Umbraco.Mcp.Connections;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.Detection.Detectors;
using Umbraco.Mcp.ToolSettings;

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
        builder.Services.AddSingleton<IMcpProductDetector, EngageDetector>();

        builder.Services.AddSingleton<IMcpCapabilitiesService, McpCapabilitiesService>();
        builder.Services.AddSingleton<IMcpConnectionStore, KeyValueMcpConnectionStore>();
        builder.Services.AddSingleton<IMcpToolSettingsStore, KeyValueMcpToolSettingsStore>();
        builder.Services.AddScoped<IMcpApiUserProvider, ConnectedMcpApiUserProvider>();
        builder.Services.AddHostedService<McpJsonWriter>();
    }
}
