using System.Text.Json;
using NUnit.Framework;
using Umbraco.Mcp.Client;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpClientSnippetsTests
{
    private const string Site = "https://localhost:44399";
    private const string Remote = "https://example.com";
    private const string ClientId = "umbraco-back-office-mcp";
    private const string Version = "17.0.0-alpha.2";

    private static IReadOnlyList<McpClientSnippet> Build(string? site = Site, string clientId = ClientId) =>
        McpClientSnippets.Build(site, clientId, Version);

    private static McpClientSnippet Get(string id, string? site = Site, string clientId = ClientId) =>
        Build(site, clientId).Single(s => s.Id == id);

    private static JsonElement Env(string id, string? site = Site) =>
        JsonDocument.Parse(Get(id, site).Content).RootElement.GetProperty("mcpServers").GetProperty("umbraco").GetProperty("env");

    [Test]
    public void Five_clients_in_order()
    {
        IReadOnlyList<McpClientSnippet> snippets = Build();

        Assert.That(snippets.Select(s => s.Id), Is.EqualTo(new[] { "claude-code", "claude-code-cli", "vscode", "cursor", "other" }));
        Assert.That(snippets.Select(s => s.Label), Is.EqualTo(new[] { "Claude Code", "Claude Code (command)", "VS Code", "Cursor", "Other clients" }));
        Assert.That(snippets.Select(s => s.FileName), Is.EqualTo(new string?[] { ".mcp.json", null, ".vscode/mcp.json", ".cursor/mcp.json", null }));
        Assert.That(snippets.Select(s => s.Format), Is.EqualTo(new[] { "json", "shell", "json", "json", "json" }));
    }

    [Test]
    public void Claude_code_reads_the_secret_from_the_environment() =>
        Assert.That(Env("claude-code").GetProperty("UMBRACO_CLIENT_SECRET").GetString(), Is.EqualTo("${UMBRELLA_CLIENT_SECRET}"));

    [Test]
    public void Cli_command_adds_a_local_stdio_server_with_npx()
    {
        const string expected = "claude mcp add --transport stdio --env UMBRACO_BASE_URL=https://localhost:44399 --env UMBRACO_CLIENT_ID=umbraco-back-office-mcp --env UMBRACO_CLIENT_SECRET=YOUR_CLIENT_SECRET --env NODE_TLS_REJECT_UNAUTHORIZED=0 umbraco -- npx -y umbrella-mcp@17.0.0-alpha.2";
        string remote = Get("claude-code-cli", Remote).Content;

        Assert.That(Get("claude-code-cli").Content, Is.EqualTo(expected));
        Assert.That(remote, Is.EqualTo(expected.Replace("https://localhost:44399", Remote).Replace(" --env NODE_TLS_REJECT_UNAUTHORIZED=0", "")));
        Assert.That(remote, Does.Not.Contain("--scope").And.Not.Contain("<").And.Not.Contain(">"));
    }

    [Test]
    public void Vscode_prompts_for_the_secret()
    {
        JsonElement root = JsonDocument.Parse(Get("vscode").Content).RootElement;
        JsonElement input = root.GetProperty("inputs")[0];
        JsonElement server = root.GetProperty("servers").GetProperty("umbraco");

        Assert.That(input.GetProperty("type").GetString(), Is.EqualTo("promptString"));
        Assert.That(input.GetProperty("id").GetString(), Is.EqualTo("umbrella-client-secret"));
        Assert.That(input.GetProperty("description").GetString(), Is.EqualTo("Client secret of the Umbraco MCP API user"));
        Assert.That(input.GetProperty("password").GetBoolean(), Is.True);
        Assert.That(server.GetProperty("type").GetString(), Is.EqualTo("stdio"));
        Assert.That(server.GetProperty("command").GetString(), Is.EqualTo("npx"));
        Assert.That(server.GetProperty("args").EnumerateArray().Select(a => a.GetString()), Is.EqualTo(new[] { "-y", "umbrella-mcp@17.0.0-alpha.2" }));
        Assert.That(server.GetProperty("env").GetProperty("UMBRACO_CLIENT_SECRET").GetString(), Is.EqualTo("${input:umbrella-client-secret}"));
    }

    [Test]
    public void Cursor_reads_the_secret_from_the_environment() =>
        Assert.That(Env("cursor").GetProperty("UMBRACO_CLIENT_SECRET").GetString(), Is.EqualTo("${env:UMBRELLA_CLIENT_SECRET}"));

    [Test]
    public void Other_uses_the_placeholder() =>
        Assert.That(Env("other").GetProperty("UMBRACO_CLIENT_SECRET").GetString(), Is.EqualTo(McpClientSnippets.SecretPlaceholder));

    [Test]
    public void Loopback_sites_skip_certificate_checks_in_every_client()
    {
        Assert.That(Build(Site).Select(s => s.Content), Has.All.Contain("NODE_TLS_REJECT_UNAUTHORIZED"));
        Assert.That(Build(Remote).Select(s => s.Content), Has.None.Contain("NODE_TLS_REJECT_UNAUTHORIZED"));
    }

    [Test]
    public void Unknown_site_url_falls_back_to_a_placeholder()
    {
        IReadOnlyList<McpClientSnippet> snippets = Build(null);

        Assert.That(snippets.Select(s => s.Content), Has.All.Contain("UMBRACO_BASE_URL"));
        Assert.That(snippets.Select(s => s.Content), Has.All.Contain("https://your-site"));
        Assert.That(snippets.Select(s => s.Content), Has.None.Contain("NODE_TLS"));
    }

    [Test]
    public void Values_are_json_escaped()
    {
        const string id = "a\"b";

        foreach (string snippetId in new[] { "claude-code", "vscode", "cursor", "other" })
        {
            JsonElement root = JsonDocument.Parse(Get(snippetId, Site, id).Content).RootElement;
            JsonElement server = root.GetProperty(snippetId == "vscode" ? "servers" : "mcpServers").GetProperty("umbraco");
            Assert.That(server.GetProperty("env").GetProperty("UMBRACO_CLIENT_ID").GetString(), Is.EqualTo(id), snippetId);
        }
    }
}
