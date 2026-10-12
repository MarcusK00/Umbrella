# Umbrella

One MCP server for your Umbraco 17 site. Umbrella detects which Umbraco products the site has installed and gives your AI tool (Claude Code, VS Code, Cursor, Claude Desktop) the tools for exactly those products.

| Package | Where it runs | What it does |
|---|---|---|
| [`Umbraco.Community.Umbrella`](https://www.nuget.org/packages/Umbraco.Community.Umbrella) (NuGet) | In your Umbraco site | Detects installed products, serves `GET /umbraco/management/api/v1/mcp/capabilities`, adds **MCP** health checks and writes a ready-to-use `.mcp.json` in Development |
| [`umbrella-mcp`](https://www.npmjs.com/package/umbrella-mcp) (npm) | On your machine, started by your AI tool | Stdio MCP server: CMS tools always, Forms and Automate tools when the site has them. Tools are prefixed `cms--`, `forms--`, `automate--`; `get-mcp-health` explains what loaded and why |

You only install the NuGet package. Your AI tool starts `umbrella-mcp` with `npx`, which downloads it the first time.

Agents get a routing table (MCP server `instructions`) that says which prefix to use for which kind of request, and every tool description starts with its product, for example `[Umbraco Forms] …`.

## Get started

You need Umbraco 17 and Node.js 22 or later on the machine that runs your AI tool.

1. **Install the add-on** in your site and restart it:

   ```bash
   dotnet add package Umbraco.Community.Umbrella
   ```

2. **Create an API user** in the backoffice (Users → Create → API user) and add client credentials with the client id `umbraco-back-office-mcp` and a secret of your choice. Keep a copy of the secret: Umbraco stores only its hash. Give the user's groups access to the sections of the products you want the AI to use (Content, Media, Settings, Forms, Automate, …). The "MCP API user" health check (Settings → Health Check → MCP) tells you if something is missing.

3. **Set the secret** as an environment variable on your machine:

   ```bash
   export UMBRELLA_CLIENT_SECRET="<the client secret>"
   ```

4. **Open the site's folder in your AI tool.** When the site runs in Development, the add-on writes a `.mcp.json` next to it, filled in with the site's HTTPS address and the API user's client id. Claude Code and VS Code read this file. Approve the `umbraco` server when your tool asks, and `npx` downloads and starts `umbrella-mcp`.

### Other AI tools, or a site that is not running locally

Settings → Health Check → MCP → "MCP client setup" shows the same config to paste into any MCP client, filled in with the site's URL. Replace the secret placeholder with your client secret:

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "npx",
      "args": ["-y", "umbrella-mcp@17.0.0-alpha.1"],
      "env": {
        "UMBRACO_BASE_URL": "https://your-site",
        "UMBRACO_CLIENT_ID": "umbraco-back-office-mcp",
        "UMBRACO_CLIENT_SECRET": "<your client secret>"
      }
    }
  }
}
```

The config pins `umbrella-mcp` to the add-on's version: the two packages are released together with the same version number.

## Configuration

### Site (`appsettings.json`)

| Setting | Default | Meaning |
|---|---|---|
| `Umbraco:Mcp:ClientId` | `umbraco-back-office-mcp` | The client id put in the written `.mcp.json` and in the "MCP client setup" config. The "MCP API user" check does not use it: it reports on whichever API user the MCP server connected as |
| `Umbraco:Mcp:McpJson:Enabled` | `true` | Set to `false` to never write `.mcp.json` |
| `Umbraco:Mcp:McpJson:Path` | the site's content root | Folder to write `.mcp.json` to, relative to the content root. Use `..` if you open the solution folder in your AI tool |
| `Umbraco:Mcp:McpJson:Command`, `Umbraco:Mcp:McpJson:Args` | `npx`, `["-y", "umbrella-mcp@<version>"]` | Override how the server is started, for example to run a local build |

About the written `.mcp.json`:
- It is only written when the site runs in **Development**, once it has started, and **never overwrites** an existing file. Delete it to have it written again.
- It contains no secret. It reads `${UMBRELLA_CLIENT_SECRET}` from your environment (Claude Code expands `${VAR}` in `.mcp.json`), so it is safe to commit.
- It needs an HTTPS address, because the Management API token endpoint rejects plain HTTP. If the site only listens on HTTP, nothing is written.
- For a site on `localhost` it sets `NODE_TLS_REJECT_UNAUTHORIZED=0`, because Node does not trust the ASP.NET Core development certificate. This turns off certificate checks for the MCP server process only, and only when the site is on the local machine.

### MCP server (environment variables)

| Variable | Meaning |
|---|---|
| `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID`, `UMBRACO_CLIENT_SECRET` | The site and the API user to sign in as (required) |
| `UMBRACO_MCP_MODULES` | Force modules on without detection, for example `forms,automate` |
| `UMBRACO_TOOL_MODES`, `UMBRACO_INCLUDE_/EXCLUDE_TOOL_COLLECTIONS`, `UMBRACO_INCLUDE_/EXCLUDE_TOOLS` | Toolkit filters. Unprefixed entries apply to CMS; `forms:<value>` targets a module; `forms:*` means no restriction for that module. In the two `*_TOOLS` lists you can also use the visible name, for example `cms--delete-document` or `forms--list-forms`. Collection filters set here for a product override the Umbrella dashboard for that product |
| `UMBRACO_READONLY` | `true` registers only read-only tools, for every module. To do this for one product, use the Umbrella dashboard |
| `UMBRACO_INCLUDE_SLICES`, `UMBRACO_EXCLUDE_SLICES` | Apply to every module |

## Turning tool groups off

Settings → **Umbrella** lists every product the MCP server loaded, with one checkbox per tool group (for example Umbraco Forms → `prevalue-source`). Untick a group and save to stop exposing its tools. Fewer tools means less context for the AI and better tool choice.

Each product also has a **Read-only tools only** toggle. With it on, the product registers only tools marked read-only (the ones that list and fetch), so the AI can look at that product but not change it. The group labels then show how many tools stay, for example `form (6 of 14)`. Group checkboxes still apply on top of it.

- **When it applies:** the next time the MCP server starts. Reconnect it in your AI tool after saving.
- **Before the first start:** the dashboard is empty until the MCP server has connected once, because the server reports its tool groups when it starts.
- **Environment wins for groups:** if the MCP server's environment sets `UMBRACO_INCLUDE_TOOL_COLLECTIONS` or `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` for a product (including `forms:*`, or an unprefixed entry for CMS), the group settings are ignored for that product and the dashboard shows a warning. `UMBRACO_INCLUDE_TOOLS` also still includes a tool from a switched-off group.
- **Read-only always applies:** it only removes tools, so the environment can't turn it off. `UMBRACO_READONLY=true` makes every product read-only whatever the dashboard says.
- **Not a security control:** anyone with the API user's credentials can call the Management API directly. Use the API user's groups and sections to limit what it can do.

The settings and the reported tool groups are stored in the `umbracoKeyValue` table. Changing them needs access to the Settings section.

## Health checks

Settings → Health Check → **MCP** has three checks:

- **MCP products**: which Umbraco products the add-on detected, their versions, and whether their Management APIs are available.
- **MCP API user**: every API user the MCP server has connected as, whatever its name or client id: when it last connected, whether it can still sign in, and whether it has the sections for each detected product. The MCP server connects once when your AI tool starts it, so until then the check only says no MCP server has connected yet. A stdio MCP server has no lasting connection, so the check shows the last connection, not whether one is open right now. Connections are stored in the `umbracoKeyValue` table.
- **MCP client setup**: the MCP client config to copy, filled in with the site's URL and client id.

In your AI tool, the `get-mcp-health` tool shows what the server loaded and why.

## Compatibility

| Component | Version |
|---|---|
| Umbraco CMS | 17.x |
| Node.js | 22 or later |
| `@umbraco-cms/mcp-server-sdk` | 1.0.0-beta.45 (one copy shared by all products) |
| `@umbraco-cms/mcp-dev` | 17.6.10 |
| `@umbraco-forms/mcp-dev` | 17.6.1-beta.3 |
| `@umbraco-automate/mcp-dev` | 17.4.0-beta.1 |

## Known limitations

- **Umbraco Engage tools are not included yet.** The add-on detects Engage, and `get-mcp-health` reports that its tools are not available, until a v17 release of `@umbraco-engage/mcp-dev` exports `createApiClient`.
- Tool names are prefixed (`cms--get-document`), so they differ from the standalone CMS MCP's names.
- `@umbraco-cms/mcp-dev/collections` does not export the CMS server's runtime setup (`setUmbracoVersion`, `setAllowFilePathUploads`). Version-gated CMS tools (for example `create-and-publish-document`, `update-and-publish-document`, `sort-document-children`, `sort-document-root-children`) are not registered, document/data type schema tools use their fallback path, and media tools do not accept local file paths. Fixing this needs the CMS package to export a setup hook from `./collections`.
- Only `--list-tools` is supported as a CLI flag; `--describe-tool` is not implemented.
- Collection filters do not pull in dependent collections (for example `media` does not add `temporary-file`) the way the standalone CMS MCP does.
- VS Code reads a `.mcp.json` in the workspace root, but `${VAR}` expansion there has only been checked for Claude Code.

## Develop

The repository has the add-on in `src/Umbraco.Mcp`, the server in `npm/`, and a demo site in `demo-site/`.

- `dotnet test Umbraco.Mcp.slnx`
- `cd npm && npm install && npm test && npm run build` (`npm install` needs the Engage tarball in `npm/vendor/`, see [CLAUDE.md](CLAUDE.md))
- Demo site: `dotnet run --project demo-site --launch-profile Umbraco.Web.UI` (https://localhost:44399). Create the API user with `node scripts/create-api-user.mjs`, which prints a generated client secret for `npm/.env`.
- The demo site's `.mcp.json` runs the local build (`node ../npm/dist/index.js`) and loads Engage from the local tarball, so open `demo-site/` in your AI tool and set `UMBRELLA_CLIENT_SECRET`.
- `scripts/e2e.sh`: end-to-end check of the local build against the running demo site.
- `scripts/pack-check.sh`: packs `umbrella-mcp` and installs it with `npx` in an empty folder, the way users get it, then checks it against the running demo site.
- Releasing: [docs/releasing.md](docs/releasing.md)
- Adding a product: [docs/adding-a-product.md](docs/adding-a-product.md)
