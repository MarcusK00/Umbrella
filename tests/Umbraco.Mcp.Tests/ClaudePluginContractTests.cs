using System.Text.Json;
using NUnit.Framework;
using Umbraco.Mcp.Client;

namespace Umbraco.Mcp.Tests;

/// <summary>
/// The Claude Code plugin in <c>plugins/umbrella</c> starts the same server as the other client configs, and the
/// dashboard's plugin commands name its marketplace and plugin. Both must follow the add-on.
/// </summary>
[TestFixture]
public class ClaudePluginContractTests
{
    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Umbraco.Mcp.slnx")))
        {
            dir = dir.Parent;
        }

        Assert.That(dir, Is.Not.Null, "Could not find the repository root.");
        return dir!.FullName;
    }

    private static JsonElement Read(params string[] path) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine([RepoRoot(), .. path]))).RootElement;

    private static JsonElement Marketplace() => Read(".claude-plugin", "marketplace.json");

    private static JsonElement Manifest() => Read("plugins", McpClientSnippets.PluginName, ".claude-plugin", "plugin.json");

    private static JsonElement Server() =>
        Read("plugins", McpClientSnippets.PluginName, ".mcp.json").GetProperty("mcpServers").GetProperty(McpClientConfig.ServerName);

    [Test]
    public void Marketplace_lists_the_plugin_from_its_folder()
    {
        JsonElement marketplace = Marketplace();
        JsonElement entry = marketplace.GetProperty("plugins").EnumerateArray().Single();

        Assert.That(marketplace.GetProperty("name").GetString(), Is.EqualTo(McpClientSnippets.PluginMarketplace));
        Assert.That(entry.GetProperty("name").GetString(), Is.EqualTo(McpClientSnippets.PluginName));
        Assert.That(entry.GetProperty("source").GetString(), Is.EqualTo($"./plugins/{McpClientSnippets.PluginName}"));
        // plugin.json sets the version; a second one here would only drift.
        Assert.That(entry.TryGetProperty("version", out _), Is.False);
    }

    [Test]
    public void Plugin_name_and_version_match_the_addon()
    {
        JsonElement manifest = Manifest();

        Assert.That(manifest.GetProperty("name").GetString(), Is.EqualTo(McpClientSnippets.PluginName));
        Assert.That(manifest.GetProperty("version").GetString(), Is.EqualTo(McpAddon.Version));
    }

    [Test]
    public void Plugin_runs_the_addons_server_version_with_npx()
    {
        JsonElement server = Server();

        Assert.That(server.GetProperty("command").GetString(), Is.EqualTo("npx"));
        Assert.That(server.GetProperty("args").EnumerateArray().Select(a => a.GetString()), Is.EqualTo(McpClientConfig.NpxArgs(McpAddon.Version)));
    }

    [Test]
    public void Plugin_passes_each_setting_to_the_server()
    {
        JsonElement env = Server().GetProperty("env");
        JsonElement options = Manifest().GetProperty("userConfig");

        var expected = new Dictionary<string, string>
        {
            ["UMBRACO_BASE_URL"] = "base_url",
            ["UMBRACO_CLIENT_ID"] = "client_id",
            ["UMBRACO_CLIENT_SECRET"] = "client_secret",
            ["NODE_TLS_REJECT_UNAUTHORIZED"] = "tls_reject_unauthorized",
        };

        Assert.That(env.EnumerateObject().Select(p => p.Name), Is.EquivalentTo(expected.Keys));
        foreach ((string variable, string option) in expected)
        {
            Assert.That(env.GetProperty(variable).GetString(), Is.EqualTo($"${{user_config.{option}}}"), variable);
            Assert.That(options.TryGetProperty(option, out _), Is.True, $"userConfig has no {option}");
        }
    }

    [Test]
    public void Secret_is_sensitive_and_certificate_checks_stay_on_by_default()
    {
        JsonElement options = Manifest().GetProperty("userConfig");

        Assert.That(options.GetProperty("client_secret").GetProperty("sensitive").GetBoolean(), Is.True);
        Assert.That(options.GetProperty("client_id").GetProperty("default").GetString(), Is.EqualTo(McpClientConfig.DefaultClientId));
        Assert.That(options.GetProperty("tls_reject_unauthorized").GetProperty("default").GetString(), Is.EqualTo("1"));
    }
}
