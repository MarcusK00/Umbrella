using Umbraco.Mcp.Client;

namespace Umbraco.Mcp.Overview;

/// <summary>One thing the Overview wants a person to know. The message is plain text; whoever renders it encodes it.</summary>
public sealed record McpFinding(string Severity, string Area, string Message)
{
    public const string Warning = "warning";
    public const string Info = "info";
}

/// <summary>Which part of the setup a <see cref="McpFinding"/> is about. The values are serialised for the dashboard.</summary>
public static class McpFindingArea
{
    public const string Products = "products";
    public const string Server = "server";
    public const string ApiUsers = "apiUsers";
}

/// <summary>
/// A detected product, and whether and with how many tools the MCP server has loaded it. <paramref name="Access"/> is
/// "full", "noDestructive" or "readOnly".
/// </summary>
public sealed record McpOverviewProduct(
    string Id,
    string DisplayName,
    bool Installed,
    bool Enabled,
    string? Version,
    IReadOnlyList<string> Issues,
    bool Loaded,
    int ToolCount,
    string Access);

/// <summary>What the MCP server last reported, and whether it is the add-on's version.</summary>
public sealed record McpServerReport(string Version, DateTimeOffset ReportedAt, bool MatchesAddon);

/// <summary>
/// An API user the MCP server has connected as. <paramref name="State"/> is "active", "disabled" or "lockedOut".
/// The reach lists hold product display names.
/// </summary>
public sealed record McpOverviewApiUser(
    Guid Key,
    string Name,
    IReadOnlyList<string> ClientIds,
    string State,
    DateTimeOffset LastConnected,
    IReadOnlyList<string> Reachable,
    IReadOnlyList<string> Unreachable);

/// <summary>Whether the site can write a <c>.mcp.json</c>, and where.</summary>
public sealed record McpJsonStatus(bool Available, string? Path);

/// <summary>Everything the Overview dashboard and the MCP health checks show.</summary>
public sealed record McpOverview(
    string AddonVersion,
    IReadOnlyList<McpFinding> Findings,
    IReadOnlyList<McpOverviewProduct> Products,
    McpServerReport? Server,
    IReadOnlyList<McpOverviewApiUser> ApiUsers,
    IReadOnlyList<McpClientSnippet> Clients,
    McpJsonStatus McpJson);
