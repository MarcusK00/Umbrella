# Umbrella

One MCP server for your Umbraco 17 site. This package goes in the site: it detects which Umbraco products are installed, so the [`umbrella-mcp`](https://www.npmjs.com/package/umbrella-mcp) server that your AI tool starts loads only their tools.

## Get started

1. Install this package in your site and restart it.
2. In the backoffice, create an API user with client credentials: client id `umbraco-back-office-mcp` and a secret of your choice. Keep a copy of the secret, and give the user's groups the sections of the products the AI should use.
3. Set the secret on the machine that runs your AI tool, then restart the AI tool:
   - macOS / Linux: `export UMBRELLA_CLIENT_SECRET="<the client secret>"`
   - Windows (PowerShell): `setx UMBRELLA_CLIENT_SECRET "<the client secret>"`
4. Run the site in Development and open its folder in Claude Code or VS Code. The add-on has written a `.mcp.json` there that starts `umbrella-mcp` with `npx`. Approve the `umbraco` server when asked.
5. Ask the AI to call `get-mcp-health` to see which products' tools loaded.

For other AI tools, or a site that isn't running locally, copy the config from Settings → Health Check → MCP → "MCP client setup".

## What it adds

- `GET /umbraco/management/api/v1/mcp/capabilities`: the installed products, for the MCP server.
- Settings → **Umbrella**: switch the MCP server's tool groups off, or limit a product to read-only tools. Changes apply the next time the MCP server starts. Three duplicate or test-only groups (Forms `umbraco-server` and `acceptance-tests`, Automate `umbraco-server`) are off until you save a product's list.
- Health checks in the **MCP** group: detected products, the API user the MCP server connected as, and the client config.
- In Development only, a `.mcp.json` next to the site (no secret in it). A file you edited is never overwritten; one the site wrote is updated when you upgrade the add-on. Turn it off with `Umbraco:Mcp:McpJson:Enabled: false`.

The add-on has no dependency on any product package: it detects products by name.

Supported products: Umbraco CMS, Umbraco Forms, Umbraco Automate, Umbraco Engage. Requires Umbraco 17, and Node.js 22+ on the machine running the AI tool.

Documentation, configuration and troubleshooting: https://github.com/MarcusK00/Umbraco.Community.Umbrella#readme
