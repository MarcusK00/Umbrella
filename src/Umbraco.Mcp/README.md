# ☂️ Umbrella

**Let your AI tool work with your Umbraco site: content, forms, automations and personalisation, through one MCP server.**

Install this package in your site, then connect Claude Code, VS Code, Cursor or Claude Desktop with the config the backoffice gives you: each person connects their own AI tool. It gets tools for exactly the Umbraco products your site has. No product installed, no tools for it, so the AI isn't buried in tools it can't use.

![Umbrella, an Umbraco community add-on: one AI connection for your whole Umbraco site. Umbraco 18 · CMS, Forms, Automate and Engage](https://raw.githubusercontent.com/MarcusK00/Umbrella/v18/main/docs/images/umbrella-cover.png)

> "Create a contact form with name, email and message fields."
> "Add a news article under the News page and save it as a draft."
> "Which personas do we have in Engage?"

## ✨ What you get

- **One server for every product.** Umbraco CMS tools always, plus Umbraco Forms, Automate and Engage tools when the site has them installed.
- **Set up a person in one panel.** **New connection** on Settings → Umbrella → Overview creates their API user, its client secret and its access per product, then shows the config for Claude Code, Claude Desktop, VS Code, Cursor and other clients, filled in with the site's address and the new client id. No secret in it, so you can send it to an editor who has no access to the code. For Claude Code there is also a plugin: two commands the Overview fills in, then a prompt for the secret, which Claude Code keeps in your system's credential store instead of a file.
- **You stay in control.** The **Umbrella** dashboard (Settings section) has an **Overview** tab (what needs attention, config to copy for your AI tool, and the API users with a menu each for their details, a new secret, disabling them or forgetting them) and a **Tool Permissions** tab that sets each product's access, for every API user or for one: **Off** (the MCP server doesn't load the product at all), **Read-only**, **No deletes** (leaves out the tools the products flag `destructiveHint`: mostly deletes, emptying recycle bins and terminating runs; unpublishing, moving to the recycle bin, and CMS and Forms version rollback stay available) or **Full**, and switches single tool groups off.
- **Easy to check.** Backoffice health checks show which products were found and which API user the AI signed in as. In the AI tool, `get-mcp-health` explains what loaded and why.

## ⚙️ How it works

