using NUnit.Framework;
using Umbraco.Mcp.Connections;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class KeyValueMcpConnectionStoreTests
{
    private static readonly Guid Alice = Guid.Parse("6f1c3b0e-8a2d-4e57-9b14-2c7d5a9e0f31");
    private static readonly Guid Bob = Guid.Parse("a3e9d1f7-0b64-4c28-8e5a-71f2c6b4d093");

    [Test]
    public void Nothing_recorded_returns_no_connections()
    {
        var store = new KeyValueMcpConnectionStore(new FakeKeyValueService());

        Assert.That(store.GetAll(), Is.Empty);
    }

    [Test]
    public void Each_user_keeps_its_own_last_connection()
    {
        var store = new KeyValueMcpConnectionStore(new FakeKeyValueService());
        var first = new DateTimeOffset(2026, 10, 11, 9, 0, 0, TimeSpan.Zero);
        var later = first.AddHours(2);

        store.Record(Alice, first);
        store.Record(Bob, first);
        store.Record(Alice, later);

        Assert.That(store.GetAll(), Is.EquivalentTo(new[] { new McpConnection(Alice, later), new McpConnection(Bob, first) }));
    }

    [Test]
    public void Unrelated_and_unreadable_values_are_ignored()
    {
        var values = new FakeKeyValueService();
        values.SetValue("Umbraco.Mcp.Connection.not-a-guid", "2026-10-11T09:00:00.0000000+00:00");
        values.SetValue($"Umbraco.Mcp.Connection.{Bob}", "yesterday");
        values.SetValue("Umbraco.Core.Upgrader.State", "{}");
        var store = new KeyValueMcpConnectionStore(values);
        var at = new DateTimeOffset(2026, 10, 11, 9, 0, 0, TimeSpan.Zero);
        store.Record(Alice, at);

        Assert.That(store.GetAll(), Is.EqualTo(new[] { new McpConnection(Alice, at) }));
    }
}
