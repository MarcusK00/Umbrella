[![NuGet downloads](https://img.shields.io/nuget/dt/umbraco.community.umbrella)](https://www.nuget.org/packages/Umbraco.Community.Umbrella)

**Let your AI tool work with your Umbraco site: content, forms, automations and personalisation, through one MCP server.**

Install Umbrella in your site, then connect Claude Code, Codex, Antigravity, VS Code, Cursor or Claude Desktop with the config the backoffice gives you. The AI gets tools for exactly the Umbraco products your site has: Umbraco CMS always, plus Umbraco Forms, Automate and Engage when they are installed. No product installed, no tools for it, so the AI isn't buried in tools it can't use.

![Umbrella, an Umbraco community add-on: one AI connection for your whole Umbraco site. Umbraco 17 · CMS, Forms, Automate and Engage](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-cover.png)

> "Create a contact form with name, email and message fields."
> "Add a news article under the News page and save it as a draft."
> "Which personas do we have in Engage?"

## What you get

- **One server for every product.** Every tool is prefixed with its product (`forms--list-forms`), so the AI picks the right one.
- **Set up a person in one panel.** **New connection** on Settings → Umbrella → Overview creates their API user, its client secret and its access per product, then shows a ready-made setup for Claude Code, Claude Desktop, VS Code, Cursor, Codex, Antigravity and other clients, filled in with your site's address and the new client id. The setup holds no secret, so you can send it to an editor who has no access to the code.
- **Look after each user.** Every API user's row on the Overview has a menu with its details, a new secret (for a lost or leaked one), disable and enable, and forget.
- **Plugins for Claude Code, Codex and Antigravity.** The Overview gives you install commands so you don't edit config files by hand and secrets stay out of source control.
- **Access per AI agent.** Each person or agent connects as its own API user. In **Settings → Umbrella → Tool Permissions** each one gets its own access per product: **Off**, **Read-only**, **No deletes** or **Full**, and single groups of tools can be switched off.
- **Easy to check.** Backoffice health checks show which products were found and which API user the AI signed in as. In the AI tool, `get-mcp-health` explains what loaded and why.

## How it works

![Animation: an AI tool starts umbrella-mcp, which asks the Umbraco site which products are installed, loads CMS, Forms and Automate but not Engage, which isn't installed, and hands their prefixed tools back to the AI tool](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-animation.svg)

Umbrella has two parts, released together with the same version number:

| Part | Where it runs | Job |
|---|---|---|
| `Umbraco.Community.Umbrella` | In your site | Detects the installed products and adds the dashboard and health checks |
| [`umbrella-mcp`](https://www.npmjs.com/package/umbrella-mcp) | On the machine running your AI tool | The MCP server. Your AI tool starts it with `npx`, so there is nothing to install |

The server signs in as an Umbraco API user, asks the site which products it has, and loads the tools for exactly those. The package doesn't depend on any product package: it detects them by name.

## Many AI agents, each with its own access

![Animation: a dev agent, a content agent and an ops agent connect to the same site through umbrella-mcp, each as its own API user. The dev agent has full access; the content agent can list forms but gets no delete tool for pages; the ops agent runs an automation and asks get-mcp-health what it can use. A table then shows each agent's access per product.](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-agents.svg)

Each person, or each AI agent, connects as its own API user and gets its own access per product. A content agent can list forms but never gets a tool to delete pages; an ops agent can run automations while Forms stays off for it. `get-mcp-health` tells each agent what it can use.

![Overview dashboard: connection status, default permissions per product, and one row per API user with Client setup and New connection](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-dashboard-overview.png)

![Per-user tool permissions: set site-wide defaults or customise Off, Read-only, No deletes or Full per product for each API user](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-tool-permissions.png)

![Tool groups and individual tools: toggle entire groups or single tools on and off, with Read-only and Destructive badges](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-tool-groups.jpg)

## Get started

1. **Install the package** and restart the site. Umbrella's major version follows Umbraco's, so pick the command for your Umbraco version:

   ```bash
   # Umbraco 18
   dotnet add package Umbraco.Community.Umbrella

   # Umbraco 17
   dotnet add package Umbraco.Community.Umbrella --version "17.*"
   ```

   Without `--version`, NuGet installs the newest version, which needs the newest Umbraco (18), so on Umbraco 17 the `--version "17.*"` is needed.
2. **Create the connection.** In **Settings → Umbrella → Overview**, click **New connection**: name the person or agent, pick what it may use per product and its user groups, and create it. Copy the client secret it shows once (Umbraco only keeps a hash), then the config for their AI tool, and follow the steps it shows. Using Claude Code, Codex or Antigravity? Pick the plugin there: see *Plugins* below.
3. **Say hello.** Ask the AI to *"call get-mcp-health"*. It lists each product and how many tools it loaded.

No access to the Users section? Then New connection isn't shown: ask someone who has it, or have them create the API user in Users → Create → API user, then pick it under **Connect an AI tool** on the Overview. Older Umbrella versions have no New connection and work that way too.

The setup guide has each step in detail, including the secret, plugins and troubleshooting: [for Umbraco 18](https://github.com/MarcusK00/Umbrella/blob/v18/main/README.md) and [for Umbraco 17](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md).

## Plugins (Claude Code, Codex, Antigravity)

Umbrella is also packaged as a plugin for Claude Code, Codex and Antigravity, so you don't edit a config file by hand and the secret never lands in one. You need the site with the package installed and an API user with its client secret (steps 1 and 2 above).

- **Claude Code:** run `claude plugin marketplace add MarcusK00/Umbrella#v18/main` (`#v17/main` for Umbraco 17) and `claude plugin install umbrella@umbrella --config base_url=https://your-site --config client_id=umbraco-back-office-mcp`, then `/plugin configure umbrella@umbrella` for the secret.
- **Codex:** run `codex plugin marketplace add MarcusK00/Umbrella#v18/main` (`#v17/main` for Umbraco 17) and `codex plugin add umbrella@umbrella`, and export `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID` and `UMBRACO_CLIENT_SECRET`.
- **Antigravity:** run `agy plugin install https://github.com/MarcusK00/Umbrella/tree/v18/main/plugins/umbrella` (`v17/main` for Umbraco 17), then enable **umbrella** in **Customizations → Installed** (or `/plugin`) and enter `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID`, `UMBRACO_CLIENT_SECRET` and `NODE_TLS_REJECT_UNAUTHORIZED`.

More on values, updates and limits in the full documentation: [Umbraco 18](https://github.com/MarcusK00/Umbrella/blob/v18/main/README.md#claude-code-plugin) or [Umbraco 17](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md#claude-code-plugin).

## Requirements

| | |
|---|---|
| Umbraco | 17 (Umbrella 17.x) or 18 (Umbrella 18.x) |
| Products | Umbraco CMS. Forms, Automate and Engage are optional: Umbrella adds their tools when they are installed |
| AI tool machine | Node.js 22.23.4+, 24.22.1+ or 26.12.1+ |

## More

- Full documentation, [Umbraco 18](https://github.com/MarcusK00/Umbrella/blob/v18/main/README.md) or [Umbraco 17](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md): configuration, tool groups, troubleshooting and known limitations
- [Issues on GitHub](https://github.com/MarcusK00/Umbrella/issues): bugs, ideas and questions
- [Security policy](https://github.com/MarcusK00/Umbrella/blob/v17/main/SECURITY.md): report vulnerabilities privately

Umbrella is a community project, not an official Umbraco HQ package. MIT licensed.
