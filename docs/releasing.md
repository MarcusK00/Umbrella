# Releasing

`Umbraco.Community.Umbrella` (NuGet) and `umbrella-mcp` (npm) are released together, with the same version. The add-on tells AI tools to run `npx -y umbrella-mcp@<add-on version>`, so an add-on release without the matching npm release breaks setup for everyone who installs it.

Merging a new version into `v17/main` publishes both: `.github/workflows/release.yml` runs on every push to `v17/main`, and does nothing unless that version is missing from npm or NuGet. Releases are for testing until further notice, so the NuGet package has no `umbraco-marketplace` tag (see [Test and Marketplace releases](#test-and-marketplace-releases)).

## Checklist

1. **Version.** On `v17/dev` (through a PR), set the same version in `src/Umbraco.Mcp/Umbraco.Mcp.csproj` (`<Version>`) and `npm/package.json` (`version`), and update the version in the config examples in `README.md`, `npm/README.md` and `src/Umbraco.Mcp/README.md`. `NpmPackageContractTests` fails if the two packages differ in name or version, and the `readme-versions` guard fails if a README still names another version. Also check that the Compatibility table in `README.md` matches the product package versions in `npm/package.json`. Every publish needs a new version number: a merge that keeps the version publishes nothing.
2. **No local dependencies.** `npm/package.json` `dependencies` must only reference registry versions. A `file:` dependency cannot be installed by users. A product that only exists as a local tarball stays in `devDependencies` and `external` in `tsup.config.ts` (none today).
3. **Tests and guards.** CI runs these on the PR to `v17/main`; run them locally first:
   ```bash
   dotnet test Umbraco.Mcp.slnx
   cd npm && npm run compile && npm test
   bash scripts/check-guards.sh
   ```
4. **Install check.** CI can't run these, so run them with the demo site running before you merge:
   ```bash
   scripts/e2e.sh
   scripts/pack-check.sh
   ```
   `pack-check.sh` installs the packed package with `npx` in an empty folder, where npm ignores our `overrides`. It catches a product package that would end up on its own toolkit copy.
5. **Merge `v17/dev` into `v17/main`.** The Release workflow then publishes (see [What the workflow does](#what-the-workflow-does)). Follow it under Actions → Release.
6. **Public docs.** This repository is private, so users read the docs in the public tracker, [MarcusK00/Umbrella-Issues](https://github.com/MarcusK00/Umbrella-Issues), where the NuGet readme and `PackageProjectUrl` link. After the release, copy `README.md` there and push it (the workflow doesn't do this):
   ```bash
   node scripts/sync-tracker-docs.mjs ../Umbrella-Issues   # a checkout of the tracker
   ```
   The script drops the Develop section, adds "Report a problem", and copies `LICENSE` and the logo. It fails when the README no longer has the sections it edits, or links to a file the tracker doesn't have.
7. **Check** that `npx -y umbrella-mcp@<version> --list-tools` works against a site with the new add-on, with `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID` and `UMBRACO_CLIENT_SECRET` set. In that site, Settings → Health Check → MCP → "MCP client setup" should show the same version.

## What the workflow does

| Job | Does |
|---|---|
| `version` | Reads the version from `npm/package.json` and the csproj (fails if they differ) and checks whether npm and NuGet have it. When both have it, every other job is skipped. |
| `ci` | Runs `ci.yml` (`dotnet`, `npm`, `guards`, `workflows`) on the merged commit. Nothing publishes if it fails. |
| `npm` | `npm publish --tag <label>` from `npm/`, where the label is the pre-release label (`17.0.0-alpha.8` → `alpha`) or `latest` for a stable version. The add-on pins the exact version, so users never depend on the dist-tag. |
| `nuget` | `dotnet pack` and `dotnet nuget push`, only after npm succeeded or already had the version, so the version the add-on points to exists. |
| `github-release` | Tags the commit `v<version>` and creates a GitHub release with generated notes (marked pre-release for a pre-release version). |

Neither registry needs a stored API key: both use trusted publishing, where the job exchanges a short-lived GitHub OIDC token for a one-time credential. The workflow is safe to run again: a registry that already has the version is skipped, so after a failed NuGet push, re-run the failed jobs (or Actions → Release → Run workflow on `v17/main`) and only NuGet runs. npm doesn't generate provenance for a private repository, so the workflow doesn't ask for it.

## One-time setup

Do these close to the first automatic release: an npm trusted publisher that hasn't published within **2 days** of being created expires (delete it and add it again), and a NuGet policy for a private repository is only temporarily active for **7 days** until its first publish (restart the window on the Trusted Publishing page).

1. **npm:** npmjs.com → `umbrella-mcp` → Settings → Trusted publishing → GitHub Actions. Organization or user `MarcusK00`, repository `Umbrella`, workflow filename `release.yml`, no environment. The fields are case-sensitive and npm only checks them on the first publish. Under allowed actions, also allow `npm publish`: a new trusted publisher only allows `npm stage publish` by default, which holds every version until you approve it with 2FA. Once a release has gone through, you can set Settings → Publishing access to "Require two-factor authentication and disallow tokens"; that doesn't affect trusted publishing.
2. **NuGet:** nuget.org → your user menu → Trusted Publishing → add a policy owned by the account that owns `Umbraco.Community.Umbrella`: repository owner `MarcusK00`, repository `Umbrella`, workflow file `release.yml` (the file name only), no environment. The policy name is only a label; for the packages, select `Umbraco.Community.Umbrella` (or enter it as the glob pattern) so the policy can push nothing else.
3. **GitHub:** repository Settings → Secrets and variables → Actions → add the secret `NUGET_USER` with your nuget.org profile name (not your email address). It isn't a credential, but the NuGet docs recommend keeping it in a secret.
4. **Old API keys:** after the first automatic release, delete the NuGet API key you used for manual pushes (nuget.org → API Keys) and any npm token you published with.

The trusted publisher settings name `release.yml`, so renaming the workflow file breaks publishing until both are updated.

## Publishing by hand

Only if the workflow can't be used. Publish npm first, so the version the add-on points to exists:

```bash
cd npm && npm publish --tag alpha   # the pre-release label: alpha, beta or rc; plain `npm publish` for a stable version
dotnet pack src/Umbraco.Mcp/Umbraco.Mcp.csproj -c Release -o artifacts
dotnet nuget push artifacts/Umbraco.Community.Umbrella.<version>.nupkg --source https://api.nuget.org/v3/index.json --api-key <key>
```

The NuGet API key needs "Push only new package versions", limited to the glob `Umbraco.Community.Umbrella`.

## Test and Marketplace releases

- **Test releases** (now): pre-release versions such as `17.0.0-alpha.1`, without the `umbraco-marketplace` tag. nuget.org hides pre-release versions from searches unless "include prerelease" is ticked, but both registries are public.
- **Marketplace release:** add `umbraco-marketplace` back to `<PackageTags>` in `src/Umbraco.Mcp/Umbraco.Mcp.csproj`. The Umbraco Marketplace lists NuGet packages that carry that tag.
- **Nothing can be fully taken back:** nuget.org versions can only be unlisted, never deleted, and their version number stays used. npm allows `npm unpublish` within 72 hours. Use a new version number for every publish.
- **Names:** `umbrella-mcp` on npm and `Umbraco.Community.Umbrella` on NuGet were unclaimed on 12-10-2026; the first publish claims them.
