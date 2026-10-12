using Microsoft.Extensions.Logging;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Capabilities;

public sealed class McpCapabilitiesService(
    IEnumerable<IMcpProductDetector> detectors,
    IMcpToolSettingsStore toolSettings,
    ILogger<McpCapabilitiesService> logger) : IMcpCapabilitiesService
{
    public McpCapabilities GetCapabilities()
    {
        IReadOnlyDictionary<string, IReadOnlyList<string>> disabled = SafeDisabledCollections();
        IReadOnlyList<string> readOnly = SafeReadOnlyModules();
        return new(
            McpAddon.Version,
            detectors.Select(d => SafeDetect(d) with
            {
                DisabledCollections = disabled.GetValueOrDefault(d.Id) ?? [],
                ReadOnly = readOnly.Contains(d.Id, StringComparer.Ordinal),
            }).ToList());
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
