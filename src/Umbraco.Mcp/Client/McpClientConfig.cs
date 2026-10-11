using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace Umbraco.Mcp.Client;

/// <summary>Builds the MCP client config (<c>{ "mcpServers": { … } }</c>) that starts the npm server for this site.</summary>
internal static class McpClientConfig
{
    /// <summary>The npm package of the MCP server. Must equal <c>name</c> in <c>npm/package.json</c>.</summary>
    public const string NpmPackage = "umbrella-mcp";

    /// <summary>The key the server is listed under in the client config.</summary>
    public const string ServerName = "umbraco";

    /// <summary>The environment variable a written <c>.mcp.json</c> reads the client secret from.</summary>
    public const string SecretEnvironmentVariable = "UMBRELLA_CLIENT_SECRET";

    /// <summary>The client id suggested to AI tools when <c>Umbraco:Mcp:ClientId</c> is not set.</summary>
    public const string DefaultClientId = "umbraco-back-office-mcp";

    public static string ReadClientId(IConfiguration configuration) =>
        configuration["Umbraco:Mcp:ClientId"] is { Length: > 0 } id ? id : DefaultClientId;

    /// <summary>
    /// npx pins the server to the add-on's own version, because the two halves are released together. An exact
    /// version also avoids range operators, which cmd.exe treats as special characters on Windows.
    /// </summary>
    public static IReadOnlyList<string> NpxArgs(string addonVersion) => ["-y", $"{NpmPackage}@{addonVersion}"];

    public static string Build(string command, IEnumerable<string> args, IEnumerable<KeyValuePair<string, string>> env)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions
        {
            Indented = true,
            // Keeps quotes as \" and leaves < > readable; callers that render HTML encode the result themselves.
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        }))
        {
            writer.WriteStartObject();
            writer.WriteStartObject("mcpServers");
            writer.WriteStartObject(ServerName);
            writer.WriteString("command", command);
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
