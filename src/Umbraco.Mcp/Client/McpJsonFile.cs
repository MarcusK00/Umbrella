using System.Text.Json;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Umbraco.Cms.Core.Semver;

namespace Umbraco.Mcp.Client;

/// <summary>What <see cref="IMcpJsonFile.WriteOrUpgrade"/> did. The values are serialised for the dashboard, so they are fixed.</summary>
public static class McpJsonOutcome
{
    public const string Written = "written";
    public const string Upgraded = "upgraded";
    public const string UpToDate = "upToDate";
    public const string NotTouched = "notTouched";
    public const string NoHttpsAddress = "noHttpsAddress";
    public const string FolderMissing = "folderMissing";
}

/// <summary>The outcome of a write, the full path of the <c>.mcp.json</c> it concerns and a sentence saying what happened.</summary>
public sealed record McpJsonResult(string Outcome, string Path, string Message);

/// <summary>Writes or upgrades the <c>.mcp.json</c> next to the site.</summary>
public interface IMcpJsonFile
{
    /// <summary>True in Development when <c>Umbraco:Mcp:McpJson:Enabled</c> is not switched off.</summary>
    bool IsAvailable { get; }

    /// <summary>The full path of the file when <see cref="IsAvailable"/>, otherwise null.</summary>
    string? Path { get; }

    /// <summary>
    /// Creates the file, or upgrades one this add-on wrote for an older version. Never overwrites an edited file, never creates
    /// folders and never writes the client secret: the file reads it from <see cref="McpClientConfig.SecretEnvironmentVariable"/>.
    /// </summary>
    McpJsonResult WriteOrUpgrade();
}

/// <inheritdoc />
public sealed class McpJsonFile(IHostEnvironment environment, IServer server, IConfiguration configuration) : IMcpJsonFile
{
    public const string FileName = ".mcp.json";

    private static readonly string[] WildcardHosts = ["*", "+", "0.0.0.0", "[::]"];

    public bool IsAvailable => ShouldWrite(environment.IsDevelopment(), ReadOptions());

    public string? Path
    {
        get
        {
            McpJsonOptions options = ReadOptions();
            return ShouldWrite(environment.IsDevelopment(), options)
                ? System.IO.Path.Combine(DirectoryFor(options), FileName)
                : null;
        }
    }

    public McpJsonResult WriteOrUpgrade()
    {
        McpJsonOptions options = ReadOptions();
        string? siteUrl = PickSiteUrl(server.Features.Get<IServerAddressesFeature>()?.Addresses ?? []);
        string clientId = McpClientConfig.ReadClientId(configuration);

        return WriteOrUpgrade(
            DirectoryFor(options),
            siteUrl,
            version => BuildJson(siteUrl!, clientId, version, options),
            McpAddon.Version);
    }

    private McpJsonOptions ReadOptions() =>
        configuration.GetSection(McpJsonOptions.Section).Get<McpJsonOptions>() ?? new McpJsonOptions();

    private string DirectoryFor(McpJsonOptions options) =>
        System.IO.Path.GetFullPath(options.Path ?? ".", environment.ContentRootPath);

    /// <summary>
    /// The testable core. Checks, in order: no site URL, missing folder, create, upgrade, already what it would write,
    /// otherwise leave the file alone. IO exceptions are not caught.
    /// </summary>
    internal static McpJsonResult WriteOrUpgrade(string directory, string? siteUrl, Func<string, string> buildForVersion, string addonVersion)
    {
        string path = System.IO.Path.Combine(directory, FileName);

        if (siteUrl is null)
        {
            return new McpJsonResult(
                McpJsonOutcome.NoHttpsAddress,
                path,
                "The site has no HTTPS address, which the MCP server needs, so nothing was written.");
        }

        if (!Directory.Exists(directory))
        {
            return new McpJsonResult(
                McpJsonOutcome.FolderMissing,
                path,
                $"The folder {directory} does not exist, so nothing was written.");
        }

        if (TryWrite(directory, buildForVersion(addonVersion), out path))
        {
            return new McpJsonResult(
                McpJsonOutcome.Written,
                path,
                $"Wrote {path}. Set {McpClientConfig.SecretEnvironmentVariable} and open your AI tool in that folder.");
        }

        if (TryUpgrade(path, buildForVersion, addonVersion, out _))
        {
            return new McpJsonResult(
                McpJsonOutcome.Upgraded,
                path,
                $"Upgraded {path} to {McpClientConfig.NpmPackage} {addonVersion}. Restart the MCP server in your AI tool.");
        }

        return File.ReadAllText(path) == buildForVersion(addonVersion)
            ? new McpJsonResult(McpJsonOutcome.UpToDate, path, $"{path} is already up to date.")
            : new McpJsonResult(McpJsonOutcome.NotTouched, path, $"{path} was edited or pins a newer version, so it was left as it is.");
    }

