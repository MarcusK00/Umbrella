using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using NUnit.Framework;
using Umbraco.Mcp.Api;

namespace Umbraco.Mcp.Tests;

/// <summary>
/// Umbraco 18 builds the Management API document with Microsoft.AspNetCore.OpenApi, and its
/// BackOfficeSecurityRequirementsTransformer adds the 401 and 403 responses to every backoffice operation. An action that
/// declares either itself makes the transformer throw ("same key has already been added"), and the whole document,
/// including the backoffice's API docs page, fails with a 500.
/// </summary>
[TestFixture]
public class OpenApiContractTests
{
    [Test]
    public void Controller_actions_leave_401_and_403_to_Umbraco()
    {
        var declared = typeof(McpCapabilitiesController).Assembly.GetTypes()
            .Where(t => typeof(ControllerBase).IsAssignableFrom(t))
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            .SelectMany(m => m.GetCustomAttributes<ProducesResponseTypeAttribute>().Select(a => (m, a.StatusCode)))
            .Where(x => x.StatusCode is 401 or 403)
            .Select(x => $"{x.m.DeclaringType!.Name}.{x.m.Name} declares {x.StatusCode}")
            .ToList();

        Assert.That(declared, Is.Empty);
    }
}
