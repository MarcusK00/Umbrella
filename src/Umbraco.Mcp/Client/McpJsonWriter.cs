using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Umbraco.Mcp.Client;

/// <summary>
/// In Development, writes a <c>.mcp.json</c> next to the site once it has started, so an AI tool opened in that folder
/// starts the MCP server (npx downloads it on first use). It never overwrites an existing file and never writes the
/// client secret: the file reads it from <see cref="McpClientConfig.SecretEnvironmentVariable"/>.
/// </summary>
public sealed class McpJsonWriter(
    IHostEnvironment environment,
    IHostApplicationLifetime lifetime,
    IServer server,
    IConfiguration configuration,
    ILogger<McpJsonWriter> logger) : IHostedService
{
    public const string FileName = ".mcp.json";

    private static readonly string[] WildcardHosts = ["*", "+", "0.0.0.0", "[::]"];

    public Task StartAsync(CancellationToken cancellationToken)
    {
        McpJsonOptions options = configuration.GetSection(McpJsonOptions.Section).Get<McpJsonOptions>() ?? new McpJsonOptions();
        if (ShouldWrite(environment.IsDevelopment(), options))
        {
            // Server addresses are only known once the server has started.
            lifetime.ApplicationStarted.Register(() => Write(options));
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private void Write(McpJsonOptions options)
    {
        try
        {
            string? siteUrl = PickSiteUrl(server.Features.Get<IServerAddressesFeature>()?.Addresses ?? []);
            if (siteUrl is null)
            {
                logger.LogInformation("Did not write {FileName}: the site has no HTTPS address, which the MCP server needs.", FileName);
                return;
            }

            string directory = System.IO.Path.GetFullPath(options.Path ?? ".", environment.ContentRootPath);
            string json = BuildJson(siteUrl, McpClientConfig.ReadClientId(configuration), McpAddon.Version, options);
            if (TryWrite(directory, json, out string path))
            {
                logger.LogInformation(
                    "Wrote {Path} so AI tools opened in that folder can start the Umbraco MCP server. " +
                    "Set the {SecretVariable} environment variable to the API user's client secret.",
                    path,
                    McpClientConfig.SecretEnvironmentVariable);
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not write {FileName}.", FileName);
        }
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
