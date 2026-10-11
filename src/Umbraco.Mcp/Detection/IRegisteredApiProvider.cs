using System.Reflection;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Umbraco.Cms.Api.Common.Attributes;

namespace Umbraco.Mcp.Detection;

public interface IRegisteredApiProvider
{
    bool IsRegistered(string apiName);
}

/// <summary>
/// An API is "registered" when at least one live controller action maps to it via Umbraco's [MapToApi].
/// </summary>
internal sealed class ActionDescriptorRegisteredApiProvider(IActionDescriptorCollectionProvider actions) : IRegisteredApiProvider
{
    public bool IsRegistered(string apiName) =>
        actions.ActionDescriptors.Items
            .OfType<ControllerActionDescriptor>()
            .Any(d => d.ControllerTypeInfo
                .GetCustomAttributes<MapToApiAttribute>(inherit: true)
                .Any(a => string.Equals(a.ApiName, apiName, StringComparison.OrdinalIgnoreCase)));
}