    internal static bool ShouldWrite(bool isDevelopment, McpJsonOptions options) => isDevelopment && options.Enabled;

    /// <summary>Picks the first HTTPS address, with wildcard hosts replaced by localhost. Null when there is none.</summary>
    internal static string? PickSiteUrl(IEnumerable<string> addresses)
    {
        foreach (string address in addresses)
        {
            string normalized = WildcardHosts.Aggregate(address, (a, host) => a.Replace($"://{host}:", "://localhost:"));
            if (Uri.TryCreate(normalized, UriKind.Absolute, out Uri? uri) && uri.Scheme == Uri.UriSchemeHttps)
            {
                return uri.GetLeftPart(UriPartial.Authority);
            }
        }

        return null;
    }

    internal static string BuildJson(string siteUrl, string clientId, string addonVersion, McpJsonOptions options)
    {
        var env = new List<KeyValuePair<string, string>>
        {
            new("UMBRACO_BASE_URL", siteUrl),
            new("UMBRACO_CLIENT_ID", clientId),
            new("UMBRACO_CLIENT_SECRET", $"${{{McpClientConfig.SecretEnvironmentVariable}}}"),
        };

        // Node does not trust the ASP.NET Core development certificate. Only ever relaxed for the local machine.
        if (new Uri(siteUrl).IsLoopback)
        {
            env.Add(new("NODE_TLS_REJECT_UNAUTHORIZED", "0"));
        }

        return McpClientConfig.Build(
            options.Command ?? "npx",
            options.Args ?? McpClientConfig.NpxArgs(addonVersion),
            env);
    }

    /// <summary>
    /// Moves a <c>.mcp.json</c> this add-on created to <paramref name="addonVersion"/>. Only when the file is exactly what
    /// <paramref name="buildForVersion"/> gives for the version it pins, so a file someone edited is never touched, and
    /// only to a newer version, so switching to a branch with an older add-on does not flip the file back.
    /// </summary>
    internal static bool TryUpgrade(string path, Func<string, string> buildForVersion, string addonVersion, out string? from)
    {
        from = null;
        string existing = File.ReadAllText(path);
        string? pinned = ReadPinnedVersion(existing);
        if (pinned is null
            || buildForVersion(pinned) != existing
            || !SemVersion.TryParse(pinned, out SemVersion? old, false)
            || !SemVersion.TryParse(addonVersion, out SemVersion? current, false)
            || !(current > old))
        {
            return false;
        }

        File.WriteAllText(path, buildForVersion(addonVersion));
        from = pinned;
        return true;
    }

    /// <summary>The version in the <c>umbrella-mcp@&lt;version&gt;</c> argument of the server entry, or null.</summary>
    private static string? ReadPinnedVersion(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("mcpServers", out JsonElement servers)
                && servers.ValueKind == JsonValueKind.Object
                && servers.TryGetProperty(McpClientConfig.ServerName, out JsonElement server)
                && server.ValueKind == JsonValueKind.Object
                && server.TryGetProperty("args", out JsonElement args)
                && args.ValueKind == JsonValueKind.Array)
            {
                string prefix = McpClientConfig.NpmPackage + "@";
                return args.EnumerateArray()
                    .Where(a => a.ValueKind == JsonValueKind.String)
                    .Select(a => a.GetString()!)
                    .FirstOrDefault(a => a.StartsWith(prefix, StringComparison.Ordinal) && a.Length > prefix.Length)?[prefix.Length..];
            }
        }
        catch (JsonException)
        {
        }

        return null;
    }

    /// <summary>Creates <c>.mcp.json</c> in <paramref name="directory"/>; false when the folder is missing or the file exists.</summary>
    internal static bool TryWrite(string directory, string json, out string path)
    {
        path = System.IO.Path.Combine(directory, FileName);
        if (!Directory.Exists(directory) || File.Exists(path))
        {
            return false;
        }

        try
        {
            // CreateNew fails rather than overwrite if another process created the file in the meantime.
            using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write);
            using var writer = new StreamWriter(stream);
            writer.Write(json);
            return true;
        }
        catch (IOException) when (File.Exists(path))
        {
            return false;
        }
    }
}
