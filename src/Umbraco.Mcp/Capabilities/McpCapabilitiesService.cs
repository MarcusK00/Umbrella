using Microsoft.Extensions.Logging;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Capabilities;

public sealed class McpCapabilitiesService(
    IEnumerable<IMcpProductDetector> detectors,
    IMcpToolSettingsStore toolSettings,
    ILogger<McpCapabilitiesService> logger) : IMcpCapabilitiesService
{
    public McpCapabilities GetCapabilities(Guid? apiUserKey = null)
    {
        IReadOnlyDictionary<string, IReadOnlyList<string>> disabled = SafeDisabledCollections();
        IReadOnlyList<string> readOnly = SafeReadOnlyModules();
        IReadOnlyList<string> noDestructive = SafeNoDestructiveModules();
        IReadOnlyDictionary<string, McpProductOverride> overrides = SafeUserOverrides(apiUserKey);
        return new(
            McpAddon.Version,
            detectors.Select(d =>
            {
                McpProductStatus status = SafeDetect(d);
                if (overrides.TryGetValue(d.Id, out McpProductOverride? own))
                {
                    // All or nothing: a product the user overrides ignores the defaults completely.
                    return status with
                    {
                        DisabledCollections = own.DisabledCollections,
                        ReadOnly = own.Level == McpToolLevel.ReadOnly,
                        NoDestructive = own.Level == McpToolLevel.NoDestructive,
                        SettingsScope = McpSettingsScope.User,
                    };
                }

                return status with
                {
                    DisabledCollections = disabled.GetValueOrDefault(d.Id),
                    ReadOnly = readOnly.Contains(d.Id, StringComparer.Ordinal),
                    NoDestructive = noDestructive.Contains(d.Id, StringComparer.Ordinal),
                };
            }).ToList());
    }

    private IReadOnlyDictionary<string, McpProductOverride> SafeUserOverrides(Guid? apiUserKey)
    {
        if (apiUserKey is not { } key)
        {
            return new Dictionary<string, McpProductOverride>();
        }

        try
        {
            return toolSettings.GetUserOverrides(key);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read the MCP tool settings for API user {Key}. The defaults apply.", key);
            return new Dictionary<string, McpProductOverride>();
        }
    }

    private IReadOnlyList<string> SafeNoDestructiveModules()
    {
        try
        {
            return toolSettings.GetNoDestructiveModules();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read the MCP no-destructive settings. No product is limited in the capabilities.");
            return [];
        }
    }

    private IReadOnlyList<string> SafeReadOnlyModules()
    {
        try
        {
            return toolSettings.GetReadOnlyModules();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read the MCP read-only settings. No product is read-only in the capabilities.");
            return [];
        }
    }

    private IReadOnlyDictionary<string, IReadOnlyList<string>> SafeDisabledCollections()
    {
        try
        {
            return toolSettings.GetDisabledCollections();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read the MCP tool settings. No tool groups are disabled in the capabilities.");
            return new Dictionary<string, IReadOnlyList<string>>();
        }
    }

    private static McpProductStatus SafeDetect(IMcpProductDetector detector)
    {
        try
        {
            return detector.Detect();
        }
        catch (Exception ex)
        {
            return new McpProductStatus(detector.Id, detector.DisplayName, false, false, null, [$"Detection failed: {ex.Message}"]);
        }
    }
}
