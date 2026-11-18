using NUnit.Framework;
using Umbraco.Mcp.Detection;
using Umbraco.Mcp.ToolSettings;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpToolCountsTests
{
    private static readonly DateTimeOffset At = new(2026, 10, 13, 12, 0, 0, TimeSpan.Zero);

    private static McpModuleCatalogue Module() =>
        new(At,
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
        var module = new McpModuleCatalogue(At, [new McpCollectionInfo("form", 30)]);

        Assert.That(McpToolCounts.Effective(module, Forms(readOnly: true)), Is.EqualTo(30));
    }

    private static McpModuleCatalogue ToolModule() =>
        new(At,
        [
            new McpCollectionInfo("form", 3, Tools:
            [
                new McpToolInfo("list-forms", null, ReadOnly: true, Destructive: false),
                new McpToolInfo("update-form", null, ReadOnly: false, Destructive: false),
                new McpToolInfo("delete-form", null, ReadOnly: false, Destructive: true),
            ]),
            new McpCollectionInfo("record", 10, ReadOnlyToolCount: 6, NonDestructiveToolCount: 8),
        ]);

    private static string[] Names(IReadOnlyList<McpToolInfo> tools) => tools.Select(t => t.Name).ToArray();

    [Test]
    public void Switched_off_tools_are_left_out()
    {
        var product = Forms(disabled: []) with { DisabledTools = ["update-form"] };

        Assert.That(Names(McpToolCounts.KeptTools(ToolModule(), product)), Is.EqualTo(new[] { "list-forms", "delete-form" }));
        Assert.That(McpToolCounts.Effective(ToolModule(), product), Is.EqualTo(12));
    }

    [Test]
    public void A_level_removes_tools_whatever_the_list_says()
    {
        var product = Forms(disabled: [], noDestructive: true) with { DisabledTools = ["update-form"] };

        Assert.That(Names(McpToolCounts.KeptTools(ToolModule(), product)), Is.EqualTo(new[] { "list-forms" }));
        Assert.That(McpToolCounts.Effective(ToolModule(), product), Is.EqualTo(9));
    }

    [Test]
    public void A_switched_off_group_hides_its_tools_and_keeps_the_list()
    {
        var product = Forms(disabled: ["form"]) with { DisabledTools = ["update-form"] };

        Assert.That(McpToolCounts.KeptTools(ToolModule(), product), Is.Empty);
        Assert.That(McpToolCounts.Effective(ToolModule(), product), Is.EqualTo(10));
        Assert.That(product.DisabledTools, Is.EqualTo(new[] { "update-form" }));
    }

    [Test]
    public void Unknown_names_are_ignored()
    {
        var product = Forms(disabled: []) with { DisabledTools = ["nope"] };

        Assert.That(Names(McpToolCounts.KeptTools(ToolModule(), product)), Is.EqualTo(new[] { "list-forms", "update-form", "delete-form" }));
        Assert.That(McpToolCounts.Effective(ToolModule(), product), Is.EqualTo(13));
    }
}
