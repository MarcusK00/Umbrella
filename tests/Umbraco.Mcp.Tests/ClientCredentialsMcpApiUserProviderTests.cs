using NUnit.Framework;
using Umbraco.Mcp.ApiUser;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class ClientCredentialsMcpApiUserProviderTests
{
    [Test]
    public void Legacy_section_aliases_are_reported_by_their_backoffice_names()
    {
        // Forms stores "forms" in umbracoUserGroup2App; the backoffice shows it as Umb.Section.Forms.
        IReadOnlyCollection<string> names = ClientCredentialsMcpApiUserProvider.ToSectionNames(["forms", "content"]);

        Assert.That(names, Is.EquivalentTo(new[] { "Umb.Section.Forms", "Umb.Section.Content" }));
    }

    [Test]
    public void Section_names_that_are_already_backoffice_names_are_kept()
    {
        // Automate stores its manifest alias directly.
        IReadOnlyCollection<string> names = ClientCredentialsMcpApiUserProvider.ToSectionNames(["Ua.Section.Automate"]);

        Assert.That(names, Is.EquivalentTo(new[] { "Ua.Section.Automate" }));
    }
}
