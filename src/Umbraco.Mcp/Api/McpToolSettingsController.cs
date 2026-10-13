using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Capabilities;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Api;

/// <param name="AddonVersion">The add-on's version, for comparing with the version in the catalogue.</param>
public sealed record McpToolSettingsResponse(
    string AddonVersion,
    IReadOnlyList<McpProductStatus> Products,
    McpToolCatalogue Catalogue,
    IReadOnlyDictionary<string, IReadOnlyList<string>> DisabledCollections,
    IReadOnlyList<string> ReadOnlyModules,
    IReadOnlyList<string> NoDestructiveModules,
    IReadOnlyList<McpToolSettingsApiUser> ApiUsers);

/// <summary>An API user for the dashboard's picker, with when its MCP server last reported and which products it overrides.</summary>
/// <param name="State">"active", "disabled" or "lockedOut".</param>
public sealed record McpToolSettingsApiUser(
    Guid Key,
    string Name,
    IReadOnlyList<string> ClientIds,
    string State,
    DateTimeOffset? LastReportedAt,
    IReadOnlyList<string> OverriddenProducts);

/// <summary>Where the catalogue shown for a user comes from.</summary>
/// <param name="Kind">"user" (its own report), "latest" (the most recent report of another user or of the site) or "none".</param>
public sealed record McpCatalogueSource(string Kind, DateTimeOffset? ReportedAt = null, string? UserName = null);

public sealed record McpUserToolSettingsResponse(
    IReadOnlyDictionary<string, McpProductOverride> Overrides,
    McpToolCatalogue Catalogue,
    McpCatalogueSource CatalogueSource);

public sealed record McpProductOverrideRequest(IReadOnlyList<string?>? DisabledCollections, string? Level);

/// <summary>Replaces one API user's overrides. An empty map makes the user follow the defaults again.</summary>
public sealed record McpUserToolSettingsRequest(IReadOnlyDictionary<string, McpProductOverrideRequest?>? Overrides);

public sealed record McpUserOverridesSaved(IReadOnlyDictionary<string, McpProductOverride> Overrides);

/// <summary>
/// Replaces all tool settings. A missing <paramref name="ReadOnlyModules"/> means no product is read-only, and a missing
/// <paramref name="NoDestructiveModules"/> means no product is limited to non-destructive tools.
/// </summary>
public sealed record McpToolSettingsRequest(
    IReadOnlyDictionary<string, IReadOnlyList<string>?>? DisabledCollections,
    IReadOnlyList<string?>? ReadOnlyModules = null,
    IReadOnlyList<string?>? NoDestructiveModules = null);

public sealed record McpToolSettings(
    IReadOnlyDictionary<string, IReadOnlyList<string>> DisabledCollections,
    IReadOnlyList<string> ReadOnlyModules,
    IReadOnlyList<string> NoDestructiveModules);

