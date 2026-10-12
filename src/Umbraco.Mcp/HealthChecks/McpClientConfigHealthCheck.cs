using System.Globalization;
using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.Client;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.HealthChecks;

[HealthCheck(
    "0c7e5a91-2d4b-4f63-8e1a-9b5d3c7f2e48",
    "MCP client setup",
    Description = "Shows the configuration to paste into an AI tool so it can connect to this site through the Umbraco MCP, " +
        "and whether the MCP server it last started is the add-on's version.",
    Group = "MCP")]
public sealed class McpClientConfigHealthCheck(
    IConfiguration configuration,
    IHttpContextAccessor httpContextAccessor,
    IMcpToolSettingsStore toolSettings,
    ILogger<McpClientConfigHealthCheck> logger) : HealthCheck
{
    internal const string SecretPlaceholder = "<the client secret you saved when creating the API user>";

    internal const string SiteUrlPlaceholder = "https://your-site";

    public override Task<IEnumerable<HealthCheckStatus>> GetStatusAsync() =>
        Task.FromResult(BuildStatuses(GetSiteUrl(), McpClientConfig.ReadClientId(configuration), SafeCatalogue(), McpAddon.Version));

    public override HealthCheckStatus ExecuteAction(HealthCheckAction action) =>
        throw new InvalidOperationException("The MCP client setup health check has no actions.");

    private McpToolCatalogue SafeCatalogue()
    {
        try
        {
            return toolSettings.GetCatalogue();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read what the MCP server last reported. The MCP client setup check leaves out its version.");
            return McpToolCatalogue.Empty;
        }
    }

    private string? GetSiteUrl()
    {
        HttpRequest? request = httpContextAccessor.HttpContext?.Request;
        return request is null || !request.Host.HasValue
            ? null
            : $"{request.Scheme}://{request.Host}{request.PathBase}";
    }

    /// <summary>
    /// The backoffice renders health check messages as HTML, so the snippet goes in a pre block and every
    /// configured value is HTML-encoded. The client secret is never shown: Umbraco only stores its hash.
    /// </summary>
    internal static IEnumerable<HealthCheckStatus> BuildStatuses(string? siteUrl, string clientId, McpToolCatalogue catalogue, string addonVersion)
    {
        string json = McpClientConfig.Build(
            "npx",
            McpClientConfig.NpxArgs(McpAddon.Version),
            [
                new("UMBRACO_BASE_URL", siteUrl ?? SiteUrlPlaceholder),
                new("UMBRACO_CLIENT_ID", clientId),
                new("UMBRACO_CLIENT_SECRET", SecretPlaceholder),
            ]);

        var rows = new List<HealthCheckStatus>
        {
            new("Add this to your AI tool's MCP configuration to connect it to this site. " +
                "Replace the secret with the one you saved when you created the API user." +
                $"<pre><code>{WebUtility.HtmlEncode(json)}</code></pre>")
                { ResultType = StatusResultType.Info },
        };

        if (BuildVersionStatus(catalogue, addonVersion) is { } versionRow)
        {
            rows.Add(versionRow);
        }

        return rows;
    }

    /// <summary>
    /// The MCP server reports its version when it starts. The two halves are released together, so a different
    /// version usually means the AI tool's config still pins the umbrella-mcp of an earlier add-on.
    /// Null until an MCP server has reported.
    /// </summary>
    private static HealthCheckStatus? BuildVersionStatus(McpToolCatalogue catalogue, string addonVersion)
    {
        if (string.IsNullOrEmpty(catalogue.UmbrellaVersion))
        {
            return null;
        }

        string reported = WebUtility.HtmlEncode(catalogue.UmbrellaVersion);
        string when = catalogue.Modules.Count > 0
            ? $" on {catalogue.Modules.Values.Max(m => m.ReportedAt).UtcDateTime.ToString("dd-MM-yyyy HH:mm", CultureInfo.InvariantCulture)} UTC"
            : string.Empty;

        if (string.Equals(catalogue.UmbrellaVersion, addonVersion, StringComparison.Ordinal))
        {
            return new($"The MCP server last started as umbrella-mcp {reported}{when}, the same version as the add-on.")
                { ResultType = StatusResultType.Success };
        }

        string expected = WebUtility.HtmlEncode(addonVersion);
        return new($"The MCP server last started as umbrella-mcp {reported}{when}, but the add-on is {expected}. " +
                   $"The two are released together: set {McpClientConfig.NpmPackage}@{expected} in your AI tool's MCP configuration. " +
                   "A .mcp.json the site wrote and nobody edited is upgraded when the site next starts in Development.")
            { ResultType = StatusResultType.Warning };
    }
}
