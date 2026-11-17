
WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

#if DEBUG
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);
// The v18 line's own overrides, for example a separate database, so a checkout that switches between the v17 and v18
// branches never runs one major's migrations on the other's data (docs/development.md).
builder.Configuration.AddJsonFile("appsettings.Local.v18.json", optional: true, reloadOnChange: true);

// appsettings.Local.json is shared by both lines. If it names the database and nothing overrides it here, the v18 site
// would migrate the v17 line's database, which Umbraco 17 can't open afterwards. Stop before Umbraco touches it.
string? sharedDsn = new ConfigurationBuilder()
    .SetBasePath(builder.Environment.ContentRootPath)
    .AddJsonFile("appsettings.Local.json", optional: true)
    .Build()
    .GetConnectionString("umbracoDbDSN");
if (!string.IsNullOrEmpty(sharedDsn) && builder.Configuration.GetConnectionString("umbracoDbDSN") == sharedDsn)
{
    throw new InvalidOperationException(
        "appsettings.Local.json sets ConnectionStrings:umbracoDbDSN, which the v17 line uses too. Put this line's own " +
        "connection string in demo-site/appsettings.Local.v18.json (docs/development.md) so the Umbraco 18 site doesn't " +
        "migrate the Umbraco 17 database.");
}
#endif

builder.CreateUmbracoBuilder()
    .AddBackOffice()
    .AddWebsite()
    .AddComposers()
    .Build();

WebApplication app = builder.Build();


await app.BootUmbracoAsync();


app.UseUmbraco()
    .WithMiddleware(u =>
    {
        u.UseBackOffice();
        u.UseWebsite();
    })
    .WithEndpoints(u =>
    {
        u.UseBackOfficeEndpoints();
        u.UseWebsiteEndpoints();
    });

await app.RunAsync();
