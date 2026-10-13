namespace Umbraco.Mcp.Detection;

/// <summary>Product ids the add-on treats specially.</summary>
public static class McpProducts
{
    /// <summary>
    /// The product the npm server cannot run without: it signs in through it, so it can never be switched off. Must equal
    /// the id of the npm module with <c>required: true</c> (<c>NpmPackageContractTests</c>).
    /// </summary>
    public const string RequiredId = "cms";
}
