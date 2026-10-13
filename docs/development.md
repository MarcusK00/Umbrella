# Development

How to build, run and test Umbrella from a fresh clone. How the code fits together: [architecture.md](architecture.md).

## Prerequisites

- **.NET 10 SDK** (the add-on and the demo site target `net10.0`).
- **Node.js 22 or later.**
- **bash** for the scripts in `scripts/`. On Windows, use Git Bash.

## First run

1. **Build the server.**

   ```bash
   cd npm
   npm install
   npm ls @umbraco-cms/mcp-server-sdk   # must show one 1.0.0-beta.46, deduped
   npm run build
   ```

2. **Start the demo site** (Umbraco 17 with Forms, Automate and Engage, referencing the add-on project):

   ```bash
   dotnet run --project demo-site --launch-profile Umbraco.Web.UI
   ```

   It runs on https://localhost:44399 (and http://localhost:9399). The first start installs Umbraco unattended into a SQLite database under `demo-site/umbraco/Data/`, with the admin `admin@test.com` / `SecurePass1234` (`demo-site/appsettings.Development.json`).

3. **Create the API user.** With the site running:

   ```bash
   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/create-api-user.mjs
   ```

   It signs in as the demo admin, creates an API user in the Administrators group with the client id `umbraco-back-office-mcp`, and prints a generated client secret once. Arguments, all optional: `[baseUrl] [adminEmail] [adminPassword] [clientSecret]`; the secret can also come from `UMBRACO_CLIENT_SECRET`. When you run it again, pass the existing secret: it then sees the user can sign in and stops. Without it, it generates a new secret and fails because the user already exists.

4. **Configure the server.** Copy `npm/.env.example` to `npm/.env`, set `UMBRACO_CLIENT_SECRET` to the printed secret, and uncomment `NODE_TLS_REJECT_UNAUTHORIZED=0` (the demo site uses the ASP.NET Core development certificate). `npm/.env` is gitignored.

5. **Check it.**

   ```bash
   cd npm && npm run list-tools
   ```

   This prints every registered tool (`cms--`, `forms--`, `automate--`, `engage--` and `get-mcp-health`).

6. **Use it from an AI tool.** Create `demo-site/.mcp.json` (gitignored) to run the local build instead of `npx`:

   ```json
   {
     "mcpServers": {
       "umbraco": {
         "command": "node",
         "args": ["../npm/dist/index.js"],
         "env": {
           "UMBRACO_BASE_URL": "https://localhost:44399",
           "UMBRACO_CLIENT_ID": "umbraco-back-office-mcp",
           "UMBRACO_CLIENT_SECRET": "${UMBRELLA_CLIENT_SECRET}",
           "NODE_TLS_REJECT_UNAUTHORIZED": "0"
         }
       }
     }
   }
   ```

   Set `UMBRELLA_CLIENT_SECRET` to the same secret, restart your AI tool, and open `demo-site/` in it. Run `npm run build` again after changing the server, then reconnect.

## Tests

```bash
dotnet test Umbraco.Mcp.slnx                                   # all .NET tests; also builds the demo site
dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj   # .NET tests only (use this while the demo site runs)
cd npm && npm run compile && npm test                          # strict tsc, then Jest
```

One fixture or test:

```bash
dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter McpProductsHealthCheckTests
cd npm && npm test -- routing -t "prefixes the product"
```

Expected noise: Jest runs with `--experimental-vm-modules`, so every run prints an `ExperimentalWarning`. When a test imports a module that doesn't exist yet, the failure reads `Could not locate module ../x.js mapped as: $1`.

## End-to-end checks

Both scripts need the demo site running, `npm/.env`, and the API user.

- **`scripts/e2e.sh`** runs the local build (`npm run build` first) against the site: capabilities report Forms, Automate and Engage; every prefix has tools; descriptions are product-prefixed; switching off a tool group and setting Forms to read-only or to no destructive tools (checking `forms--delete-form` is gone) change the tool list; groups that are off by default stay off until the site saves a list; the Overview reports the add-on version, and `client-setup` returns the six client configs for the API user's client id without the secret; and `get-mcp-health`, `forms--list-forms` and `automate--list-automations` answer. It changes the site's default tool settings while it runs, and clears the API user's own settings for the run, and restores both afterwards, even when it fails.
- **`scripts/pack-check.sh`** packs `umbrella-mcp` and installs it with `npx` in an empty folder, the way users get it. There npm ignores the package's `overrides`, so this is the check that every product still shares one toolkit copy: it fails when `cms--`, `forms--`, `automate--` or `engage--` tools are missing. It also checks that no vendor tarball is packed.

## Before you commit

- **Stage files by name**, not with `git add -A`.
- **`demo-site/appsettings.json`:** the demo site may write a generated `Imaging:HMACSecretKey` into it on boot. Don't commit it; the committed value is `""`.
- **Never commit** `npm/.env`, `npm/vendor/*.tgz`, `appsettings.local.json`, `demo-site/.mcp.json` or anything under `demo-site/umbraco/`. They are gitignored.
- **New files in `demo-site/`** are ignored too, so local experiments stay local: only the files already in the repo are tracked. Add one on purpose with `git add -f`.
- **`bash scripts/check-guards.sh`** catches most of these, plus README versions that differ from the npm version.
- **Don't upgrade dependencies** as a side effect of other work.
- **Docs:** dates are DD-MM-YYYY. When behaviour or configuration changes, update `README.md`, `npm/README.md`, `src/Umbraco.Mcp/README.md`, `docs/architecture.md` (and `docs/architecture-map.html`) and `CLAUDE.md`.

Then open a PR: [merging.md](merging.md) covers the CI checks and the PR checklist.

## Gotchas

| Problem | Cause |
|---|---|
| `dotnet test Umbraco.Mcp.slnx` fails to copy files | The running demo site locks its build output. Stop it, or test the `.csproj` directly |
| Automate doesn't start in the demo site | It needs `Umbraco:Automate:UseNamedConnectionString=umbracoDbDSN`, which `appsettings.Development.json` sets |
| The server can't sign in to the demo site | `UMBRACO_BASE_URL` is `http://` (the token endpoint rejects HTTP), or `NODE_TLS_REJECT_UNAUTHORIZED=0` is missing for the development certificate |
| A product's tools vanish after `npm install` | A second copy of `@umbraco-cms/mcp-server-sdk` was installed, and the server skips that product. `npm ls @umbraco-cms/mcp-server-sdk` shows it |
| A `grep` in a script fails although the text is there | Under `pipefail`, `echo "$BIG" \| grep -q` can die with SIGPIPE on large output. The scripts use here-strings (`grep … <<< "$X"`) instead |
