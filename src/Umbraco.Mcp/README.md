# Umbrella

One MCP server for your Umbraco 17 site. This package goes in the site: it detects which Umbraco products are installed, so the [`umbrella-mcp`](https://www.npmjs.com/package/umbrella-mcp) server that your AI tool starts loads only their tools.

## Get started

1. Install this package in your site and restart it.
2. In the backoffice, create an API user with client credentials: client id `umbraco-back-office-mcp` and a secret of your choice. Give its groups the sections of the products the AI should use.
3. Set the secret on your machine: `export UMBRELLA_CLIENT_SECRET="<the client secret>"`.
4. Run the site in Development and open its folder in Claude Code or VS Code. The add-on has written a `.mcp.json` there that starts `umbrella-mcp` with `npx`. Approve the `umbraco` server when asked.

For other AI tools, copy the config from Settings → Health Check → MCP → "MCP client setup".

## What it adds

- `GET /umbraco/management/api/v1/mcp/capabilities`: the installed products, for the MCP server.
- Health checks in the **MCP** group: detected products, the MCP API user, and the client config.
- In Development only, a `.mcp.json` next to the site (never overwritten, no secret in it). Turn it off with `Umbraco:Mcp:McpJson:Enabled: false`.

Supported products: Umbraco CMS, Umbraco Forms, Umbraco Automate. Requires Umbraco 17 and Node.js 22+ on the machine running the AI tool.

Documentation: https://github.com/MarcusK00/Umbraco.MCP#readme
