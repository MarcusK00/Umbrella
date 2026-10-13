using Umbraco.Mcp.Client;
using Umbraco.Mcp.Overview;

namespace Umbraco.Mcp.Tests;

/// <summary>Builds <see cref="McpOverview"/> inputs for the health check row tests.</summary>
internal static class TestOverview
{
    public static readonly DateTimeOffset At = new(2026, 10, 11, 9, 5, 0, TimeSpan.Zero);

    public static McpOverview Make(
        IReadOnlyList<McpFinding>? findings = null,
        IReadOnlyList<McpOverviewProduct>? products = null,
        McpServerReport? server = null,
        IReadOnlyList<McpOverviewApiUser>? users = null) =>
        new("17.0.0", findings ?? [], products ?? [], server, users ?? [], Array.Empty<McpClientSnippet>(), new McpJsonStatus(false, null));

    public static McpOverviewProduct Product(string name, bool installed = true, string? version = "17.0.0", string[]? issues = null) =>
        new(name.ToLowerInvariant(), name, installed, installed, version, issues ?? [], installed, 0, "full", 0);

    public static McpOverviewApiUser User(
        string name = "MCP API user",
        string state = "active",
        string[]? clientIds = null,
        string[]? reachable = null,
        string[]? unreachable = null) =>
        new(Guid.NewGuid(), name, clientIds ?? ["umbraco-back-office-mcp"], state, At, reachable ?? [], unreachable ?? [], null, null, null, []);
}
