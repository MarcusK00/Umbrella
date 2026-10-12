# ☂️ Umbrella

**Let your AI tool work with your Umbraco 17 site: content, forms, automations and personalisation, through one MCP server.**

Install this package in your site, and Claude Code, VS Code, Cursor or Claude Desktop get tools for exactly the Umbraco products your site has. No product installed, no tools for it, so the AI isn't buried in tools it can't use.

> "Create a contact form with name, email and message fields."
> "Add a news article under the News page and save it as a draft."
> "Which personas do we have in Engage?"

## ✨ What you get

- **One server for every product.** Umbraco CMS tools always, plus Umbraco Forms, Automate and Engage tools when the site has them installed.
- **Zero-config locally.** Run the site in Development and it writes a ready-to-use `.mcp.json` for Claude Code and VS Code, with no secret in it.
- **You stay in control.** The **Umbrella** dashboard (Settings section) has an **Overview** tab (status, config to copy for your AI tool, products, connected API users) and a **Tool groups** tab that switches tool groups off, or limits a product to read-only tools.
- **Easy to check.** Backoffice health checks show which products were found and which API user the AI signed in as. In the AI tool, `get-mcp-health` explains what loaded and why.

## 🚀 Get started in 5 steps

You need Umbraco 17, and Node.js 22 or later on the machine running your AI tool.

**1. Install the package** and restart the site:

```bash
dotnet add package Umbraco.Community.Umbrella
```

**2. Create an API user** in the backoffice (Users → Create → API user). Add client credentials with:
- client id: `umbraco-back-office-mcp`
- a secret of your choice. Copy it now: Umbraco only keeps a hash.

Give the user's groups the sections the AI should work in (Content, Media, Settings, Forms, …).

**3. Store the secret** on your machine:

```bash
# macOS / Linux
export UMBRELLA_CLIENT_SECRET="<the client secret>"
```

```powershell
# Windows (PowerShell)
setx UMBRELLA_CLIENT_SECRET "<the client secret>"
```

Then restart your AI tool, so it picks the variable up.

**4. Open the site's folder** in Claude Code or VS Code while the site runs in Development. Approve the `umbraco` server when asked.

**5. Say hello.** Ask the AI to *"call get-mcp-health"*. It lists each product and how many tools it loaded.

### Using another AI tool, or a site that isn't local?

Copy the config from **Settings → Health Check → MCP → "MCP client setup"**. It looks like this, with your site's address filled in:

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "npx",
      "args": ["-y", "umbrella-mcp@17.0.0-alpha.2"],
      "env": {
        "UMBRACO_BASE_URL": "https://your-site",
        "UMBRACO_CLIENT_ID": "umbraco-back-office-mcp",
        "UMBRACO_CLIENT_SECRET": "<your client secret>"
      }
    }
  }
}
```

The address must be `https://`. This config contains the secret, so keep it out of source control.

## 🧩 How it fits together

| Part | Where it runs | Job |
|---|---|---|
| `Umbraco.Community.Umbrella` (this package) | In your site | Detects the installed products and adds the dashboard and health checks |
| [`umbrella-mcp`](https://www.npmjs.com/package/umbrella-mcp) | On your machine | The MCP server. Your AI tool starts it with `npx`, so there is nothing to install |

Both are released together with the same version number. The package doesn't depend on any product package: it detects them by name.

## 📋 Requirements

| | |
|---|---|
| Umbraco | 17 |
| Products | Umbraco CMS, Forms, Automate, Engage |
| AI tool machine | Node.js 22+ |

## 📚 More

Configuration, turning tool groups off, troubleshooting and known limitations: **[full documentation on GitHub](https://github.com/MarcusK00/Umbraco.Community.Umbrella#readme)**.

Umbrella is a community project, not an official Umbraco HQ package. MIT licensed.
