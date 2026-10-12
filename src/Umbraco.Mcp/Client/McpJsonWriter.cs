using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Umbraco.Mcp.Client;

/// <summary>
/// In Development, writes a <c>.mcp.json</c> next to the site once it has started, so an AI tool opened in that folder
/// starts the MCP server (npx downloads it on first use). The rules for the file are in <see cref="McpJsonFile"/>.
/// </summary>
public sealed class McpJsonWriter(
    IMcpJsonFile file,
    IHostApplicationLifetime lifetime,
    ILogger<McpJsonWriter> logger) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (file.IsAvailable)
        {
            // Server addresses are only known once the server has started.
            lifetime.ApplicationStarted.Register(Write);
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private void Write()
    {
        try
        {
            McpJsonResult result = file.WriteOrUpgrade();
            switch (result.Outcome)
            {
                case McpJsonOutcome.Written:
                    logger.LogInformation(
                        "Wrote {Path} so AI tools opened in that folder can start the Umbraco MCP server. " +
                        "Set the {SecretVariable} environment variable to the API user's client secret.",
                        result.Path,
                        McpClientConfig.SecretEnvironmentVariable);
                    break;
                case McpJsonOutcome.Upgraded:
                    logger.LogInformation("{Message}", result.Message);
                    break;
                case McpJsonOutcome.NoHttpsAddress:
                    logger.LogInformation(
                        "Did not write {FileName}: the site has no HTTPS address, which the MCP server needs.",
                        McpJsonFile.FileName);
                    break;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not write {FileName}.", McpJsonFile.FileName);
        }
    }
}
