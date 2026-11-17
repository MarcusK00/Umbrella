# Releasing

`Umbraco.Community.Umbrella` (NuGet) and `umbrella-mcp` (npm) are released together, with the same version. The add-on tells AI tools to run `npx -y umbrella-mcp@<add-on version>`, so an add-on release without the matching npm release breaks setup for everyone who installs it.

Merging a new version into `v17/main` publishes both: `.github/workflows/release.yml` runs on every push to `v17/main`, and does nothing unless that version is missing from npm or NuGet. Releases are stable from 17.0.0, and from 17.0.1 the NuGet package is listed on the Umbraco Marketplace (see [Umbraco Marketplace](#umbraco-marketplace)).

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
6. **Public docs.** Nothing to copy: users read the docs in this repository. The links in the READMEs and the NuGet readme's images (the cover, the two animations and the "Connect in minutes" and "Made for teams" slides, `raw.githubusercontent.com/…/v17/main/docs/images/…`; nuget.org only shows images from allowed domains, not packed or relative ones) point at `v17/main`, so they show the release as soon as it is merged. Don't delete or rename an image on `v17/main` that a published package's readme links to: nuget.org keeps each version's readme as it was published, so the page would show a broken image. `umbrella-overview.png` stays for that reason; the 17.0.0 readme links it.
7. **Check** that `npx -y umbrella-mcp@<version> --list-tools` works against a site with the new add-on, with `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID` and `UMBRACO_CLIENT_SECRET` set. In that site, Settings → Health Check → MCP → "MCP client setup" should show the same version.

## What the workflow does

| Job | Does |
|---|---|
| `version` | Reads the version from `npm/package.json` and the csproj (fails if they differ) and checks whether npm and NuGet have it. When both have it, every other job is skipped. |
| `ci` | Runs `ci.yml` (`dotnet`, `npm`, `guards`, `workflows`) on the merged commit. Nothing publishes if it fails. |
| `npm` | `npm publish --tag <label>` from `npm/`, where the label is the pre-release label (`17.0.0-alpha.8` → `alpha`) or `lts-17` for a stable version: `latest` belongs to the newest line, Umbraco 18, released from `v18/main`. The add-on pins the exact version, so users never depend on the dist-tag. |
| `nuget` | `dotnet pack` and `dotnet nuget push`, only after npm succeeded or already had the version, so the version the add-on points to exists. |
| `github-release` | Tags the commit `v<version>` and creates a GitHub release with generated notes (marked pre-release for a pre-release version). |

Neither registry needs a stored API key: both use trusted publishing, where the job exchanges a short-lived GitHub OIDC token for a one-time credential. The workflow is safe to run again: a registry that already has the version is skipped, so after a failed NuGet push, re-run the failed jobs (or Actions → Release → Run workflow on `v17/main`) and only NuGet runs. npm adds a provenance statement on its own when a public repository publishes through trusted publishing (17.0.0 has one), so the workflow doesn't pass `--provenance`. npm does check that `repository.url` in `npm/package.json` matches the repository the workflow runs in (`MarcusK00/Umbrella`), so keep that field when the repository moves or is renamed.

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

## Stable and test releases

- **Stable releases** (now, from 17.0.0): plain versions such as `17.0.1`. npm publishes them under `lts-17` (17.0.0 and 17.0.1 went out under `latest`, before the Umbraco 18 line existed), and `dotnet add package Umbraco.Community.Umbrella` picks them without `--prerelease`.
- **Test releases:** pre-release versions such as `17.1.0-beta.1` (the `17.0.0-alpha.N` versions were these). npm publishes them under their label, so `lts-17` stays on the stable version, and nuget.org hides them from searches unless "include prerelease" is ticked. Both registries are public.
- **Nothing can be fully taken back:** nuget.org versions can only be unlisted, never deleted, and their version number stays used. npm allows `npm unpublish` within 72 hours. Use a new version number for every publish.
- **Names:** `umbrella-mcp` on npm and `Umbraco.Community.Umbrella` on NuGet were unclaimed on 12-10-2026; the first publish claims them.

## Umbraco Marketplace

The [Umbraco Marketplace](https://marketplace.umbraco.com) lists `Umbraco.Community.Umbrella` from 17.0.1. Umbraco's guide is [Listing your package](https://docs.umbraco.com/umbraco-dxp/marketplace/listing-your-package); there is no submission form, approval or account.

- **What lists it:** the `umbraco-marketplace` tag in `<PackageTags>` (`src/Umbraco.Mcp/Umbraco.Mcp.csproj`) and the NuGet dependency on an Umbraco package. The name, icon, authors, description and readme come from the NuGet package.
- **Supported Umbraco versions** come from the dependency range, `[17.0.0, 18.0.0)` in `Directory.Packages.props`. For an Umbraco 18 line, publish under a range for 18 (the Marketplace combines the ranges of all versions).
- **Listing details:** `umbraco-marketplace.json` in the repository root: categories, license, documentation and issue links, tags, the screenshots (the cover `umbrella-cover.png`, the two animations, then the "Connect in minutes" and "Made for teams" slides, `umbrella-connect.png` and `umbrella-teams.png`, linked on `v17/main`) and author links. The Marketplace reads it from the root of the default branch of the NuGet project URL (`PackageProjectUrl`, this repository), so a change to it goes live once merged into `v17/dev`, without a release. It must match the [schema](https://marketplace.umbraco.com/umbraco-marketplace-schema.json), or the Marketplace ignores it. The schema's URL pattern needs a validator in non-Unicode regex mode (ajv: `unicodeRegExp: false`).
- **Timing:** the Marketplace scans NuGet for newly tagged packages every day at 04:00 UTC and refreshes listed packages every 2 hours. To refresh one package sooner, `POST` `{"PackageId": "Umbraco.Community.Umbrella"}` with `Content-Type: application/json` to `https://functions.marketplace.umbraco.com/api/InitiateSinglePackageSyncFunction` (at most once a minute).
- **Check** how the Marketplace reads the package at [marketplace.umbraco.com/validate](https://marketplace.umbraco.com/validate). Listing problems go to [Umbraco.Marketplace.Issues](https://github.com/umbraco/Umbraco.Marketplace.Issues/issues).
