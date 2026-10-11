using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.Capabilities;

public sealed class McpCapabilitiesService(IEnumerable<IMcpProductDetector> detectors) : IMcpCapabilitiesService
{
    private static readonly string AddonVersion =
        AssemblyVersionReader.Read(typeof(McpCapabilitiesService).Assembly) ?? "0.0.0";

    public McpCapabilities GetCapabilities() =>
        new(AddonVersion, detectors.Select(SafeDetect).ToList());

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
