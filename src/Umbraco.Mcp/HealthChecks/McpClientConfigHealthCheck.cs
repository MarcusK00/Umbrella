using System.Net;
using Microsoft.AspNetCore.Http;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Client;

namespace Umbraco.Mcp.HealthChecks;

[HealthCheck(
    "0c7e5a91-2d4b-4f63-8e1a-9b5d3c7f2e48",
    "MCP client setup",
    Description = "Shows the configuration to paste into an AI tool so it can connect to this site through the Umbraco MCP.",
    Group = "MCP")]
public sealed class McpClientConfigHealthCheck(
    IMcpApiUserProvider apiUser,
    IHttpContextAccessor httpContextAccessor) : HealthCheck
{
    internal const string SecretPlaceholder = "<the client secret you saved when creating the API user>";

    internal const string SiteUrlPlaceholder = "https://your-site";

    public override Task<IEnumerable<HealthCheckStatus>> GetStatusAsync() =>
        Task.FromResult(BuildStatuses(GetSiteUrl(), apiUser.ClientId));

    public override HealthCheckStatus ExecuteAction(HealthCheckAction action) =>
        throw new InvalidOperationException("The MCP client setup health check has no actions.");

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
    internal static IEnumerable<HealthCheckStatus> BuildStatuses(string? siteUrl, string clientId)
    {
        string json = McpClientConfig.Build(
            "npx",
            McpClientConfig.NpxArgs(McpAddon.Version),
            [
                new("UMBRACO_BASE_URL", siteUrl ?? SiteUrlPlaceholder),
                new("UMBRACO_CLIENT_ID", clientId),
                new("UMBRACO_CLIENT_SECRET", SecretPlaceholder),
            ]);

        return
        [
            new("Add this to your AI tool's MCP configuration to connect it to this site. " +
                "Replace the secret with the one you saved when you created the API user." +
                $"<pre><code>{WebUtility.HtmlEncode(json)}</code></pre>")
                { ResultType = StatusResultType.Info },
        ];
    }
}
