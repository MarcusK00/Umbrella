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
/// A detected product. <paramref name="Access"/> is "full", "noDestructive", "readOnly" or "off" (the site's defaults).
/// <paramref name="SectionAlias"/> is the backoffice section an API user needs for its tools; null when it needs none (CMS).
/// <paramref name="ToolCount"/> is how many tools the site's defaults offer from this product (0 when off, null when
/// no report has listed the product yet), and <paramref name="TotalToolCount"/> is the product's total reported tools.
/// A product a connected MCP server should have loaded but did not is a products finding.
/// </summary>
public sealed record McpOverviewProduct(
    string Id,
    string DisplayName,
    bool Installed,
    bool Enabled,
    string? Version,
    IReadOnlyList<string> Issues,
    string Access,
    string? SectionAlias,
    int? ToolCount = null,
    int? TotalToolCount = null);

/// <summary>What the MCP server last reported, and whether it is the add-on's version.</summary>
public sealed record McpServerReport(string Version, DateTimeOffset ReportedAt, bool MatchesAddon);

/// <summary>
/// What an API user's MCP server gets from one product. <paramref name="Level"/> is "full", "noDestructive" or
/// "readOnly"; <paramref name="Scope"/> is "site" (the defaults) or "user" (the user's own settings).
/// <paramref name="ToolCount"/> is how many tools its last start got with these settings: 0 when it did not load the
/// product or has no access to its section, null without a report of its own.
/// <paramref name="SectionAccess"/> is false when none of the user's groups grant the product's
/// backoffice section (a product switched off for the user counts as reachable).
/// <paramref name="SizeBytes"/> is the UTF-8 byte length of those tools as <c>tools/list</c> sends them (0 when off or
/// without section access, null without size data).
/// </summary>
public sealed record McpOverviewAccess(
    string ProductId,
    string DisplayName,
    string Level,
    string Scope,
    int? ToolCount,
    bool SectionAccess,
    int DisabledToolCount = 0,
    int? SizeBytes = null);

/// <summary>
/// An API user the MCP server has connected as, or that the dashboard's New connection flow created and that has not
/// connected yet (<paramref name="Connected"/> false, <paramref name="LastConnected"/> null). A user that has not
/// connected is in no finding and no health check. <paramref name="State"/> is "active", "disabled" or "lockedOut".
/// The reach lists hold product display names. The report fields are from this user's own last start and are null when
/// it has none; <paramref name="Access"/> lists the installed and enabled products, and <paramref name="ToolCount"/> is
/// the sum of their tool counts (null when one of them is unknown). <paramref name="SizeBytes"/> is the sum of their
/// <c>tools/list</c> sizes in bytes (null when one of them is unknown). <paramref name="Groups"/> holds the names of its
/// user groups, sorted, and <paramref name="Sections"/> the backoffice sections they grant.
/// </summary>
public sealed record McpOverviewApiUser(
    Guid Key,
    string Name,
    IReadOnlyList<string> ClientIds,
    string State,
    DateTimeOffset? LastConnected,
    IReadOnlyList<string> Reachable,
    IReadOnlyList<string> Unreachable,
    string? ServerVersion,
    DateTimeOffset? LastReportedAt,
    int? ToolCount,
    IReadOnlyList<McpOverviewAccess> Access,
    IReadOnlyList<string> Groups,
    IReadOnlyList<string> Sections,
    bool Connected,
    int? SizeBytes = null);

/// <summary>
/// Everything the Overview dashboard and the MCP health checks show. <paramref name="CanManageUsers"/> is whether the
/// calling backoffice user has the Users section, so the dashboard can offer to create and change API users; the
/// controller sets it.
/// </summary>
public sealed record McpOverview(
    string AddonVersion,
    IReadOnlyList<McpFinding> Findings,
    IReadOnlyList<McpOverviewProduct> Products,
    McpServerReport? Server,
    IReadOnlyList<McpOverviewApiUser> ApiUsers,
    bool CanManageUsers = false);
