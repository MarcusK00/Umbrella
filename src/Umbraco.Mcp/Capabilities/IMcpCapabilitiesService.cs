namespace Umbraco.Mcp.Capabilities;

public interface IMcpCapabilitiesService
{
    /// <summary>
    /// The detected products with their tool settings. With <paramref name="apiUserKey"/> the API user's own
    /// per-product settings replace the site defaults for the products it overrides. With
    /// <paramref name="allowedSections"/> (the caller's section names) a product whose section is not among them is
    /// marked <see cref="Detection.McpProductStatus.NoSectionAccess"/>.
    /// </summary>
    McpCapabilities GetCapabilities(Guid? apiUserKey = null, IReadOnlyCollection<string>? allowedSections = null);
}
