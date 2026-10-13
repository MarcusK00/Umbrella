namespace Umbraco.Mcp.Capabilities;

public interface IMcpCapabilitiesService
{
    /// <summary>
    /// The detected products with their tool settings. With <paramref name="apiUserKey"/> the API user's own
    /// per-product settings replace the site defaults for the products it overrides.
    /// </summary>
    McpCapabilities GetCapabilities(Guid? apiUserKey = null);
}
