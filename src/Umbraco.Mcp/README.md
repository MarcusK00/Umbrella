# ☂️ Umbrella

**Let your AI tool work with your Umbraco 18 site: content, forms, automations and personalisation, through one MCP server.**

Install this package in your site, then connect Claude Code, VS Code, Cursor or Claude Desktop with the config the backoffice gives you: each person connects their own AI tool. It gets tools for exactly the Umbraco products your site has. No product installed, no tools for it, so the AI isn't buried in tools it can't use.

![Umbrella, an Umbraco community add-on: one AI connection for your whole Umbraco site. Umbraco 18 · CMS, Forms, Automate and Engage](https://raw.githubusercontent.com/MarcusK00/Umbrella/v18/main/docs/images/umbrella-cover.png)

> "Create a contact form with name, email and message fields."
> "Add a news article under the News page and save it as a draft."
> "Which personas do we have in Engage?"

## ✨ What you get

- **One server for every product.** Umbraco CMS tools always, plus Umbraco Forms, Automate and Engage tools when the site has them installed.
- **Config to copy, per person.** Settings → Umbrella → Overview has the config for Claude Code, Claude Desktop, VS Code, Cursor and other clients, filled in with the site's address and the client id of the API user you pick. No secret in it, so you can send it to an editor who has no access to the code. For Claude Code there is also a plugin: two commands the Overview fills in, then a prompt for the secret, which Claude Code keeps in your system's credential store instead of a file.
- **You stay in control.** The **Umbrella** dashboard (Settings section) has an **Overview** tab (what needs attention, config to copy for your AI tool, the API users MCP servers connected as) and a **Tool Permissions** tab that sets each product's access, for every API user or for one: **Off** (the MCP server doesn't load the product at all), **Read-only**, **No deletes** (leaves out the tools the products flag `destructiveHint`: mostly deletes, emptying recycle bins and terminating runs; unpublishing, moving to the recycle bin, and CMS and Forms version rollback stay available) or **Full**, and switches single tool groups off.
- **Easy to check.** Backoffice health checks show which products were found and which API user the AI signed in as. In the AI tool, `get-mcp-health` explains what loaded and why.

## ⚙️ How it works

![Animation: an AI tool starts umbrella-mcp, which asks the Umbraco site which products are installed, loads CMS, Forms and Automate but not Engage, which isn't installed, and hands their prefixed tools back to the AI tool](https://raw.githubusercontent.com/MarcusK00/Umbrella/v18/main/docs/images/umbrella-animation.svg)

Your AI tool starts `umbrella-mcp`. The server signs in as an Umbraco API user, asks the site which products it has, and loads the tools for exactly those. Every tool is prefixed with its product (`forms--list-forms`), so the AI picks the right one.

## 👥 Many AI agents, each with its own access

![Animation: a dev agent, a content agent and an ops agent connect to the same site through umbrella-mcp, each as its own API user. The dev agent has full access; the content agent can list forms but gets no delete tool for pages; the ops agent runs an automation and asks get-mcp-health what it can use. A table then shows each agent's access per product.](https://raw.githubusercontent.com/MarcusK00/Umbrella/v18/main/docs/images/umbrella-agents.svg)

Each person, or each AI agent, connects as its own API user, and in **Settings → Umbrella → Tool Permissions** each API user can get its own access per product: **Off**, **Read-only**, **No deletes** or **Full**. A content agent can list forms but never gets a tool to delete pages; an ops agent can run automations while Forms stays off for it. `get-mcp-health` tells each agent what it can use.

![Made for teams: everyone signs in as their own API user, so access follows the person, not the project. The Overview shows one row per person with who connected, when and with which version; Tool Permissions fine-tunes access down to groups of tools and can switch a product off for one person](https://raw.githubusercontent.com/MarcusK00/Umbrella/v18/main/docs/images/umbrella-teams.png)

## 🚀 Get started in 5 steps

![Connect in minutes: no config files to write by hand. The Umbrella dashboard is ready to connect as soon as the add-on is installed: pick a user, pick your AI tool, and copy the ready-made setup](https://raw.githubusercontent.com/MarcusK00/Umbrella/v18/main/docs/images/umbrella-connect.png)

You need Umbraco 18, and Node.js 22.23.4 or later (24.22.1 or later on Node 24, 26.12.1 or later on Node 26) on the machine running your AI tool.

On Umbraco 17, use Umbrella 17.x instead: follow the [Umbraco 17 documentation](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md), and add `--version` with the newest 17.x version from [the NuGet version list](https://www.nuget.org/packages/Umbraco.Community.Umbrella#versions-body-tab), because `dotnet add package` without it installs the newest version, which needs Umbraco 18.

**1. Install the package** and restart the site:

```bash
dotnet add package Umbraco.Community.Umbrella
```

**2. Create an API user** in the backoffice (Users → Create → API user). Add client credentials with:
- a client id, for example `umbraco-back-office-mcp`
- a secret of your choice. Copy it now: Umbraco only keeps a hash.

Give the user's groups the sections the AI should work in (Content, Media, Settings, Forms, …). Each person who uses an AI tool gets an API user of their own.

**3. Copy the config.** In **Settings → Umbrella → Overview** ("Connect an AI tool", click **Show steps** if it is closed), pick the API user and your AI tool: Claude Code, Claude Desktop, VS Code, Cursor or another client. The plain version looks like this, with your site's address and the client id filled in:

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "npx",
      "args": ["-y", "umbrella-mcp@18.0.2"],
      "env": {
        "UMBRACO_BASE_URL": "https://your-site",
        "UMBRACO_CLIENT_ID": "umbraco-back-office-mcp",
        "UMBRACO_CLIENT_SECRET": "<your client secret>"
      }
    }
  }
}
```

**4. Add the secret.** Replace the placeholder with the client secret. VS Code asks for it when the server starts, and the Claude Code `.mcp.json` and Cursor configs read it from an environment variable:

```bash
# macOS / Linux
export UMBRELLA_CLIENT_SECRET="<the client secret>"
```

```powershell
# Windows (PowerShell)
setx UMBRELLA_CLIENT_SECRET "<the client secret>"
```

Then restart your AI tool and approve the `umbraco` server when asked. A config with the secret in it stays out of source control. The address must be `https://`.

**In Claude Code, you can use the plugin instead of steps 3 and 4.** Pick **Claude Code (plugin)** in the Overview, or run these two commands with your site's address and the API user's client id:

```bash
claude plugin marketplace add MarcusK00/Umbrella#v18/main
claude plugin install umbrella@umbrella --config base_url=https://your-site --config client_id=umbraco-back-office-mcp
```

Then run `/plugin configure umbrella@umbrella` in Claude Code. It asks for the client secret, hides it as you type, and keeps it in your system's credential store, not in a file. Restart Claude Code (or run `/reload-plugins`), and `/umbrella:health` checks the connection. It works in every folder you open, and the [Claude Code plugin](https://github.com/MarcusK00/Umbrella/blob/v18/main/README.md#claude-code-plugin) section of the full documentation has the details.

**5. Say hello.** Ask the AI to *"call get-mcp-health"*. It lists each product and how many tools it loaded.

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
