using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.Capabilities;

public sealed class McpCapabilitiesService(IEnumerable<IMcpProductDetector> detectors) : IMcpCapabilitiesService
{
    public McpCapabilities GetCapabilities() =>
        new(McpAddon.Version, detectors.Select(SafeDetect).ToList());

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
