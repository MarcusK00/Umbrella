# ☂️ Umbrella

[![NuGet downloads](https://img.shields.io/nuget/dt/umbraco.community.umbrella)](https://www.nuget.org/packages/Umbraco.Community.Umbrella)

**Let your AI tool work with your Umbraco site: content, forms, automations and personalisation, through one MCP server.**

Install this package in your site, then connect Claude Code, Codex, Antigravity, VS Code, Cursor or Claude Desktop with the config the backoffice gives you: each person connects their own AI tool. It gets tools for exactly the Umbraco products your site has. No product installed, no tools for it, so the AI isn't buried in tools it can't use.

![Umbrella, an Umbraco community add-on: one AI connection for your whole Umbraco site. Umbraco 17 · CMS, Forms, Automate and Engage](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-cover.png)

> "Create a contact form with name, email and message fields."
> "Add a news article under the News page and save it as a draft."
> "Which personas do we have in Engage?"

## ✨ What you get

- **One server for every product.** Umbraco CMS tools always, plus Umbraco Forms, Automate and Engage tools when the site has them installed.
- **Set up a person in one panel.** **New connection** on Settings → Umbrella → Overview creates their API user, its client secret and its access per product, then shows the config for Claude Code, Claude Desktop, VS Code, Cursor, Codex, Antigravity and other clients, filled in with the site's address and the new client id. No secret in it, so you can send it to an editor who has no access to the code. There are also plugins for Claude Code, Codex and Antigravity: commands the Overview fills in, without putting the secret in a file.
- **You stay in control.** The **Umbrella** dashboard (Settings section) has an **Overview** tab (what needs attention, config to copy for your AI tool, and the API users with a menu each for their details, a new secret, disabling them or forgetting them) and a **Tool Permissions** tab that sets each product's access, for every API user or for one: **Off** (the MCP server doesn't load the product at all), **Read-only**, **No deletes** (leaves out the tools the products flag `destructiveHint`: mostly deletes, emptying recycle bins and terminating runs; unpublishing, moving to the recycle bin, and CMS and Forms version rollback stay available) or **Full**, and switches single tool groups off.
- **Easy to check.** Backoffice health checks show which products were found and which API user the AI signed in as. In the AI tool, `get-mcp-health` explains what loaded and why.

## ⚙️ How it works

![Animation: an AI tool starts umbrella-mcp, which asks the Umbraco site which products are installed, loads CMS, Forms and Automate but not Engage, which isn't installed, and hands their prefixed tools back to the AI tool](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-animation.svg)

Your AI tool starts `umbrella-mcp`. The server signs in as an Umbraco API user, asks the site which products it has, and loads the tools for exactly those. Every tool is prefixed with its product (`forms--list-forms`), so the AI picks the right one.

## 👥 Many AI agents, each with its own access

![Animation: a dev agent, a content agent and an ops agent connect to the same site through umbrella-mcp, each as its own API user. The dev agent has full access; the content agent can list forms but gets no delete tool for pages; the ops agent runs an automation and asks get-mcp-health what it can use. A table then shows each agent's access per product.](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-agents.svg)

Each person, or each AI agent, connects as its own API user, and in **Settings → Umbrella → Tool Permissions** each API user can get its own access per product: **Off**, **Read-only**, **No deletes** or **Full**. A content agent can list forms but never gets a tool to delete pages; an ops agent can run automations while Forms stays off for it. `get-mcp-health` tells each agent what it can use.

![Overview dashboard: connection status, default permissions per product with tool counts, and one row per API user with Client setup and New connection](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-dashboard-overview.png)

![Site-wide default tool permissions: set Off, Read-only, No deletes or Full per product, inspect context footprint, and toggle tool groups or individual tools](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-tool-permissions.png)

![Per-API-user tool permissions: products following site defaults stay compact with a Customise button](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-tool-permissions-follows.png)

![Custom per-user permissions: override a product's access level, tool groups and individual tools, with Destructive and Read-only badges](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-tool-permissions-custom.png)

## 🚀 Get started in 4 steps

You need Umbraco 17, and Node.js 22.23.4 or later (24.22.1 or later on Node 24, 26.12.1 or later on Node 26) on the machine running your AI tool.

**1. Install the package** and restart the site:

```bash
dotnet add package Umbraco.Community.Umbrella
```

**2. Create the connection.** In **Settings → Umbrella → Overview**, click **New connection** in **Connections**. Name the person or agent, pick what it may use per product (the defaults, or Off, Read-only, No deletes or Full) and its user groups, and create it. Each person who uses an AI tool gets an API user of their own.

The panel then shows the client secret once (copy it: Umbraco only keeps a hash) and the config for their AI tool: Claude Code, Claude Desktop, VS Code, Cursor, Codex, Antigravity or another client. The plain version looks like this, with your site's address and the client id filled in:

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "npx",
      "args": ["-y", "umbrella-mcp@17.1.3"],
      "env": {
        "UMBRACO_BASE_URL": "https://your-site",
        "UMBRACO_CLIENT_ID": "umbraco-back-office-mcp",
        "UMBRACO_CLIENT_SECRET": "<your client secret>"
      }
    }
  }
}
```

**3. Add the secret.** Replace the placeholder with the client secret. VS Code asks for it when the server starts, and the Claude Code `.mcp.json` and Cursor configs read it from an environment variable:

```bash
# macOS / Linux
export UMBRELLA_CLIENT_SECRET="<the client secret>"
```

```powershell
# Windows (PowerShell)
setx UMBRELLA_CLIENT_SECRET "<the client secret>"
```

Then restart your AI tool and approve the `umbraco` server when asked. A config with the secret in it stays out of source control. The address must be `https://`.

**Using Claude Code, Codex or Antigravity?** Pick the plugin option in step 2 instead, and skip step 3: see *Install a plugin* below.

**No access to the Users section?** Then New connection isn't shown. Ask someone who has it to use New connection, or to create the API user in Users → Create → API user, with client credentials and groups that grant the sections the AI should use. Then click **Client setup** on the Overview, pick that user and copy its config.

**4. Say hello.** Ask the AI to *"call get-mcp-health"*. It lists each product and how many tools it loaded.

## 🔌 Install a plugin (Claude Code, Codex, Antigravity)

Umbrella ships plugins for Claude Code, Codex and Antigravity so you don't edit a config file and the secret never lands in one. You need the site with this package installed and an API user with its client secret (step 2, **New connection**).

### Claude Code

1. **Install it.** Run these two commands in a terminal (the Overview's **Claude Code (plugin)** option fills in your site's address and client id):

   ```bash
   claude plugin marketplace add MarcusK00/Umbrella#v17/main
   claude plugin install umbrella@umbrella --config base_url=https://your-site --config client_id=umbraco-back-office-mcp
   ```

2. **Add the secret.** In Claude Code, run `/plugin configure umbrella@umbrella`. It keeps the secret in your system's credential store.
3. **Start it.** Restart Claude Code, or run `/reload-plugins`. `/mcp` lists `plugin:umbrella:umbraco`, and `/umbrella:health` checks the connection.

### Codex

1. **Install it.** The Overview's **Codex (plugin)** option fills in these commands and exports:

   ```bash
   codex plugin marketplace add MarcusK00/Umbrella#v17/main
   codex plugin add umbrella@umbrella
   export UMBRACO_BASE_URL=https://your-site
   export UMBRACO_CLIENT_ID=umbraco-back-office-mcp
   ```

2. **Add the secret.** Export `UMBRACO_CLIENT_SECRET` (plus `NODE_TLS_REJECT_UNAUTHORIZED=0` for a local development certificate) in your shell profile, then restart Codex.

### Antigravity

1. **Install it.** Run:

   ```bash
   agy plugin install https://github.com/MarcusK00/Umbrella/tree/v17/main/plugins/umbrella
   ```

2. **Configure and enable it.** Open **Customizations → Installed** (or `/plugin`), enable **umbrella**, and enter `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID`, `UMBRACO_CLIENT_SECRET`, and `NODE_TLS_REJECT_UNAUTHORIZED` (`1`, or `0` for a local dev certificate).

More on values, updates and limits: [Plugins](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md#claude-code-plugin) in the full documentation.

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
| AI tool machine | Node.js 22.23.4+, 24.22.1+ or 26.12.1+ |

## 📚 More

Configuration, turning tool groups off, troubleshooting and known limitations: **[full documentation on GitHub](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md)**.

Bugs, ideas and questions: **[Umbrella issues on GitHub](https://github.com/MarcusK00/Umbrella/issues)**. Report security vulnerabilities privately, as described in the [security policy](https://github.com/MarcusK00/Umbrella/blob/v17/main/SECURITY.md).

Umbrella is a community project, not an official Umbraco HQ package. MIT licensed.