[ApiVersion("1.0")]
[VersionedApiBackOfficeRoute("mcp")]
[ApiExplorerSettings(GroupName = "MCP")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess)]
public sealed class McpToolSettingsController(
    IMcpToolSettingsStore store,
    IMcpCapabilitiesService capabilities,
    IMcpApiUserDirectory apiUsers,
    IBackOfficeSecurityAccessor backOfficeSecurityAccessor,
    ILogger<McpToolSettingsController> logger) : ManagementApiControllerBase
{
    /// <summary>
    /// What the "Umbrella" dashboard shows: the products, the groups the MCP server reported, what is switched off and
    /// which products are read-only.
    /// </summary>
    [HttpGet("tool-settings")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(McpToolSettingsResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetToolSettings()
    {
        McpCapabilities caps = capabilities.GetCapabilities();
        (List<McpToolSettingsApiUser> users, McpToolCatalogue catalogue) = await ReadApiUsersAsync();
        return Ok(new McpToolSettingsResponse(
            caps.AddonVersion,
            caps.Products,
            catalogue,
            store.GetDisabledCollections(),
            store.GetReadOnlyModules(),
            store.GetNoDestructiveModules(),
            users));
    }

    /// <summary>
    /// The picker's API users with their reports and overrides, and the catalogue the defaults show: the highest counts
    /// any of them reported. A failing read must not stop the defaults from loading, so it logs a warning and the
    /// dashboard shows no per-user picker and the shared catalogue.
    /// </summary>
    private async Task<(List<McpToolSettingsApiUser> Users, McpToolCatalogue Catalogue)> ReadApiUsersAsync()
    {
        try
        {
            IReadOnlyDictionary<Guid, McpToolCatalogue> userCatalogues = store.GetAllUserCatalogues();
            IReadOnlyDictionary<Guid, IReadOnlyDictionary<string, McpProductOverride>> userOverrides = store.GetAllUserOverrides();
            IReadOnlyList<McpApiUserInfo> existing = await apiUsers.GetAllAsync();
            McpToolCatalogue highest = McpCatalogueFallback.Highest(userCatalogues, store.GetCatalogue(), existing.Select(u => u.Key).ToHashSet());
            List<McpToolSettingsApiUser> users = existing
                .Select(u => new McpToolSettingsApiUser(
                    u.Key,
                    u.Name,
                    u.ClientIds,
                    McpUserStates.Name(u.State),
                    userCatalogues.TryGetValue(u.Key, out McpToolCatalogue? catalogue) && catalogue.Modules.Count > 0
                        ? McpCatalogueFallback.LatestReportedAt(catalogue)
                        : null,
                    userOverrides.TryGetValue(u.Key, out IReadOnlyDictionary<string, McpProductOverride>? overrides)
                        ? overrides.Keys.Order(StringComparer.Ordinal).ToList()
                        : []))
                .ToList();
            return (users, highest);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Umbrella could not read the API users' tool settings; showing the defaults only");
            return ([], store.GetCatalogue());
        }
    }

    /// <summary>One API user's own settings and the catalogue to show for it (its own, or the closest fallback).</summary>
    [HttpGet("tool-settings/users/{userKey:guid}")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(McpUserToolSettingsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetUserToolSettings(Guid userKey)
    {
        if (await apiUsers.GetAsync(userKey) is null)
        {
            return NotFound();
        }

        var names = (await apiUsers.GetAllAsync()).ToDictionary(u => u.Key, u => u.Name);
        (McpToolCatalogue catalogue, McpCatalogueSource source) =
            McpCatalogueFallback.Resolve(userKey, store.GetAllUserCatalogues(), store.GetCatalogue(), names);
        return Ok(new McpUserToolSettingsResponse(store.GetUserOverrides(userKey), catalogue, source));
    }

    /// <summary>Replaces one API user's overrides. An empty map makes the user follow the defaults.</summary>
    [HttpPut("tool-settings/users/{userKey:guid}")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(McpUserOverridesSaved), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> PutUserToolSettings(Guid userKey, [FromBody] McpUserToolSettingsRequest request)
    {
        if (await apiUsers.GetAsync(userKey) is null)
        {
            return NotFound();
        }

        var known = capabilities.GetCapabilities().Products.Select(p => p.Id).ToHashSet(StringComparer.Ordinal);
        string? error = McpToolSettingsValidation.TryNormalizeOverrides(request?.Overrides, known, out var overrides);
        if (error is not null)
        {
            return BadRequest(new ProblemDetails { Title = "Invalid MCP tool settings", Detail = error });
        }

        store.SetUserOverrides(userKey, overrides);
        return Ok(new McpUserOverridesSaved(overrides));
    }

    [HttpPut("tool-settings")]
    [MapToApiVersion("1.0")]
    [Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
    [ProducesResponseType(typeof(McpToolSettings), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    public IActionResult PutToolSettings([FromBody] McpToolSettingsRequest request)
    {
        var known = capabilities.GetCapabilities().Products.Select(p => p.Id).ToHashSet(StringComparer.Ordinal);
        string? settingsError = McpToolSettingsValidation.TryNormalizeSettings(request?.DisabledCollections, known, out var disabled);
        string? readOnlyError = McpToolSettingsValidation.TryNormalizeModuleIds(request?.ReadOnlyModules, known, "readOnlyModules", out var readOnly);
        string? noDestructiveError = McpToolSettingsValidation.TryNormalizeModuleIds(request?.NoDestructiveModules, known, "noDestructiveModules", out var noDestructive);
        string? overlapError = McpToolSettingsValidation.CheckLevelOverlap(readOnly, noDestructive);
        if ((settingsError ?? readOnlyError ?? noDestructiveError ?? overlapError) is { } error)
        {
            return BadRequest(new ProblemDetails { Title = "Invalid MCP tool settings", Detail = error });
        }

        store.SetDisabledCollections(disabled);
        store.SetReadOnlyModules(readOnly);
        store.SetNoDestructiveModules(noDestructive);
        return Ok(new McpToolSettings(disabled, readOnly, noDestructive));
    }

    /// <summary>
    /// The MCP server calls this once when it starts, signed in as its API user, with every tool group it loaded. Calls
    /// from normal backoffice users (for example Swagger) are not the MCP server and are refused.
    /// </summary>
    [HttpPost("catalogue")]
    [MapToApiVersion("1.0")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public IActionResult PostCatalogue([FromBody] McpCatalogueReport report)
    {
        IUser? caller = backOfficeSecurityAccessor.BackOfficeSecurity?.CurrentUser;
        if (caller?.Kind != UserKind.Api)
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }

        string? error = McpToolSettingsValidation.TryNormalizeReport(report, out McpCatalogueReport normalized);
        if (error is not null)
        {
            return BadRequest(new ProblemDetails { Title = "Invalid MCP catalogue", Detail = error });
        }

        DateTimeOffset now = DateTimeOffset.UtcNow;
        store.SetUserCatalogue(caller.Key, normalized, now);
        store.MergeCatalogue(normalized, now);
        return NoContent();
    }
}
