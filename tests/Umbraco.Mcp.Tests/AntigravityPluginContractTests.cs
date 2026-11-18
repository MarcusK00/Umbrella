using System.Text.Json;
using NUnit.Framework;
using Umbraco.Mcp.Client;

namespace Umbraco.Mcp.Tests;

/// <summary>
/// The Antigravity plugin in <c>plugins/umbrella/.antigravity-plugin</c> and <c>plugins/umbrella/mcp_config.json</c>
/// starts the same server as the other client configs and matches Antigravity's plugin manifest schema.
/// </summary>
[TestFixture]
public class AntigravityPluginContractTests
{
    private static readonly string[] AllowedManifestKeys =
    [
        "$schema",
        "name",
        "displayName",
        "display_name",
        "description",
        "version",
        "disabled",
        "logo",
        "suggestedPrompts",
        "suggested_prompts",
        "skills",
        "author",
        "homepage",
        "repository",
        "license",
        "keywords",
        "extensions",
    ];

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

    private static JsonElement Manifest() => Read("plugins", McpClientSnippets.PluginName, ".antigravity-plugin", "plugin.json");

    private static JsonElement Server() =>
        Read("plugins", McpClientSnippets.PluginName, "mcp_config.json").GetProperty("mcpServers").GetProperty(McpClientConfig.ServerName);

    [Test]
    public void Plugin_manifest_matches_addon_and_antigravity_schema()
    {
        JsonElement manifest = Manifest();

        Assert.That(manifest.GetProperty("$schema").GetString(), Is.EqualTo("https://antigravity.google/schemas/v1/plugin.json"));
        Assert.That(manifest.GetProperty("name").GetString(), Is.EqualTo(McpClientSnippets.PluginName));
        Assert.That(manifest.GetProperty("version").GetString(), Is.EqualTo(McpAddon.Version));
        Assert.That(manifest.EnumerateObject().Select(p => p.Name), Is.SubsetOf(AllowedManifestKeys));

        string logo = manifest.GetProperty("logo").GetString()!;
        Assert.That(logo, Does.Not.StartWith("/"));
        string logoPath = Path.Combine(RepoRoot(), "plugins", McpClientSnippets.PluginName, logo);
        Assert.That(File.Exists(logoPath), Is.True, $"Missing logo at {logoPath}");

        JsonElement[] prompts = manifest.GetProperty("suggestedPrompts").EnumerateArray().ToArray();
        Assert.That(prompts.Length, Is.InRange(1, 3));
        Assert.That(prompts.Select(p => p.GetString()), Has.All.Not.Null.And.Not.Empty);
    }

    [Test]
    public void Plugin_runs_the_addons_server_version_with_npx()
    {
        JsonElement server = Server();

        Assert.That(server.GetProperty("command").GetString(), Is.EqualTo("npx"));
        Assert.That(server.GetProperty("args").EnumerateArray().Select(a => a.GetString()), Is.EqualTo(McpClientConfig.NpxArgs(McpAddon.Version)));
    }

    [Test]
    public void Plugin_declares_each_variable_and_passes_it_to_the_server()
    {
        JsonElement server = Server();
        JsonElement env = server.GetProperty("env");
        string[] declared = server.GetProperty("variables").EnumerateArray().Select(v => v.GetProperty("name").GetString()!).ToArray();

        string[] expected =
        [
            "UMBRACO_BASE_URL",
            "UMBRACO_CLIENT_ID",
            "UMBRACO_CLIENT_SECRET",
            "NODE_TLS_REJECT_UNAUTHORIZED",
        ];

        Assert.That(env.EnumerateObject().Select(p => p.Name), Is.EquivalentTo(expected));
        Assert.That(declared, Is.EquivalentTo(expected));
        foreach (string variable in expected)
        {
            Assert.That(env.GetProperty(variable).GetString(), Is.EqualTo($"${{{variable}}}"), variable);
        }
    }
}
