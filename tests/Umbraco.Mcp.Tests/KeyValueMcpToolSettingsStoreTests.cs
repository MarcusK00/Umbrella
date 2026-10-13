using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class KeyValueMcpToolSettingsStoreTests
{
    private static readonly DateTimeOffset First = new(2026, 10, 12, 9, 0, 0, TimeSpan.Zero);

    private static KeyValueMcpToolSettingsStore Store(FakeKeyValueService values) =>
        new(values, NullLogger<KeyValueMcpToolSettingsStore>.Instance);

    private static McpModuleReport Module(string id, params string[] collections) =>
        new(id, false, collections.Select(c => new McpCollectionInfo(c, 3)).ToList());

    [Test]
    public void Nothing_stored_means_nothing_disabled_and_nothing_reported()
    {
        var store = Store(new FakeKeyValueService());

        Assert.That(store.GetDisabledCollections(), Is.Empty);
        Assert.That(store.GetReadOnlyModules(), Is.Empty);
        Assert.That(store.GetCatalogue().Modules, Is.Empty);
        Assert.That(store.GetCatalogue().UmbrellaVersion, Is.Null);
    }

    [Test]
    public void Read_only_modules_round_trip_in_their_own_row()
    {
        var values = new FakeKeyValueService();
        var store = Store(values);

        store.SetReadOnlyModules(["forms", "cms"]);

        Assert.That(store.GetReadOnlyModules(), Is.EqualTo(new[] { "forms", "cms" }));
        Assert.That(values.Values[KeyValueMcpToolSettingsStore.ReadOnlyKey], Is.EqualTo("[\"forms\",\"cms\"]"));
        Assert.That(values.Values.ContainsKey(KeyValueMcpToolSettingsStore.SettingsKey), Is.False);
    }

    [Test]
    public void No_destructive_modules_round_trip()
    {
        var values = new FakeKeyValueService();
        var store = Store(values);

        store.SetNoDestructiveModules(["forms", "cms"]);

        Assert.That(store.GetNoDestructiveModules(), Is.EqualTo(new[] { "forms", "cms" }));
        Assert.That(values.Values[KeyValueMcpToolSettingsStore.NoDestructiveKey], Is.EqualTo("[\"forms\",\"cms\"]"));
        Assert.That(store.GetReadOnlyModules(), Is.Empty);
    }

    [Test]
    public void No_destructive_modules_empty_when_nothing_stored()
    {
        Assert.That(Store(new FakeKeyValueService()).GetNoDestructiveModules(), Is.Empty);
    }

    [Test]
    public void Catalogue_round_trips_disabledByDefault()
    {
        var values = new FakeKeyValueService();
        Store(values).MergeCatalogue(new McpCatalogueReport("1.0.0", [new McpModuleReport("forms", false, [new McpCollectionInfo("umbraco-server", 1, 1, true)])]), First);

        Assert.That(Store(values).GetCatalogue().Modules["forms"].Collections.Single().DisabledByDefault, Is.True);
    }

    [Test]
    public void The_catalogue_stores_read_only_tool_counts()
    {
        var values = new FakeKeyValueService();
        Store(values).MergeCatalogue(new McpCatalogueReport("1.0.0", [new McpModuleReport("forms", false, [new McpCollectionInfo("form", 9, 4)])]), First);

        Assert.That(values.Values[KeyValueMcpToolSettingsStore.CatalogueKey], Does.Contain("\"readOnlyToolCount\":4"));
        Assert.That(Store(values).GetCatalogue().Modules["forms"].Collections.Single(), Is.EqualTo(new McpCollectionInfo("form", 9, 4)));
    }

    [Test]
    public void Disabled_collections_round_trip_as_camel_case_json()
    {
        var values = new FakeKeyValueService();
        var store = Store(values);

        store.SetDisabledCollections(new Dictionary<string, IReadOnlyList<string>>
        {
            ["forms"] = ["prevalue-source"],
            ["cms"] = ["log-viewer", "models-builder"],
        });

        Assert.That(store.GetDisabledCollections()["forms"], Is.EqualTo(new[] { "prevalue-source" }));
        Assert.That(store.GetDisabledCollections()["cms"], Is.EqualTo(new[] { "log-viewer", "models-builder" }));
        Assert.That(values.Values[KeyValueMcpToolSettingsStore.SettingsKey], Does.Contain("\"forms\":[\"prevalue-source\"]"));
    }

    // Review Focus 5: a module that failed to load on one start keeps its last entry.
    [Test]
    public void A_report_overwrites_the_modules_it_contains_and_keeps_the_others()
    {
        var store = Store(new FakeKeyValueService());
        store.MergeCatalogue(new McpCatalogueReport("17.0.0-alpha.1", [Module("forms", "form", "prevalue-source"), Module("engage", "persona")]), First);

        store.MergeCatalogue(new McpCatalogueReport("17.0.0-alpha.2", [Module("forms", "form")]), First.AddHours(1));

        McpToolCatalogue catalogue = store.GetCatalogue();
        Assert.That(catalogue.UmbrellaVersion, Is.EqualTo("17.0.0-alpha.2"));
        Assert.That(catalogue.Modules["forms"].ReportedAt, Is.EqualTo(First.AddHours(1)));
        Assert.That(catalogue.Modules["forms"].Collections.Select(c => c.Name), Is.EqualTo(new[] { "form" }));
        Assert.That(catalogue.Modules["engage"].ReportedAt, Is.EqualTo(First));
        Assert.That(catalogue.Modules["engage"].Collections.Single(), Is.EqualTo(new McpCollectionInfo("persona", 3)));
    }

    [Test]
    public void The_catalogue_is_stored_as_camel_case_json()
    {
        var values = new FakeKeyValueService();
        Store(values).MergeCatalogue(new McpCatalogueReport("1.0.0", [Module("forms", "prevalue-source")]), First);

        string json = values.Values[KeyValueMcpToolSettingsStore.CatalogueKey]!;
        Assert.That(json, Does.Contain("\"umbrellaVersion\":\"1.0.0\""));
        Assert.That(json, Does.Contain("\"toolCount\":3"));
        Assert.That(json, Does.Contain("\"siteSettingsIgnored\":false"));
    }

    [Test]
    public void Corrupt_rows_read_as_empty()
    {
        var values = new FakeKeyValueService();
        values.SetValue(KeyValueMcpToolSettingsStore.SettingsKey, "{not json");
        values.SetValue(KeyValueMcpToolSettingsStore.CatalogueKey, "[1,2,3]");
        values.SetValue(KeyValueMcpToolSettingsStore.ReadOnlyKey, "{\"forms\":true}");
        var store = Store(values);

        Assert.That(store.GetDisabledCollections(), Is.Empty);
        Assert.That(store.GetReadOnlyModules(), Is.Empty);
        Assert.That(store.GetCatalogue().Modules, Is.Empty);
    }

    private static readonly Guid UserA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid UserB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Test]
    public void User_overrides_round_trip()
    {
        var store = Store(new FakeKeyValueService());
        var overrides = new Dictionary<string, McpProductOverride>
        {
            ["cms"] = new(["media"], McpToolLevel.ReadOnly),
            ["forms"] = new([], McpToolLevel.Full),
        };

        store.SetUserOverrides(UserA, overrides);

        IReadOnlyDictionary<string, McpProductOverride> read = store.GetUserOverrides(UserA);
        Assert.That(read.Keys, Is.EquivalentTo(new[] { "cms", "forms" }));
        Assert.That(read["cms"].DisabledCollections, Is.EqualTo(new[] { "media" }));
        Assert.That(read["cms"].Level, Is.EqualTo(McpToolLevel.ReadOnly));
        Assert.That(read["forms"].DisabledCollections, Is.Empty);
        Assert.That(read["forms"].Level, Is.EqualTo(McpToolLevel.Full));
        Assert.That(store.GetUserOverrides(UserB), Is.Empty);
    }

    [Test]
    public void Empty_user_overrides_blank_the_row()
    {
        var values = new FakeKeyValueService();
        var store = Store(values);
        store.SetUserOverrides(UserA, new Dictionary<string, McpProductOverride> { ["cms"] = new([], McpToolLevel.Full) });

        store.SetUserOverrides(UserA, new Dictionary<string, McpProductOverride>());

        Assert.That(values.Values[KeyValueMcpToolSettingsStore.UserOverridesKeyPrefix + UserA.ToString("D")], Is.EqualTo(""));
        Assert.That(store.GetUserOverrides(UserA), Is.Empty);
    }

    [Test]
    public void Get_all_user_overrides_skips_blank_invalid_and_non_guid_rows()
    {
        var values = new FakeKeyValueService();
        var store = Store(values);
        values.SetValue(KeyValueMcpToolSettingsStore.UserOverridesKeyPrefix + UserA.ToString("D"), "");
        values.SetValue(KeyValueMcpToolSettingsStore.UserOverridesKeyPrefix + UserB.ToString("D"), "{not json");
        values.SetValue(KeyValueMcpToolSettingsStore.UserOverridesKeyPrefix + "not-a-guid", "{\"cms\":{\"disabledCollections\":[],\"level\":\"full\"}}");
        Guid valid = Guid.Parse("33333333-3333-3333-3333-333333333333");
        store.SetUserOverrides(valid, new Dictionary<string, McpProductOverride> { ["cms"] = new(["media"], McpToolLevel.NoDestructive) });

        IReadOnlyDictionary<Guid, IReadOnlyDictionary<string, McpProductOverride>> all = store.GetAllUserOverrides();

        Assert.That(all.Keys, Is.EqualTo(new[] { valid }));
        Assert.That(all[valid]["cms"].Level, Is.EqualTo(McpToolLevel.NoDestructive));
    }

    [Test]
    public void User_catalogue_is_replaced_not_merged()
    {
        var store = Store(new FakeKeyValueService());
        store.SetUserCatalogue(UserA, new McpCatalogueReport("17.0.0-alpha.1", [Module("forms", "form")]), First);

        store.SetUserCatalogue(UserA, new McpCatalogueReport("17.0.0-alpha.2", [Module("cms", "document")]), First.AddHours(1));

        McpToolCatalogue? catalogue = store.GetUserCatalogue(UserA);
        Assert.That(catalogue, Is.Not.Null);
        Assert.That(catalogue!.Modules.Keys, Is.EqualTo(new[] { "cms" }));
        Assert.That(catalogue.UmbrellaVersion, Is.EqualTo("17.0.0-alpha.2"));
        Assert.That(catalogue.Modules["cms"].ReportedAt, Is.EqualTo(First.AddHours(1)));
        Assert.That(store.GetAllUserCatalogues().Keys, Is.EqualTo(new[] { UserA }));
        Assert.That(store.GetUserCatalogue(UserB), Is.Null);
    }

    [Test]
    public void Clear_user_catalogue_blanks_it()
    {
        var store = Store(new FakeKeyValueService());
        store.SetUserCatalogue(UserA, new McpCatalogueReport("1.0.0", [Module("cms", "document")]), First);

        store.ClearUserCatalogue(UserA);

        Assert.That(store.GetUserCatalogue(UserA), Is.Null);
        Assert.That(store.GetAllUserCatalogues().ContainsKey(UserA), Is.False);
    }

    [Test]
    public void User_rows_do_not_touch_the_shared_rows()
    {
        var store = Store(new FakeKeyValueService());

        store.SetUserOverrides(UserA, new Dictionary<string, McpProductOverride> { ["cms"] = new(["media"], McpToolLevel.Full) });
        store.SetUserCatalogue(UserA, new McpCatalogueReport("1.0.0", [Module("cms", "document")]), First);

        Assert.That(store.GetCatalogue(), Is.EqualTo(McpToolCatalogue.Empty));
        Assert.That(store.GetDisabledCollections(), Is.Empty);
        Assert.That(store.GetAllUserOverrides().Keys, Is.EqualTo(new[] { UserA }));
    }
}
