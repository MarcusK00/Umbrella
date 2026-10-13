namespace Umbraco.Mcp.Overview;

public interface IMcpOverviewService
{
    /// <summary>
    /// Builds the overview. Each part is read on its own, so one that fails is left empty and reported as a finding.
    /// </summary>
    Task<McpOverview> GetOverviewAsync();
}
