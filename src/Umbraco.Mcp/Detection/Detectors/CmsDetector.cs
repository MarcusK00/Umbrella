using Umbraco.Cms.Core.Configuration;

namespace Umbraco.Mcp.Detection.Detectors;

/// <summary>The CMS is always present when this addon runs.</summary>
public sealed class CmsDetector(IUmbracoVersion umbracoVersion) : IMcpProductDetector
{
    public string Id => "cms";
    public string DisplayName => "Umbraco CMS";

    public McpProductStatus Detect() =>
        new(Id, DisplayName, true, true, umbracoVersion.Version.ToString(3), []);
}
