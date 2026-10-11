using System.Text.Json;
using NUnit.Framework;
using Umbraco.Mcp.Client;

namespace Umbraco.Mcp.Tests;

/// <summary>
/// The add-on tells AI tools to run <c>npx umbrella-mcp@&lt;add-on version&gt;</c>, so the npm package must have
/// that name and be released with the same version.
/// </summary>
[TestFixture]
public class NpmPackageContractTests
{
    private static JsonElement ReadPackageJson()
    {
        var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Umbraco.Mcp.slnx")))
        {
            dir = dir.Parent;
        }

        Assert.That(dir, Is.Not.Null, "Could not find the repository root.");
        return JsonDocument.Parse(File.ReadAllText(Path.Combine(dir!.FullName, "npm", "package.json"))).RootElement;
    }

    [Test]
    public void Npm_package_name_matches()
    {
        Assert.That(ReadPackageJson().GetProperty("name").GetString(), Is.EqualTo(McpClientConfig.NpmPackage));
    }

    [Test]
    public void Npm_package_version_matches_the_addon_version()
    {
        Assert.That(ReadPackageJson().GetProperty("version").GetString(), Is.EqualTo(McpAddon.Version));
    }

    [Test]
    public void Npm_package_bin_is_named_after_the_package()
    {
        Assert.That(ReadPackageJson().GetProperty("bin").TryGetProperty(McpClientConfig.NpmPackage, out _), Is.True);
    }
}
