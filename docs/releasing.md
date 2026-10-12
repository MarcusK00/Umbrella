# Releasing

`Umbraco.Community.Umbrella` (NuGet) and `umbrella-mcp` (npm) are released together, with the same version. The add-on tells AI tools to run `npx umbrella-mcp@<add-on version>`, so an add-on release without the matching npm release breaks setup for everyone who installs it.

`npm/package.json` has `"private": true` so nothing is published by accident. Removing it is part of the first release.

## Checklist

1. **Version.** Set the same version in `src/Umbraco.Mcp/Umbraco.Mcp.csproj` (`<Version>`) and `npm/package.json` (`version`), and update the version in the config examples in `README.md` and `npm/README.md`. `NpmPackageContractTests` fails if the two packages differ in name or version.
2. **No local dependencies.** `npm/package.json` `dependencies` must only reference registry versions. A `file:` dependency cannot be installed by users. Products that only exist locally (today: Engage) stay in `devDependencies` and `external` in `tsup.config.ts`.
3. **Tests.**
   ```bash
   dotnet test Umbraco.Mcp.slnx
   cd npm && npm run compile && npm test
   ```
4. **Install check.** With the demo site running:
   ```bash
   scripts/e2e.sh
   scripts/pack-check.sh
   ```
   `pack-check.sh` installs the packed package with `npx` in an empty folder, where npm ignores our `overrides`. It catches a product package that would end up on its own toolkit copy.
5. **Publish npm first**, so the version the add-on points to exists:
   ```bash
   cd npm && npm publish
   ```
6. **Publish NuGet:**
   ```bash
   dotnet pack src/Umbraco.Mcp/Umbraco.Mcp.csproj -c Release -o artifacts
   dotnet nuget push artifacts/Umbraco.Community.Umbrella.<version>.nupkg --source https://api.nuget.org/v3/index.json --api-key <key>
   ```
   The `umbraco-marketplace` tag lists the package on the Umbraco Marketplace.
7. **Check** that `npx -y umbrella-mcp@<version> --list-tools` works against a site with the new add-on.

## Before the first release

- Remove `"private": true` from `npm/package.json`.
- Delete the `npm-private` check from `scripts/check-guards.sh` and its "not private" and "two failures" cases from `scripts/check-guards.test.sh`.
- Add a license (`<PackageLicenseExpression>` in the csproj, `license` in `package.json`, and a `LICENSE` file). The product MCP packages this depends on are MIT.
- Check that the names are still free: `umbrella-mcp` on npm and `Umbraco.Community.Umbrella` on NuGet were unclaimed on 11-10-2026.
