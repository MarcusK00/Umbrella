using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp;

internal static class McpAddon
{
    /// <summary>The NuGet package id the add-on ships as.</summary>
    public const string PackageId = "Umbraco.Community.Umbrella";

    /// <summary>The add-on's version. The npm server is released with the same version.</summary>
    public static readonly string Version = AssemblyVersionReader.Read(typeof(McpAddon).Assembly) ?? "0.0.0";
}
