using System.Text.Json;
using NUnit.Framework;
using Umbraco.Mcp.Client;

namespace Umbraco.Mcp.Tests;

/// <summary>
/// The Codex plugin in <c>plugins/umbrella/.codex-plugin</c> and <c>.agents/plugins/marketplace.json</c> starts the same
/// server as the other client configs, and the dashboard's plugin commands name its marketplace and plugin.
/// </summary>
[TestFixture]
public class CodexPluginContractTests
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

    private static JsonElement Marketplace() => Read(".agents", "plugins", "marketplace.json");

    private static JsonElement Manifest() => Read("plugins", McpClientSnippets.PluginName, ".codex-plugin", "plugin.json");

    private static JsonElement Server() =>
        Manifest().GetProperty("mcpServers").GetProperty(McpClientConfig.ServerName);

    [Test]
    public void Marketplace_lists_the_plugin_from_its_folder()
    {
        JsonElement marketplace = Marketplace();
        JsonElement entry = marketplace.GetProperty("plugins").EnumerateArray().Single();

        Assert.That(marketplace.GetProperty("name").GetString(), Is.EqualTo(McpClientSnippets.PluginMarketplace));
        Assert.That(entry.GetProperty("name").GetString(), Is.EqualTo(McpClientSnippets.PluginName));
        Assert.That(entry.GetProperty("source").GetProperty("source").GetString(), Is.EqualTo("local"));
        Assert.That(entry.GetProperty("source").GetProperty("path").GetString(), Is.EqualTo($"./plugins/{McpClientSnippets.PluginName}"));
        Assert.That(entry.GetProperty("policy").GetProperty("installation").GetString(), Is.EqualTo("AVAILABLE"));
        Assert.That(entry.GetProperty("policy").GetProperty("authentication").GetString(), Is.EqualTo("ON_INSTALL"));
    }

    [Test]
    public void Plugin_name_version_and_assets_match_the_addon()
    {
        JsonElement manifest = Manifest();

        Assert.That(manifest.GetProperty("name").GetString(), Is.EqualTo(McpClientSnippets.PluginName));
        Assert.That(manifest.GetProperty("version").GetString(), Is.EqualTo(McpAddon.Version));
        Assert.That(manifest.GetProperty("skills").GetString(), Is.EqualTo("./skills/"));

        string logo = manifest.GetProperty("interface").GetProperty("logo").GetString()!;
        Assert.That(logo, Does.StartWith("./"));
        string logoPath = Path.Combine(RepoRoot(), "plugins", McpClientSnippets.PluginName, logo[2..]);
        Assert.That(File.Exists(logoPath), Is.True, $"Missing logo at {logoPath}");
    }

    [Test]
    public void Plugin_runs_the_addons_server_version_with_npx()
    {
        JsonElement server = Server();

        Assert.That(server.GetProperty("command").GetString(), Is.EqualTo("npx"));
        Assert.That(server.GetProperty("args").EnumerateArray().Select(a => a.GetString()), Is.EqualTo(McpClientConfig.NpxArgs(McpAddon.Version)));
    }

    [Test]
    public void Plugin_forwards_each_environment_variable_to_the_server()
    {
        string[] envVars = Server().GetProperty("env_vars").EnumerateArray().Select(e => e.GetString()!).ToArray();

        Assert.That(envVars, Is.EquivalentTo(new[]
        {
            "UMBRACO_BASE_URL",
            "UMBRACO_CLIENT_ID",
            "UMBRACO_CLIENT_SECRET",
            "NODE_TLS_REJECT_UNAUTHORIZED",
        }));
    }

    [Test]
    public void Health_skill_declares_matching_name()
    {
        string skill = File.ReadAllText(Path.Combine(RepoRoot(), "plugins", McpClientSnippets.PluginName, "skills", "health", "SKILL.md"));
        Assert.That(skill, Does.StartWith("---"));
        Assert.That(skill, Does.Contain("\nname: health\n").Or.Contain("\r\nname: health\r\n"));
    }
}
