# umbrella-mcp

One MCP server for your Umbraco 17 site. It loads the Umbraco CMS tools, plus Umbraco Forms and Umbraco Automate tools when the site has those products installed. Tools are prefixed `cms--`, `forms--` and `automate--`, and `get-mcp-health` explains what loaded and why.

Product detection needs the [`Umbraco.Community.Umbrella`](https://www.nuget.org/packages/Umbraco.Community.Umbrella) NuGet package in the site. That package also writes a ready-to-use `.mcp.json` in Development and shows the client config in the backoffice, so you normally never install this package by hand. Your AI tool starts it with `npx`:

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

Use the same version as the NuGet package: the two are released together.

Requires Node.js 22 or later and Umbraco 17. Configuration, filters and known limitations: https://github.com/MarcusK00/Umbraco.Community.Umbrella#readme