![Animation: an AI tool starts umbrella-mcp, which asks the Umbraco site which products are installed, loads CMS, Forms and Automate but not Engage, which isn't installed, and hands their prefixed tools back to the AI tool](https://raw.githubusercontent.com/MarcusK00/Umbrella/v18/main/docs/images/umbrella-animation.svg)

Your AI tool starts `umbrella-mcp`. The server signs in as an Umbraco API user, asks the site which products it has, and loads the tools for exactly those. Every tool is prefixed with its product (`forms--list-forms`), so the AI picks the right one.

## 👥 Many AI agents, each with its own access

![Animation: a dev agent, a content agent and an ops agent connect to the same site through umbrella-mcp, each as its own API user. The dev agent has full access; the content agent can list forms but gets no delete tool for pages; the ops agent runs an automation and asks get-mcp-health what it can use. A table then shows each agent's access per product.](https://raw.githubusercontent.com/MarcusK00/Umbrella/v18/main/docs/images/umbrella-agents.svg)

Each person, or each AI agent, connects as its own API user, and in **Settings → Umbrella → Tool Permissions** each API user can get its own access per product: **Off**, **Read-only**, **No deletes** or **Full**. A content agent can list forms but never gets a tool to delete pages; an ops agent can run automations while Forms stays off for it. `get-mcp-health` tells each agent what it can use.

![Overview dashboard: connection status, default permissions per product, and one row per API user with Client setup and New connection](https://raw.githubusercontent.com/MarcusK00/Umbrella/v18/main/docs/images/umbrella-dashboard-overview.png)

## 🚀 Get started in 4 steps

![Per-user tool permissions: set site-wide defaults or customise Off, Read-only, No deletes or Full per product for each API user](https://raw.githubusercontent.com/MarcusK00/Umbrella/v18/main/docs/images/umbrella-tool-permissions.png)

![Tool groups and individual tools: toggle entire groups or single tools on and off, with Read-only and Destructive badges](https://raw.githubusercontent.com/MarcusK00/Umbrella/v18/main/docs/images/umbrella-tool-groups.jpg)

You need Umbraco 18, and Node.js 22.23.4 or later (24.22.1 or later on Node 24, 26.12.1 or later on Node 26) on the machine running your AI tool.

On Umbraco 17, use Umbrella 17.x instead: follow the [Umbraco 17 documentation](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md), and add `--version` with the newest 17.x version from [the NuGet version list](https://www.nuget.org/packages/Umbraco.Community.Umbrella#versions-body-tab), because `dotnet add package` without it installs the newest version, which needs Umbraco 18.

**1. Install the package** and restart the site:

```bash
dotnet add package Umbraco.Community.Umbrella
```

**2. Create the connection.** In **Settings → Umbrella → Overview**, click **New connection** in **Access per API user**. Name the person or agent, pick what it may use per product (the defaults, or Off, Read-only, No deletes or Full) and its user groups, and create it. Each person who uses an AI tool gets an API user of their own.

The panel then shows the client secret once (copy it: Umbraco only keeps a hash) and the config for their AI tool: Claude Code, Claude Desktop, VS Code, Cursor or another client. The plain version looks like this, with your site's address and the client id filled in:

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "npx",
      "args": ["-y", "umbrella-mcp@18.1.1"],
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

**Using Claude Code?** Pick **Claude Code (plugin)** in step 2 instead, and skip step 3: see *Install the Claude Code plugin* below.

**No access to the Users section?** Then New connection isn't shown. Ask someone who has it to use New connection, or to create the API user in Users → Create → API user, with client credentials and groups that grant the sections the AI should use. Then pick it under **Connect an AI tool** on the Overview to copy its config.

**4. Say hello.** Ask the AI to *"call get-mcp-health"*. It lists each product and how many tools it loaded.

## 🔌 Install the Claude Code plugin

Umbrella is also a Claude Code plugin, so you don't edit a config file and the secret never lands in one. It works in the terminal, in the VS Code and JetBrains extensions, and in the Desktop app's Code tab. You need the site with this package installed and an API user with its client secret (step 2, **New connection**).

**1. Install it.** Claude Code fetches the plugin from GitHub, so there is nothing to download by hand. Run these two commands in a terminal. The Overview's **Claude Code (plugin)** option shows them with your site's address and the API user's client id filled in:

```bash
claude plugin marketplace add MarcusK00/Umbrella#v18/main
claude plugin install umbrella@umbrella --config base_url=https://your-site --config client_id=umbraco-back-office-mcp
```

Inside Claude Code, `/plugin marketplace add MarcusK00/Umbrella#v18/main` and then `/plugin install umbrella@umbrella` do the same and ask for each value.

**2. Add the secret.** In Claude Code, run `/plugin configure umbrella@umbrella`. It asks for the client secret, hides it as you type, and keeps it in your system's credential store, not in a file.

**3. Start it.** Restart Claude Code, or run `/reload-plugins`. `/mcp` lists the server as `plugin:umbrella:umbraco`, and `/umbrella:health` checks the connection and explains what loaded.

The plugin works in every folder you open. It isn't updated on its own: after upgrading Umbrella, run `claude plugin marketplace update umbrella` and `claude plugin update umbrella@umbrella`, then restart Claude Code. More on values, updates and limits: [Claude Code plugin](https://github.com/MarcusK00/Umbrella/blob/v18/main/README.md#claude-code-plugin) in the full documentation.

## 🧩 How it fits together

| Part | Where it runs | Job |
|---|---|---|
| `Umbraco.Community.Umbrella` (this package) | In your site | Detects the installed products and adds the dashboard and health checks |
| [`umbrella-mcp`](https://www.npmjs.com/package/umbrella-mcp) | On your machine | The MCP server. Your AI tool starts it with `npx`, so there is nothing to install |

Both are released together with the same version number. The package doesn't depend on any product package: it detects them by name.

## 📋 Requirements

| | |
|---|---|
| Umbraco | 18 |
| Products | Umbraco CMS, Forms, Automate, Engage |
| AI tool machine | Node.js 22.23.4+, 24.22.1+ or 26.12.1+ |

## 📚 More

Configuration, turning tool groups off, troubleshooting and known limitations: **[full documentation on GitHub](https://github.com/MarcusK00/Umbrella/blob/v18/main/README.md)**.

Bugs, ideas and questions: **[Umbrella issues on GitHub](https://github.com/MarcusK00/Umbrella/issues)**. Report security vulnerabilities privately, as described in the [security policy](https://github.com/MarcusK00/Umbrella/blob/v18/main/SECURITY.md).

Umbrella is a community project, not an official Umbraco HQ package. MIT licensed.
