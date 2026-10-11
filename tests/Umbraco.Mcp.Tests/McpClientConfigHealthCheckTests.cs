using System.Net;
using NUnit.Framework;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.Client;
using Umbraco.Mcp.HealthChecks;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpClientConfigHealthCheckTests
{
    private const string ClientId = "umbraco-back-office-mcp";

    private static HealthCheckStatus Build(string? siteUrl, string clientId = ClientId) =>
        McpClientConfigHealthCheck.BuildStatuses(siteUrl, clientId).Single();

    // The backoffice renders the message as HTML, so assertions on the JSON read the decoded text.
    private static string Text(HealthCheckStatus row) => WebUtility.HtmlDecode(row.Message!);

    [Test]
    public void Is_a_single_info_row()
    {
        HealthCheckStatus row = Build("https://example.com");

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Info));
    }

    [Test]
    public void Snippet_starts_the_server_with_npx()
    {
        string text = Text(Build("https://example.com"));

        Assert.That(text, Does.Contain("\"command\": \"npx\""));
        Assert.That(text, Does.Contain($"\"{McpClientConfig.NpmPackage}@{McpAddon.Version}\""));
    }

    [Test]
    public void Snippet_is_filled_in_with_the_site_url_and_client_id()
    {
        string text = Text(Build("https://example.com", "my-client"));

        Assert.That(text, Does.Contain("\"UMBRACO_BASE_URL\": \"https://example.com\""));
        Assert.That(text, Does.Contain("\"UMBRACO_CLIENT_ID\": \"my-client\""));
    }

    [Test]
    public void Snippet_never_holds_a_real_secret()
    {
        string text = Text(Build("https://example.com"));

        Assert.That(text, Does.Contain($"\"UMBRACO_CLIENT_SECRET\": \"{McpClientConfigHealthCheck.SecretPlaceholder}\""));
    }

    [Test]
    public void Unknown_site_url_falls_back_to_a_placeholder()
    {
        string text = Text(Build(null));

        Assert.That(text, Does.Contain($"\"UMBRACO_BASE_URL\": \"{McpClientConfigHealthCheck.SiteUrlPlaceholder}\""));
    }

    [Test]
    public void Configured_values_are_html_encoded()
    {
        HealthCheckStatus row = Build("https://example.com", "<script>alert(1)</script>");

        Assert.That(row.Message, Does.Not.Contain("<script>"));
        Assert.That(Text(row), Does.Contain("<script>alert(1)</script>"));
    }

    [Test]
    public void Values_are_json_escaped()
    {
        string text = Text(Build("https://example.com", "a\"b"));

        Assert.That(text, Does.Contain("\"UMBRACO_CLIENT_ID\": \"a\\\"b\""));
    }
}
