namespace Umbraco.Mcp.Overview;

public interface IMcpOverviewService
{
    /// <summary>
    /// Builds the overview. Each part is read on its own, so one that fails is left empty and reported as a finding.
    /// <paramref name="siteUrl"/> is used in the client snippets; null gives a placeholder.
    /// </summary>
    Task<McpOverview> GetOverviewAsync(string? siteUrl);
}
