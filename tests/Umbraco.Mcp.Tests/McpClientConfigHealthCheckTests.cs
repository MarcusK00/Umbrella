using System.Net;
using NUnit.Framework;
using Umbraco.Cms.Core.HealthChecks;
using Umbraco.Mcp.Client;
using Umbraco.Mcp.HealthChecks;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpClientConfigHealthCheckTests
{
    private const string ClientId = "umbraco-back-office-mcp";

    private const string AddonVersion = "17.0.1";

    private static HealthCheckStatus Build(string? siteUrl, string clientId = ClientId) =>
        McpClientConfigHealthCheck.BuildStatuses(siteUrl, clientId, McpToolCatalogue.Empty, AddonVersion).Single();

    private static McpToolCatalogue Reported(string version) =>
        new(version, new Dictionary<string, McpModuleCatalogue>
        {
            ["cms"] = new(new DateTimeOffset(2026, 10, 11, 8, 0, 0, TimeSpan.Zero), false, []),
            ["forms"] = new(new DateTimeOffset(2026, 10, 12, 9, 30, 0, TimeSpan.Zero), false, []),
        });

    private static HealthCheckStatus VersionRow(McpToolCatalogue catalogue) =>
        McpClientConfigHealthCheck.BuildStatuses("https://example.com", ClientId, catalogue, AddonVersion).Last();

    // The backoffice renders the message as HTML, so assertions on the JSON read the decoded text.
    private static string Text(HealthCheckStatus row) => WebUtility.HtmlDecode(row.Message!);

    [Test]
    public void Is_a_single_info_row()
    {
        HealthCheckStatus row = Build("https://example.com");

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Info));
    }

    [Test]
    public void No_version_row_before_the_mcp_server_has_reported()
    {
        // Build() calls Single(), so this only passes with the config row alone.
        Assert.That(Build("https://example.com").ResultType, Is.EqualTo(StatusResultType.Info));
    }

    [Test]
    public void Same_version_as_the_addon_is_a_success_row_with_the_last_report()
    {
        HealthCheckStatus row = VersionRow(Reported(AddonVersion));

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Success));
        Assert.That(row.Message, Does.Contain("umbrella-mcp 17.0.1"));
        Assert.That(row.Message, Does.Contain("12-10-2026 09:30 UTC"));
    }

    [Test]
    public void Other_version_than_the_addon_is_a_warning_with_the_version_to_run()
    {
        HealthCheckStatus row = VersionRow(Reported("17.0.0"));

        Assert.That(row.ResultType, Is.EqualTo(StatusResultType.Warning));
        Assert.That(row.Message, Does.Contain("umbrella-mcp 17.0.0"));
        Assert.That(row.Message, Does.Contain($"umbrella-mcp@{AddonVersion}"));
    }

    [Test]
    public void Reported_version_is_html_encoded()
    {
        HealthCheckStatus row = VersionRow(Reported("<b>1</b>"));

        Assert.That(row.Message, Does.Not.Contain("<b>"));
        Assert.That(WebUtility.HtmlDecode(row.Message!), Does.Contain("<b>1</b>"));
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
