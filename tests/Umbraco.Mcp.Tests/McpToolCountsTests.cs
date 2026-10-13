using NUnit.Framework;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpToolCountsTests
{
    private static readonly DateTimeOffset At = new(2026, 10, 13, 12, 0, 0, TimeSpan.Zero);

    private static McpModuleCatalogue Module(bool siteSettingsIgnored = false) =>
        new(At, siteSettingsIgnored,
        [
            new McpCollectionInfo("form", 30, ReadOnlyToolCount: 12, NonDestructiveToolCount: 25),
            new McpCollectionInfo("record", 10, ReadOnlyToolCount: 6, NonDestructiveToolCount: 8),
            new McpCollectionInfo("media", 2, ReadOnlyToolCount: 1, DisabledByDefault: true, NonDestructiveToolCount: 2),
        ]);

    private static McpProductStatus Forms(IReadOnlyList<string>? disabled = null, bool readOnly = false, bool noDestructive = false) =>
        new("forms", "Umbraco Forms", true, true, "17.6.1", []) { DisabledCollections = disabled, ReadOnly = readOnly, NoDestructive = noDestructive };

    [Test]
    public void Effective_is_zero_when_off()
    {
        Assert.That(McpToolCounts.Effective(Module(), Forms() with { Off = true }), Is.EqualTo(0));
        Assert.That(McpToolCounts.Effective(Module(siteSettingsIgnored: true), Forms() with { Off = true }), Is.EqualTo(0));
    }

    [Test]
    public void Without_a_saved_list_the_groups_off_by_default_are_left_out()
    {
        Assert.That(McpToolCounts.Effective(Module(), Forms()), Is.EqualTo(40));
    }

    [Test]
    public void A_saved_list_replaces_the_groups_off_by_default()
    {
        Assert.That(McpToolCounts.Effective(Module(), Forms(disabled: ["record"])), Is.EqualTo(32));
    }

    [Test]
    public void Read_only_counts_the_read_only_tools_of_the_groups_that_are_on()
    {
        Assert.That(McpToolCounts.Effective(Module(), Forms(disabled: [], readOnly: true)), Is.EqualTo(19));
    }

    [Test]
    public void No_destructive_counts_the_non_destructive_tools_of_the_groups_that_are_on()
    {
        Assert.That(McpToolCounts.Effective(Module(), Forms(disabled: ["media"], noDestructive: true)), Is.EqualTo(33));
    }

    [Test]
    public void A_report_without_level_counts_falls_back_to_all_tools_of_the_group()
    {
        var module = new McpModuleCatalogue(At, false, [new McpCollectionInfo("form", 30)]);

        Assert.That(McpToolCounts.Effective(module, Forms(readOnly: true)), Is.EqualTo(30));
    }

    [Test]
    public void Unknown_when_the_server_environment_sets_its_own_collection_filters()
    {
        Assert.That(McpToolCounts.Effective(Module(siteSettingsIgnored: true), Forms()), Is.Null);
    }
}
