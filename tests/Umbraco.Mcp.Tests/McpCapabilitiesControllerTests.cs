using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Umbraco.Cms.Core.Configuration.Models;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Mcp.Api;
using Umbraco.Mcp.Capabilities;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Mcp.Detection;

namespace Umbraco.Mcp.Tests;

[TestFixture]
public class McpCapabilitiesControllerTests
{
    private sealed class StubService(McpCapabilities caps) : IMcpCapabilitiesService
    {
        public List<Guid?> Requested { get; } = [];

        public List<IReadOnlyCollection<string>?> RequestedSections { get; } = [];

        public McpCapabilities GetCapabilities(Guid? apiUserKey = null, IReadOnlyCollection<string>? allowedSections = null)
        {
            Requested.Add(apiUserKey);
            RequestedSections.Add(allowedSections);
            return caps;
        }
    }

    private static readonly McpCapabilities Caps =
        new("17.0.0", [new McpProductStatus("cms", "Umbraco CMS", true, true, "17.7.0", [])]);

    private static IUser User(UserKind kind) =>
        new User(new GlobalSettings()) { Key = Guid.NewGuid(), Kind = kind };

    private static McpCapabilitiesController Controller(IUser? currentUser, FakeConnectionStore store, StubService? service = null) =>
        new(service ?? new StubService(Caps), new FakeBackOfficeSecurityAccessor(currentUser), store,
            NullLogger<McpCapabilitiesController>.Instance);

    [Test]
    public void Get_returns_ok_with_service_result()
    {
        IActionResult result = Controller(User(UserKind.Api), new FakeConnectionStore()).GetCapabilities();

        Assert.That(result, Is.InstanceOf<OkObjectResult>());
        Assert.That(((OkObjectResult)result).Value, Is.SameAs(Caps));
    }

    [Test]
    public void A_call_from_an_api_user_is_recorded_as_a_connection()
    {
        IUser user = User(UserKind.Api);
        var store = new FakeConnectionStore();
        DateTimeOffset before = DateTimeOffset.UtcNow;

        Controller(user, store).GetCapabilities();

        Assert.That(store.Recorded, Has.Count.EqualTo(1));
        Assert.That(store.Recorded[0].UserKey, Is.EqualTo(user.Key));
        Assert.That(store.Recorded[0].LastConnected, Is.InRange(before, DateTimeOffset.UtcNow));
    }

    [Test]
    public void A_call_from_a_normal_backoffice_user_is_not_recorded()
    {
        // For example someone trying the endpoint in Swagger: that is not the MCP server.
        var store = new FakeConnectionStore();

        Controller(User(UserKind.Default), store).GetCapabilities();

        Assert.That(store.Recorded, Is.Empty);
    }

    [Test]
    public void Api_caller_key_reaches_the_service()
    {
        IUser user = User(UserKind.Api);
        var service = new StubService(Caps);

        Controller(user, new FakeConnectionStore(), service).GetCapabilities();

        Assert.That(service.Requested, Is.EqualTo(new Guid?[] { user.Key }));
    }

    [Test]
    public void Api_caller_sections_reach_the_service()
    {
        // A user without groups has no sections: every product with a section is marked as out of reach.
        var service = new StubService(Caps);

        Controller(User(UserKind.Api), new FakeConnectionStore(), service).GetCapabilities();

        Assert.That(service.RequestedSections.Single(), Is.Not.Null.And.Empty);
    }

    [Test]
    public void Backoffice_caller_gets_the_defaults()
    {
        var service = new StubService(Caps);

        Controller(User(UserKind.Default), new FakeConnectionStore(), service).GetCapabilities();

        Assert.That(service.Requested, Is.EqualTo(new Guid?[] { null }));
        Assert.That(service.RequestedSections, Is.EqualTo(new IReadOnlyCollection<string>?[] { null }));
    }

    [Test]
    public void No_current_user_gets_the_defaults()
    {
        var service = new StubService(Caps);

        Controller(null, new FakeConnectionStore(), service).GetCapabilities();

        Assert.That(service.Requested, Is.EqualTo(new Guid?[] { null }));
    }

    [Test]
    public void A_failure_to_record_still_returns_the_capabilities()
    {
        var store = new FakeConnectionStore { Throws = new InvalidOperationException("database is down") };

        IActionResult result = Controller(User(UserKind.Api), store).GetCapabilities();

        Assert.That(((OkObjectResult)result).Value, Is.SameAs(Caps));
    }

    [Test]
    public void Controller_requires_back_office_access()
    {
        var attribute = typeof(McpCapabilitiesController).GetCustomAttribute<AuthorizeAttribute>(inherit: false);

        Assert.That(attribute, Is.Not.Null);
        Assert.That(attribute!.Policy, Is.EqualTo(AuthorizationPolicies.BackOfficeAccess));
    }
}
