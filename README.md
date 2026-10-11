# Umbraco MCP (proof of concept)

One MCP server for an Umbraco 17 site. It detects which Umbraco HQ products are installed and loads only their tools.

| Part | What it does |
|---|---|
| `src/Umbraco.Mcp` (NuGet) | Detects products, serves `GET /umbraco/management/api/v1/mcp/capabilities`, adds an **MCP** backoffice health check |
| `npm/` (`@umbraco/mcp`) | Stdio MCP server: CMS always, Forms/Automate/Engage when detected; tools are prefixed `cms--`, `forms--`, `automate--`, `engage--`; `get-mcp-health` explains what loaded and why |

Agents get a routing table (MCP server `instructions`) that says which prefix to use for which kind of request, and every tool description starts with its product, e.g. `[Umbraco Forms] …`.

Working names: final package names need product sign-off. Nothing is published to npm or NuGet.

## Use it locally

1. Add a project reference (or local NuGet package) to `Umbraco.Mcp` in your Umbraco 17 site and restart it.
2. Create an API user with client credentials: `node scripts/create-api-user.mjs` (prints a client secret for `npm/.env`).
3. `cd npm && npm install && npm run build`
4. MCP client config:

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "node",
      "args": ["/absolute/path/to/Umbraco.MCP/npm/dist/index.js"],
      "env": {
        "UMBRACO_BASE_URL": "https://localhost:44399",
        "UMBRACO_CLIENT_ID": "umbraco-back-office-mcp",
        "UMBRACO_CLIENT_SECRET": "<your secret>"
      }
    }
  }
}
```

## Configuration

| Variable | Meaning |
|---|---|
| `UMBRACO_MCP_MODULES` | Force modules on without detection, e.g. `forms,automate` |
| `UMBRACO_TOOL_MODES`, `UMBRACO_INCLUDE_/EXCLUDE_TOOL_COLLECTIONS`, `UMBRACO_INCLUDE_/EXCLUDE_TOOLS` | Toolkit filters. Unprefixed entries apply to CMS; `forms:<value>` targets a module; `forms:*` means no restriction for that module. In the two `*_TOOLS` lists you can also use the visible name, e.g. `cms--delete-document` or `forms--list-forms` |
| `UMBRACO_READONLY` | `true` registers only read-only tools, for every module |
| `UMBRACO_INCLUDE_SLICES`, `UMBRACO_EXCLUDE_SLICES` | Apply to every module |

On the site, the "MCP API user" health check (Settings → Health Check → MCP) checks the API user behind `Umbraco:Mcp:ClientId` (default `umbraco-back-office-mcp`). It warns when no user has that client id, when the user is disabled or locked out, and when its groups lack the section of a detected product. Set `Umbraco:Mcp:ClientId` in the site's appsettings if the MCP server uses a different `UMBRACO_CLIENT_ID`. The client secret is not checked.

## Compatibility (v1)

| Component | Version |
|---|---|
| Umbraco CMS | 17.x |
| `@umbraco-cms/mcp-server-sdk` | 1.0.0-beta.45 (single copy enforced) |
| `@umbraco-cms/mcp-dev` | 17.6.10 |
| `@umbraco-forms/mcp-dev` | 17.6.1-beta.2 |
| `@umbraco-automate/mcp-dev` | 17.4.0-beta.1 |
| `@umbraco-engage/mcp-dev` | local build with the `createApiClient` export (`npm/vendor/`) |

## Develop

- `dotnet test Umbraco.Mcp.slnx`
- `cd npm && npm test`
- `scripts/e2e.sh` (needs the demo site running; see `docs/superpowers/plans/2026-10-11-umbraco-mcp-umbrella.md`, Task 16)
- Demo site: `dotnet run --project demo-site --launch-profile Umbraco.Web.UI` (https://localhost:44399). Token endpoints require HTTPS, so `UMBRACO_BASE_URL` uses https and local dev sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for the self-signed certificate. Create the API user with `node scripts/create-api-user.mjs` (prints a generated client secret for `npm/.env`).
- Adding a product: [docs/adding-a-product.md](docs/adding-a-product.md)

## Known limitations

- Tool names are prefixed (`cms--get-document`), so they differ from the standalone CMS MCP's names.
- `@umbraco-cms/mcp-dev/collections` does not export the CMS server's runtime setup (`setUmbracoVersion`, `setAllowFilePathUploads`). In the umbrella, version-gated CMS tools (for example `create-and-publish-document`, `update-and-publish-document`, `sort-document-children`, `sort-document-root-children`) are not registered, document/data type schema tools use their fallback path, and media tools do not accept local file paths. Fixing this needs the CMS package to export a setup hook from `./collections`.
- Only `--list-tools` is supported as a CLI flag; `--describe-tool` is not implemented.
- Engage is consumed as a local build with a `createApiClient` export (`npm/vendor/`); the published `17.0.0-beta.2` does not export it.
- Collection filters do not pull in dependent collections (e.g. `media` does not add `temporary-file`) the way the standalone CMS MCP does.
