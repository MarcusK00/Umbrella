using NUnit.Framework;
using Umbraco.Mcp.Api;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpCatalogueFallbackTests
{
    private static readonly DateTimeOffset T1 = new(2026, 10, 1, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset T2 = new(2026, 10, 2, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset T3 = new(2026, 10, 3, 8, 0, 0, TimeSpan.Zero);

    private static McpToolCatalogue Catalogue(params DateTimeOffset[] reportedAt) =>
        new("17.0.0", reportedAt.Select((at, i) => (at, i)).ToDictionary(
            x => $"module-{x.i}",
            x => new McpModuleCatalogue(x.at, false, [new McpCollectionInfo("form", 3)])));

    [Test]
    public void Own_catalogue_wins()
    {
        Guid me = Guid.NewGuid(), other = Guid.NewGuid();
        McpToolCatalogue own = Catalogue(T1);

        var (catalogue, source) = McpCatalogueFallback.Resolve(
            me,
            new Dictionary<Guid, McpToolCatalogue> { [me] = own, [other] = Catalogue(T3) },
            Catalogue(T3),
            new Dictionary<Guid, string> { [me] = "Me", [other] = "Other" });

        Assert.That(catalogue, Is.SameAs(own));
        Assert.That(source.Kind, Is.EqualTo("user"));
        Assert.That(source.ReportedAt, Is.EqualTo(T1));
    }

    [Test]
    public void Latest_other_user_is_named()
    {
        Guid me = Guid.NewGuid(), older = Guid.NewGuid(), newer = Guid.NewGuid();
        McpToolCatalogue expected = Catalogue(T1, T3);

        var (catalogue, source) = McpCatalogueFallback.Resolve(
            me,
            new Dictionary<Guid, McpToolCatalogue> { [me] = McpToolCatalogue.Empty, [older] = Catalogue(T2), [newer] = expected },
            Catalogue(T1),
            new Dictionary<Guid, string> { [me] = "Me", [older] = "Older", [newer] = "Newer" });

        Assert.That(catalogue, Is.SameAs(expected));
        Assert.That(source, Is.EqualTo(new McpCatalogueSource("latest", T3, "Newer")));
    }

    [Test]
    public void Fallback_skips_catalogues_of_users_that_are_not_api_users()
    {
        Guid me = Guid.NewGuid(), gone = Guid.NewGuid(), real = Guid.NewGuid();
        McpToolCatalogue expected = Catalogue(T1);

        var (catalogue, source) = McpCatalogueFallback.Resolve(
            me,
            new Dictionary<Guid, McpToolCatalogue> { [gone] = Catalogue(T3), [real] = expected },
            McpToolCatalogue.Empty,
            new Dictionary<Guid, string> { [me] = "Me", [real] = "Real" });

        Assert.That(catalogue, Is.SameAs(expected));
        Assert.That(source, Is.EqualTo(new McpCatalogueSource("latest", T1, "Real")));
    }

    [Test]
    public void Shared_row_when_no_user_has_reported()
    {
        Guid me = Guid.NewGuid();
        McpToolCatalogue shared = Catalogue(T1, T2);

        var (catalogue, source) = McpCatalogueFallback.Resolve(
            me, new Dictionary<Guid, McpToolCatalogue>(), shared, new Dictionary<Guid, string> { [me] = "Me" });

        Assert.That(catalogue, Is.SameAs(shared));
        Assert.That(source, Is.EqualTo(new McpCatalogueSource("latest", T2, null)));
    }

    [Test]
    public void None_when_nothing_was_reported()
    {
        Guid me = Guid.NewGuid();

        var (catalogue, source) = McpCatalogueFallback.Resolve(
            me, new Dictionary<Guid, McpToolCatalogue>(), McpToolCatalogue.Empty, new Dictionary<Guid, string> { [me] = "Me" });

        Assert.That(catalogue, Is.SameAs(McpToolCatalogue.Empty));
        Assert.That(source, Is.EqualTo(new McpCatalogueSource("none")));
    }
}
