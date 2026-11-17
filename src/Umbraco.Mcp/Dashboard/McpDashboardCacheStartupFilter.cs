using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace Umbraco.Mcp.Dashboard;

/// <summary>
/// Makes browsers check the "Umbrella" dashboard's files with the site on every load (<c>Cache-Control: no-cache</c>).
/// They are ES modules served without a version in their address, so without it a browser may keep using a module from
/// an earlier add-on version next to newer ones; an import of a name the old module lacks then stops the dashboard from
/// loading at all. Unchanged files are answered with 304 Not Modified, so it costs one small request per file.
/// Registered as a startup filter so it runs before Umbraco's static file middleware.
/// </summary>
internal sealed class McpDashboardCacheStartupFilter : IStartupFilter
{
    internal const string PathPrefix = "/App_Plugins/Umbrella";

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) =>
        app =>
        {
            app.Use((context, nextMiddleware) =>
            {
                if (context.Request.Path.StartsWithSegments(PathPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    context.Response.Headers.CacheControl = "no-cache";
                }

                return nextMiddleware(context);
            });
            next(app);
        };
}
