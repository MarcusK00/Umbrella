# umbrella-mcp

One MCP server for your Umbraco 17 site. It loads the Umbraco CMS tools, plus Umbraco Forms, Umbraco Automate and Umbraco Engage tools when the site has those products installed. Tools are prefixed `cms--`, `forms--`, `automate--` and `engage--`, and `get-mcp-health` explains what loaded and why.

## Setup

Product detection needs the [`Umbraco.Community.Umbrella`](https://www.nuget.org/packages/Umbraco.Community.Umbrella) NuGet package in the site. That package also shows the client config for each API user in the backoffice (Settings → Umbrella → Overview), so you normally never install this package by hand. Your AI tool starts it with `npx`:

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "npx",
      "args": ["-y", "umbrella-mcp@17.0.0-alpha.4"],
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
| `UMBRACO_NO_DESTRUCTIVE` | `true` leaves out tools the products mark as destructive (`destructiveHint`), for every product |
| `UMBRACO_INCLUDE_TOOL_COLLECTIONS`, `UMBRACO_EXCLUDE_TOOL_COLLECTIONS`, `UMBRACO_INCLUDE_TOOLS`, `UMBRACO_EXCLUDE_TOOLS`, `UMBRACO_TOOL_MODES` | Filters. Unprefixed entries apply to CMS, `forms:<value>` to Forms; the tool lists also accept names like `forms--list-forms` |

Tool groups switched off in the backoffice (Settings → Umbrella) are left out on the next start, unless the environment sets `UMBRACO_INCLUDE_TOOL_COLLECTIONS` or `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` for that product. A product set to read-only there registers only its read-only tools, and one set to no destructive tools leaves out its destructive tools; both always apply.

Some tool groups are off by default because they repeat another tool, are test aids or serve only the backoffice UI:

| Product | Groups off by default |
|---|---|
| Umbraco CMS | `manifest`, `user-data`, `imaging` |
| Umbraco Forms | `umbraco-server`, `acceptance-tests`, `licensing`, `updates`, `media` |
| Umbraco Automate | `umbraco-server` |
| Umbraco Engage | `package`, `add-ons`, `cultures` |

They stay off until the site saves a list for that product in the dashboard, or the environment sets a collection filter for it: `UMBRACO_INCLUDE_TOOL_COLLECTIONS=forms:*` brings the Forms ones back, and `cms:*` the CMS ones. Any collection filter for a product replaces its defaults.

`umbrella-mcp --list-tools` prints the tool names it would register, then exits.

Requires Node.js 22 or later and Umbraco 17. Full configuration, troubleshooting and known limitations: https://github.com/MarcusK00/Umbraco.Community.Umbrella#readme
