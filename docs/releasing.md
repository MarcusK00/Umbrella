# Releasing

`Umbraco.Community.Umbrella` (NuGet) and `umbrella-mcp` (npm) are released together, with the same version. The add-on tells AI tools to run `npx -y umbrella-mcp@<add-on version>`, so an add-on release without the matching npm release breaks setup for everyone who installs it.

Nothing in the repo publishes: both steps below are run by hand. Releases are for testing until further notice, so the NuGet package has no `umbraco-marketplace` tag (see [Test and Marketplace releases](#test-and-marketplace-releases)).

## Checklist

1. **Version.** Set the same version in `src/Umbraco.Mcp/Umbraco.Mcp.csproj` (`<Version>`) and `npm/package.json` (`version`), and update the version in the config examples in `README.md`, `npm/README.md` and `src/Umbraco.Mcp/README.md`. `NpmPackageContractTests` fails if the two packages differ in name or version, and the `readme-versions` guard fails if a README still names another version. Also check that the Compatibility table in `README.md` matches the product package versions in `npm/package.json`.
2. **No local dependencies.** `npm/package.json` `dependencies` must only reference registry versions. A `file:` dependency cannot be installed by users. A product that only exists as a local tarball stays in `devDependencies` and `external` in `tsup.config.ts` (none today).
3. **Tests and guards.**
   ```bash
   dotnet test Umbraco.Mcp.slnx
   cd npm && npm run compile && npm test
   bash scripts/check-guards.sh
   ```
4. **Install check.** With the demo site running:
   ```bash
   scripts/e2e.sh
   scripts/pack-check.sh
   ```
   `pack-check.sh` installs the packed package with `npx` in an empty folder, where npm ignores our `overrides`. It catches a product package that would end up on its own toolkit copy.
5. **Publish npm first**, so the version the add-on points to exists:
   ```bash
   cd npm && npm publish --tag alpha   # the pre-release label: alpha, beta or rc; plain `npm publish` for a stable version
   ```
   The add-on pins the exact version, so users never depend on the dist-tag.
6. **Publish NuGet:**
   ```bash
   dotnet pack src/Umbraco.Mcp/Umbraco.Mcp.csproj -c Release -o artifacts
   dotnet nuget push artifacts/Umbraco.Community.Umbrella.<version>.nupkg --source https://api.nuget.org/v3/index.json --api-key <key>
   ```
   The API key needs the "Push new packages and package versions" scope for the first push, which creates the package id; after that, "Push only new package versions" is enough. Limit it to the glob `Umbraco.Community.Umbrella`.
7. **Public docs.** This repository is private, so users read the docs in the public tracker, [MarcusK00/Umbrella-Issues](https://github.com/MarcusK00/Umbrella-Issues), where the NuGet readme and `PackageProjectUrl` link. Copy `README.md` there and push it:
   ```bash
   node scripts/sync-tracker-docs.mjs ../Umbrella-Issues   # a checkout of the tracker
   ```
   The script drops the Develop section, adds "Report a problem", and copies `LICENSE` and the logo. It fails when the README no longer has the sections it edits, or links to a file the tracker doesn't have.
8. **Check** that `npx -y umbrella-mcp@<version> --list-tools` works against a site with the new add-on, with `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID` and `UMBRACO_CLIENT_SECRET` set. In that site, Settings → Health Check → MCP → "MCP client setup" should show the same version.

## Test and Marketplace releases

- **Test releases** (now): pre-release versions such as `17.0.0-alpha.1`, without the `umbraco-marketplace` tag. nuget.org hides pre-release versions from searches unless "include prerelease" is ticked, but both registries are public.
- **Marketplace release:** add `umbraco-marketplace` back to `<PackageTags>` in `src/Umbraco.Mcp/Umbraco.Mcp.csproj`. The Umbraco Marketplace lists NuGet packages that carry that tag.
- **Nothing can be fully taken back:** nuget.org versions can only be unlisted, never deleted, and their version number stays used. npm allows `npm unpublish` within 72 hours. Use a new version number for every publish.
- **Names:** `umbrella-mcp` on npm and `Umbraco.Community.Umbrella` on NuGet were unclaimed on 12-10-2026; the first publish claims them.
