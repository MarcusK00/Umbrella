using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using NUnit.Framework;
using Umbraco.Mcp.Dashboard;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpDashboardCacheStartupFilterTests
{
    /// <summary>Runs a request through the filter's middleware in front of a terminal that records it was reached.</summary>
    private static async Task<(HttpContext Context, bool Reached)> Run(string path)
    {
        bool reached = false;
        var app = new ApplicationBuilder(new ServiceCollection().BuildServiceProvider());
        new McpDashboardCacheStartupFilter().Configure(builder => builder.Run(_ =>
        {
            reached = true;
            return Task.CompletedTask;
        }))(app);
        RequestDelegate pipeline = app.Build();

        var context = new DefaultHttpContext();
        context.Request.Path = path;
        await pipeline(context);
        return (context, reached);
    }

    [TestCase("/App_Plugins/Umbrella/umbrella-api.js")]
    [TestCase("/App_Plugins/Umbrella/umbraco-package.json")]
    [TestCase("/app_plugins/umbrella/umbrella-overview.js")]
    public async Task Dashboard_files_are_revalidated_on_every_load(string path)
    {
        (HttpContext context, bool reached) = await Run(path);

        Assert.That(context.Response.Headers.CacheControl.ToString(), Is.EqualTo("no-cache"));
        Assert.That(reached, Is.True);
    }

    [TestCase("/App_Plugins/UmbrellaOther/x.js")]
    [TestCase("/App_Plugins/Other/umbrella-api.js")]
    [TestCase("/umbraco/management/api/v1/mcp/overview")]
    [TestCase("/")]
    public async Task Other_requests_are_left_alone(string path)
    {
        (HttpContext context, bool reached) = await Run(path);

        Assert.That(context.Response.Headers.ContainsKey("Cache-Control"), Is.False);
        Assert.That(reached, Is.True);
    }
}
