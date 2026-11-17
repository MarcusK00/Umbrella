using NUnit.Framework;
using Umbraco.Mcp.Connections;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class KeyValueMcpCreatedUserStoreTests
{
    private static readonly Guid Alice = Guid.Parse("6f1c3b0e-8a2d-4e57-9b14-2c7d5a9e0f31");
    private static readonly Guid Bob = Guid.Parse("a3e9d1f7-0b64-4c28-8e5a-71f2c6b4d093");
    private static readonly DateTimeOffset At = new(2026, 11, 17, 9, 0, 0, TimeSpan.Zero);

    [Test]
    public void Record_then_GetAll_returns_the_user_and_time()
    {
        var store = new KeyValueMcpCreatedUserStore(new FakeKeyValueService());

        store.Record(Alice, At);

        Assert.That(store.GetAll(), Is.EqualTo(new[] { new McpConnection(Alice, At) }));
    }

    [Test]
    public void Record_twice_keeps_the_first_time()
    {
        var store = new KeyValueMcpCreatedUserStore(new FakeKeyValueService());

        store.Record(Alice, At);
        store.Record(Alice, At.AddHours(1));

        Assert.That(store.GetAll(), Is.EqualTo(new[] { new McpConnection(Alice, At) }));
    }

    [Test]
    public void Remove_blanks_the_row_and_returns_true()
    {
        var values = new FakeKeyValueService();
        var store = new KeyValueMcpCreatedUserStore(values);
        store.Record(Alice, At);

        bool removed = store.Remove(Alice);

        Assert.That(removed, Is.True);
        Assert.That(values.Values[KeyValueMcpCreatedUserStore.KeyPrefix + Alice.ToString("D")], Is.EqualTo(""));
        Assert.That(store.GetAll(), Is.Empty);
    }

    [Test]
    public void Remove_unknown_returns_false()
    {
        var store = new KeyValueMcpCreatedUserStore(new FakeKeyValueService());

        Assert.That(store.Remove(Alice), Is.False);
    }

    [Test]
    public void Record_after_remove_records_again()
    {
        var store = new KeyValueMcpCreatedUserStore(new FakeKeyValueService());
        store.Record(Alice, At);
        store.Remove(Alice);

        store.Record(Alice, At.AddDays(1));

        Assert.That(store.GetAll(), Is.EqualTo(new[] { new McpConnection(Alice, At.AddDays(1)) }));
    }

    [Test]
    public void GetAll_skips_blank_and_malformed_rows()
    {
        var values = new FakeKeyValueService();
        values.SetValue(KeyValueMcpCreatedUserStore.KeyPrefix + "not-a-guid", At.ToString("O"));
        values.SetValue(KeyValueMcpCreatedUserStore.KeyPrefix + Bob.ToString("D"), "yesterday");
        values.SetValue(KeyValueMcpCreatedUserStore.KeyPrefix + Guid.NewGuid().ToString("D"), "");
        values.SetValue("Umbraco.Mcp.Connection." + Bob.ToString("D"), At.ToString("O"));
        var store = new KeyValueMcpCreatedUserStore(values);
        store.Record(Alice, At);

        Assert.That(store.GetAll(), Is.EqualTo(new[] { new McpConnection(Alice, At) }));
    }
}
