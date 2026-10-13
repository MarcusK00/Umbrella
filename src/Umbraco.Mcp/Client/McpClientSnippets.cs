using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Umbraco.Mcp.Client;

/// <summary>One copy-ready client config shown on the dashboard. <paramref name="FileName"/> is null when it is not a file.</summary>
public sealed record McpClientSnippet(string Id, string Label, string? FileName, string Format, string Content);

/// <summary>Builds the client configs for the dashboard. None of them contains a client secret, only a way to supply it.</summary>
internal static class McpClientSnippets
{
    /// <summary>Stands in for the site URL when the add-on cannot tell what it is.</summary>
    internal const string SiteUrlPlaceholder = "https://your-site";

    /// <summary>For clients that have no way to prompt for, or read, the secret.</summary>
    internal const string SecretPlaceholder = "<the client secret you saved when creating the API user>";

    /// <summary>The secret in the shell command; it has no angle brackets, which a shell would treat as redirection.</summary>
    internal const string CliSecretPlaceholder = "YOUR_CLIENT_SECRET";

    private const string VsCodeInputId = "umbrella-client-secret";

    public static IReadOnlyList<McpClientSnippet> Build(string? siteUrl, string clientId, string addonVersion)
    {
        string url = siteUrl ?? SiteUrlPlaceholder;
        IReadOnlyList<string> args = McpClientConfig.NpxArgs(addonVersion);

        // Node does not trust the ASP.NET Core development certificate. Only ever relaxed for the local machine.
        bool loopback = new Uri(url).IsLoopback;

        List<KeyValuePair<string, string>> Env(string secret)
        {
            var env = new List<KeyValuePair<string, string>>
            {
                new("UMBRACO_BASE_URL", url),
                new("UMBRACO_CLIENT_ID", clientId),
                new("UMBRACO_CLIENT_SECRET", secret),
            };
            if (loopback)
            {
                env.Add(new("NODE_TLS_REJECT_UNAUTHORIZED", "0"));
            }

            return env;
        }

        string cliEnv = string.Join(' ', Env(CliSecretPlaceholder).Select(e => $"--env {e.Key}={e.Value}"));

        return
        [
            new("claude-code", "Claude Code", ".mcp.json", "json",
                McpClientConfig.Build("npx", args, Env($"${{{McpClientConfig.SecretEnvironmentVariable}}}"))),
            new("claude-code-cli", "Claude Code (command)", null, "shell",
                $"claude mcp add --transport stdio {cliEnv} {McpClientConfig.ServerName} -- npx {string.Join(' ', args)}"),
            new("vscode", "VS Code", ".vscode/mcp.json", "json", BuildVsCode(args, Env($"${{input:{VsCodeInputId}}}"))),
            new("cursor", "Cursor", ".cursor/mcp.json", "json",
                McpClientConfig.Build("npx", args, Env($"${{env:{McpClientConfig.SecretEnvironmentVariable}}}"))),
            new("other", "Other clients", null, "json", McpClientConfig.Build("npx", args, Env(SecretPlaceholder))),
        ];
    }

    /// <summary>VS Code uses <c>servers</c> instead of <c>mcpServers</c> and prompts for the secret through an input.</summary>
    private static string BuildVsCode(IEnumerable<string> args, IEnumerable<KeyValuePair<string, string>> env)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions
        {
            Indented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        }))
        {
            writer.WriteStartObject();
            writer.WriteStartArray("inputs");
            writer.WriteStartObject();
            writer.WriteString("type", "promptString");
            writer.WriteString("id", VsCodeInputId);
            writer.WriteString("description", "Client secret of the Umbraco MCP API user");
            writer.WriteBoolean("password", true);
            writer.WriteEndObject();
            writer.WriteEndArray();
            writer.WriteStartObject("servers");
            writer.WriteStartObject(McpClientConfig.ServerName);
            writer.WriteString("type", "stdio");
            writer.WriteString("command", "npx");
            writer.WriteStartArray("args");
            foreach (string arg in args)
            {
                writer.WriteStringValue(arg);
            }

            writer.WriteEndArray();
            writer.WriteStartObject("env");
            foreach ((string name, string value) in env)
            {
                writer.WriteString(name, value);
            }

            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }
}
