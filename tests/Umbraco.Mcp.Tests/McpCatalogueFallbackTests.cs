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

    private static McpModuleCatalogue Module(DateTimeOffset at, params McpCollectionInfo[] collections) =>
        new(at, false, collections);

    [Test]
    public void Highest_takes_the_most_tools_per_group_across_api_users()
    {
        Guid editor = Guid.NewGuid(), admin = Guid.NewGuid();
        var catalogues = new Dictionary<Guid, McpToolCatalogue>
        {
            [editor] = new("17.0.0", new Dictionary<string, McpModuleCatalogue>
            {
                ["cms"] = Module(T1, new McpCollectionInfo("document", 20, 10, false, 15), new McpCollectionInfo("user", 0, 0, false, 0)),
                ["forms"] = Module(T1, new McpCollectionInfo("form", 30, 12, false, 25)),
            }),
            [admin] = new("17.0.0", new Dictionary<string, McpModuleCatalogue>
            {
                ["cms"] = Module(T2, new McpCollectionInfo("document", 50, 27, false, 40), new McpCollectionInfo("user", 9, 4, false, 7), new McpCollectionInfo("imaging", 1, 1, true, 1)),
            }),
        };

        McpToolCatalogue highest = McpCatalogueFallback.Highest(catalogues, Catalogue(T3), new HashSet<Guid> { editor, admin });

        Assert.That(highest.Modules["cms"].Collections, Is.EqualTo(new McpCollectionInfo[]
        {
            new("document", 50, 27, false, 40),
            new("user", 9, 4, false, 7),
            new("imaging", 1, 1, true, 1),
        }));
        Assert.That(highest.Modules["cms"].ReportedAt, Is.EqualTo(T2));
        Assert.That(highest.Modules["forms"].Collections, Is.EqualTo(new McpCollectionInfo[] { new("form", 30, 12, false, 25) }));
    }

    [Test]
    public void Highest_keeps_a_count_missing_when_no_report_has_it()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        var catalogues = new Dictionary<Guid, McpToolCatalogue>
        {
            [a] = new("17.0.0", new Dictionary<string, McpModuleCatalogue> { ["cms"] = Module(T1, new McpCollectionInfo("document", 20)) }),
            [b] = new("17.0.0", new Dictionary<string, McpModuleCatalogue> { ["cms"] = Module(T2, new McpCollectionInfo("document", 5, 3)) }),
        };

        McpCollectionInfo document = McpCatalogueFallback.Highest(catalogues, McpToolCatalogue.Empty, new HashSet<Guid> { a, b })
            .Modules["cms"].Collections.Single();

        Assert.That(document, Is.EqualTo(new McpCollectionInfo("document", 20, 3)));
    }

    [Test]
    public void Highest_ignores_catalogues_of_users_that_are_not_api_users()
    {
        Guid user = Guid.NewGuid(), ghost = Guid.NewGuid();
        var catalogues = new Dictionary<Guid, McpToolCatalogue>
        {
            [user] = new("17.0.0", new Dictionary<string, McpModuleCatalogue> { ["cms"] = Module(T1, new McpCollectionInfo("document", 20)) }),
            [ghost] = new("17.0.0", new Dictionary<string, McpModuleCatalogue> { ["cms"] = Module(T2, new McpCollectionInfo("document", 99)) }),
        };

        McpToolCatalogue highest = McpCatalogueFallback.Highest(catalogues, McpToolCatalogue.Empty, new HashSet<Guid> { user });

        Assert.That(highest.Modules["cms"].Collections.Single().ToolCount, Is.EqualTo(20));
    }

    [Test]
    public void Highest_is_the_shared_row_when_no_api_user_has_its_own_report()
    {
        McpToolCatalogue shared = Catalogue(T1);

        McpToolCatalogue highest = McpCatalogueFallback.Highest(
            new Dictionary<Guid, McpToolCatalogue> { [Guid.NewGuid()] = Catalogue(T2) },
            shared,
            new HashSet<Guid>());

        Assert.That(highest, Is.SameAs(shared));
    }
}
