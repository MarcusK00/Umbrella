using System.Reflection;
using NUnit.Framework;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Services;
using Umbraco.Mcp.ApiUser;
using Umbraco.Mcp.Connections;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class ConnectedMcpApiUserProviderTests
{
    [Test]
    public void Legacy_section_aliases_are_reported_by_their_backoffice_names()
    {
        // Forms stores "forms" in umbracoUserGroup2App; the backoffice shows it as Umb.Section.Forms.
        IReadOnlyCollection<string> names = ConnectedMcpApiUserProvider.ToSectionNames(["forms", "content"]);

        Assert.That(names, Is.EquivalentTo(new[] { "Umb.Section.Forms", "Umb.Section.Content" }));
    }

    [Test]
    public void Section_names_that_are_already_backoffice_names_are_kept()
    {
        // Automate stores its manifest alias directly.
        IReadOnlyCollection<string> names = ConnectedMcpApiUserProvider.ToSectionNames(["Ua.Section.Automate"]);

        Assert.That(names, Is.EquivalentTo(new[] { "Ua.Section.Automate" }));
    }

    [Test]
    public async Task Key_is_the_umbraco_user_key()
    {
        var userKey = Guid.Parse("6f1c3b0e-8a2d-4e57-9b14-2c7d5a9e0f31");
        var store = new FakeConnectionStore();
        store.Record(userKey, new DateTimeOffset(2026, 10, 11, 9, 0, 0, TimeSpan.Zero));
        var user = Stub.Create<IUser>(new()
        {
            [nameof(IUser.Key)] = userKey,
            [nameof(IUser.Name)] = "MCP API user",
            [nameof(IUser.Username)] = "mcp",
            [nameof(IUser.UserState)] = UserState.Active,
            [nameof(IUser.AllowedSections)] = new[] { "content" },
        });
        var users = Stub.Create<IUserService>(new()
        {
            ["GetAsync"] = Task.FromResult<IUser?>(user),
            ["GetClientIdsAsync"] = Task.FromResult<IEnumerable<string>>(["umbraco-back-office-mcp"]),
        });

        IReadOnlyList<McpApiUser> result = await new ConnectedMcpApiUserProvider(store, users).GetConnectedAsync();

        Assert.That(result, Has.Count.EqualTo(1));
        Assert.That(result[0].Key, Is.EqualTo(userKey));
    }

    /// <summary>A throwaway implementation of a large Umbraco interface: only the listed members answer.</summary>
    private class Stub : DispatchProxy
    {
        private Dictionary<string, object?> _answers = new();

        public static T Create<T>(Dictionary<string, object?> answers)
            where T : class
        {
            T proxy = Create<T, Stub>();
            ((Stub)(object)proxy)._answers = answers;
            return proxy;
        }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            string name = targetMethod!.Name.StartsWith("get_", StringComparison.Ordinal) ? targetMethod.Name[4..] : targetMethod.Name;
            return _answers.TryGetValue(name, out object? answer)
                ? answer
                : throw new NotSupportedException($"Stub has no answer for {targetMethod.Name}.");
        }
    }
}
