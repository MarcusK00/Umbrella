using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.ApiUser;

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
    /// <summary>The npm package the AI tool starts with npx. Working name until the package names are signed off.</summary>
    internal const string NpmPackage = "@umbraco/mcp";

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
        string json = BuildConfigJson(siteUrl ?? SiteUrlPlaceholder, clientId);

        return
        [
            new("Add this to your AI tool's MCP configuration to connect it to this site. " +
                "Replace the secret with the one you saved when you created the API user." +
                $"<pre><code>{WebUtility.HtmlEncode(json)}</code></pre>")
                { ResultType = StatusResultType.Info },
        ];
    }

    private static string BuildConfigJson(string siteUrl, string clientId)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions
        {
            Indented = true,
            // Keeps quotes as \" and leaves < > readable; the result is HTML-encoded afterwards.
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        }))
        {
            writer.WriteStartObject();
            writer.WriteStartObject("mcpServers");
            writer.WriteStartObject("umbraco");
            writer.WriteString("command", "npx");
            writer.WriteStartArray("args");
            writer.WriteStringValue("-y");
            writer.WriteStringValue(NpmPackage);
            writer.WriteEndArray();
            writer.WriteStartObject("env");
            writer.WriteString("UMBRACO_BASE_URL", siteUrl);
            writer.WriteString("UMBRACO_CLIENT_ID", clientId);
            writer.WriteString("UMBRACO_CLIENT_SECRET", SecretPlaceholder);
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }
}
