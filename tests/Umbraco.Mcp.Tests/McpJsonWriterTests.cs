using System.Text.Json;
using NUnit.Framework;
using Umbraco.Mcp.Client;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpJsonWriterTests
{
    private const string ClientId = "umbraco-back-office-mcp";

    private static JsonElement Server(string json) =>
        JsonDocument.Parse(json).RootElement.GetProperty("mcpServers").GetProperty(McpClientConfig.ServerName);

    private static string Env(string json, string name) => Server(json).GetProperty("env").GetProperty(name).GetString()!;

    [TestCase(true, true, ExpectedResult = true)]
    [TestCase(false, true, ExpectedResult = false)]
    [TestCase(true, false, ExpectedResult = false)]
    public bool Writes_only_in_development_when_enabled(bool isDevelopment, bool enabled) =>
        McpJsonWriter.ShouldWrite(isDevelopment, new McpJsonOptions { Enabled = enabled });

    [Test]
    public void Site_url_prefers_https()
    {
        string? url = McpJsonWriter.PickSiteUrl(["http://localhost:9399", "https://localhost:44399"]);

        Assert.That(url, Is.EqualTo("https://localhost:44399"));
    }

    [TestCase("https://*:5001")]
    [TestCase("https://+:5001")]
    [TestCase("https://0.0.0.0:5001")]
    [TestCase("https://[::]:5001")]
    public void Wildcard_hosts_become_localhost(string address)
    {
        Assert.That(McpJsonWriter.PickSiteUrl([address]), Is.EqualTo("https://localhost:5001"));
    }

    [Test]
    public void No_site_url_without_an_https_address()
    {
        // The Management API token endpoint rejects plain HTTP, so an http-only site cannot be used.
        Assert.That(McpJsonWriter.PickSiteUrl(["http://localhost:9399"]), Is.Null);
    }

    [Test]
    public void Config_starts_the_server_with_npx_at_the_addon_version()
    {
        JsonElement server = Server(McpJsonWriter.BuildJson("https://example.com", ClientId, "17.1.0", new McpJsonOptions()));

        Assert.That(server.GetProperty("command").GetString(), Is.EqualTo("npx"));
        Assert.That(
            server.GetProperty("args").EnumerateArray().Select(a => a.GetString()),
            Is.EqualTo(new[] { "-y", "umbrella-mcp@17.1.0" }));
    }

    [Test]
    public void Config_is_filled_in_with_the_site_url_and_client_id()
    {
        string json = McpJsonWriter.BuildJson("https://example.com", "my-client", "17.1.0", new McpJsonOptions());

        Assert.That(Env(json, "UMBRACO_BASE_URL"), Is.EqualTo("https://example.com"));
        Assert.That(Env(json, "UMBRACO_CLIENT_ID"), Is.EqualTo("my-client"));
    }

    [Test]
    public void Secret_is_read_from_an_environment_variable()
    {
        string json = McpJsonWriter.BuildJson("https://example.com", ClientId, "17.1.0", new McpJsonOptions());

        Assert.That(Env(json, "UMBRACO_CLIENT_SECRET"), Is.EqualTo("${UMBRELLA_CLIENT_SECRET}"));
    }

    [Test]
    public void Loopback_site_skips_certificate_checks_for_the_dev_certificate()
    {
        string json = McpJsonWriter.BuildJson("https://localhost:44399", ClientId, "17.1.0", new McpJsonOptions());

        Assert.That(Env(json, "NODE_TLS_REJECT_UNAUTHORIZED"), Is.EqualTo("0"));
    }

    [Test]
    public void Remote_site_keeps_certificate_checks()
    {
        string json = McpJsonWriter.BuildJson("https://example.com", ClientId, "17.1.0", new McpJsonOptions());

        Assert.That(Server(json).GetProperty("env").TryGetProperty("NODE_TLS_REJECT_UNAUTHORIZED", out _), Is.False);
    }

    [Test]
    public void Command_and_args_can_be_overridden()
    {
        var options = new McpJsonOptions { Command = "node", Args = ["../npm/dist/index.js"] };

        JsonElement server = Server(McpJsonWriter.BuildJson("https://example.com", ClientId, "17.1.0", options));

        Assert.That(server.GetProperty("command").GetString(), Is.EqualTo("node"));
        Assert.That(server.GetProperty("args").EnumerateArray().Select(a => a.GetString()), Is.EqualTo(new[] { "../npm/dist/index.js" }));
    }

    [TestFixture]
    public class Writing
    {
        private string _dir = null!;

        [SetUp]
        public void SetUp()
        {
            _dir = Path.Combine(Path.GetTempPath(), "umbrella-mcpjson-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_dir);
        }

        [TearDown]
        public void TearDown() => Directory.Delete(_dir, recursive: true);

        [Test]
        public void Writes_the_file_when_missing()
        {
            bool written = McpJsonWriter.TryWrite(_dir, "{}", out string path);

            Assert.That(written, Is.True);
            Assert.That(path, Is.EqualTo(Path.Combine(_dir, ".mcp.json")));
            Assert.That(File.ReadAllText(path), Is.EqualTo("{}"));
        }

        [Test]
        public void Never_overwrites_an_existing_file()
        {
            string existing = Path.Combine(_dir, ".mcp.json");
            File.WriteAllText(existing, "mine");

            bool written = McpJsonWriter.TryWrite(_dir, "{}", out _);

            Assert.That(written, Is.False);
            Assert.That(File.ReadAllText(existing), Is.EqualTo("mine"));
        }

        private string WriteFor(string version, McpJsonOptions? options = null)
        {
            string path = Path.Combine(_dir, ".mcp.json");
            File.WriteAllText(path, Build(version, options));
            return path;
        }

        private static string Build(string version, McpJsonOptions? options = null) =>
            McpJsonWriter.BuildJson("https://localhost:44399", ClientId, version, options ?? new McpJsonOptions());

        [TestCase("17.0.0", "17.0.1")]
        [TestCase("17.0.0-alpha.2", "17.0.0-alpha.10")]
        [TestCase("17.0.0-alpha.1", "17.0.0")]
        public void Upgrades_a_file_it_wrote_for_an_older_version(string old, string current)
        {
            string path = WriteFor(old);

            bool upgraded = McpJsonWriter.TryUpgrade(path, v => Build(v), current, out string? from);

            Assert.That(upgraded, Is.True);
            Assert.That(from, Is.EqualTo(old));
            Assert.That(File.ReadAllText(path), Is.EqualTo(Build(current)));
        }

        [Test]
        public void Never_upgrades_an_edited_file()
        {
            string path = WriteFor("17.0.0");
            string edited = File.ReadAllText(path).Replace("umbraco-back-office-mcp", "my-client");
            File.WriteAllText(path, edited);

            Assert.That(McpJsonWriter.TryUpgrade(path, v => Build(v), "17.0.1", out _), Is.False);
            Assert.That(File.ReadAllText(path), Is.EqualTo(edited));
        }

        [TestCase("17.0.1")]
        [TestCase("17.0.0")]
        public void Never_downgrades_or_rewrites_the_same_version(string pinned)
        {
            string path = WriteFor(pinned);

            Assert.That(McpJsonWriter.TryUpgrade(path, v => Build(v), "17.0.0", out _), Is.False);
            Assert.That(File.ReadAllText(path), Is.EqualTo(Build(pinned)));
        }

        [Test]
        public void Leaves_a_file_with_overridden_args_alone()
        {
            var options = new McpJsonOptions { Command = "node", Args = ["../npm/dist/index.js"] };
            string path = WriteFor("17.0.0", options);

            Assert.That(McpJsonWriter.TryUpgrade(path, v => Build(v, options), "17.0.1", out _), Is.False);
        }

        [TestCase("not json")]
        [TestCase("{}")]
        [TestCase("{\"mcpServers\":{\"umbraco\":{\"args\":\"umbrella-mcp@17.0.0\"}}}")]
        public void Leaves_an_unrecognised_file_alone(string content)
        {
            string path = Path.Combine(_dir, ".mcp.json");
            File.WriteAllText(path, content);

            Assert.That(McpJsonWriter.TryUpgrade(path, v => Build(v), "17.0.1", out _), Is.False);
            Assert.That(File.ReadAllText(path), Is.EqualTo(content));
        }

        [Test]
        public void Does_not_create_a_missing_folder()
        {
            string missing = Path.Combine(_dir, "nope");

            bool written = McpJsonWriter.TryWrite(missing, "{}", out _);

            Assert.That(written, Is.False);
            Assert.That(Directory.Exists(missing), Is.False);
        }
    }
}
