# umbrella-mcp

One MCP server for your Umbraco 17 site. It loads the Umbraco CMS tools, plus Umbraco Forms and Umbraco Automate tools when the site has those products installed. Tools are prefixed `cms--`, `forms--` and `automate--`, and `get-mcp-health` explains what loaded and why.

## Setup

Product detection needs the [`Umbraco.Community.Umbrella`](https://www.nuget.org/packages/Umbraco.Community.Umbrella) NuGet package in the site. That package also writes a ready-to-use `.mcp.json` in Development and shows the client config in the backoffice (Settings → Health Check → MCP → "MCP client setup"), so you normally never install this package by hand. Your AI tool starts it with `npx`:

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

- Use the same version as the NuGet package: the two are released together.
- The client id and secret belong to an Umbraco API user with client credentials. Give its user groups the sections of the products the AI should use.
- `UMBRACO_BASE_URL` must be `https://`: the Management API token endpoint rejects plain HTTP.

Without the NuGet package, the server still starts, with CMS tools only.

## Options

| Environment variable | Meaning |
|---|---|
| `UMBRACO_MCP_MODULES` | Force modules on without detection, for example `forms,automate` |
| `UMBRACO_READONLY` | `true` registers only read-only tools, for every product |
| `UMBRACO_INCLUDE_TOOL_COLLECTIONS`, `UMBRACO_EXCLUDE_TOOL_COLLECTIONS`, `UMBRACO_INCLUDE_TOOLS`, `UMBRACO_EXCLUDE_TOOLS`, `UMBRACO_TOOL_MODES` | Filters. Unprefixed entries apply to CMS, `forms:<value>` to Forms; the tool lists also accept names like `forms--list-forms` |

Tool groups switched off in the backoffice (Settings → Umbrella) are left out on the next start, unless the environment sets `UMBRACO_INCLUDE_TOOL_COLLECTIONS` or `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` for that product. A product set to read-only there registers only its read-only tools; that always applies.

`umbrella-mcp --list-tools` prints the tool names it would register, then exits.

Requires Node.js 22 or later and Umbraco 17. Full configuration, troubleshooting and known limitations: https://github.com/MarcusK00/Umbraco.Community.Umbrella#readme
