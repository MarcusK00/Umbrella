**Let your AI tool work with your Umbraco site: content, forms, automations and personalisation, through one MCP server.**

Install Umbrella in your site, then connect Claude Code, VS Code, Cursor or Claude Desktop with the config the backoffice gives you. The AI gets tools for exactly the Umbraco products your site has: Umbraco CMS always, plus Umbraco Forms, Automate and Engage when they are installed. No product installed, no tools for it, so the AI isn't buried in tools it can't use.

![Umbrella, an Umbraco community add-on: one AI connection for your whole Umbraco site. Umbraco 17 · CMS, Forms, Automate and Engage](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-cover.png)

> "Create a contact form with name, email and message fields."
> "Add a news article under the News page and save it as a draft."
> "Which personas do we have in Engage?"

## What you get

- **One server for every product.** Every tool is prefixed with its product (`forms--list-forms`), so the AI picks the right one.
- **Config to copy, per person.** Settings → Umbrella → Overview has a ready-made setup for Claude Code, Claude Desktop, VS Code, Cursor and other clients, filled in with your site's address and the API user you pick. It holds no secret, so you can send it to an editor who has no access to the code.
- **A Claude Code plugin.** Two commands from the Overview install it, and Claude Code keeps the secret in your system's credential store instead of a file.
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

![Made for teams: everyone signs in as their own API user, so access follows the person, not the project. The Overview shows one row per person with who connected, when and with which version; Tool Permissions fine-tunes access down to groups of tools and can switch a product off for one person](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-teams.png)

## Get started

![Connect in minutes: no config files to write by hand. The Umbrella dashboard is ready to connect as soon as the add-on is installed: pick a user, pick your AI tool, and copy the ready-made setup](https://raw.githubusercontent.com/MarcusK00/Umbrella/v17/main/docs/images/umbrella-connect.png)

1. **Install the package** and restart the site: `dotnet add package Umbraco.Community.Umbrella`. Umbrella's major version follows Umbraco's, and without `--version` this installs the newest version, which needs the newest Umbraco. On an older Umbraco, add `--version` with the newest matching version from [the NuGet version list](https://www.nuget.org/packages/Umbraco.Community.Umbrella#versions-body-tab), for example the newest 17.x on Umbraco 17.
2. **Create an API user** (Users → Create → API user) with client credentials, and give its groups the sections the AI should work in. Copy the secret when you create it: Umbraco only keeps a hash.
3. **Copy the config** from **Settings → Umbrella → Overview**: pick the API user and your AI tool, and follow the steps it shows. For Claude Code you can install the plugin instead.
4. **Say hello.** Ask the AI to *"call get-mcp-health"*. It lists each product and how many tools it loaded.

The setup guide has each step in detail, including the secret, the Claude Code plugin and troubleshooting: [for Umbraco 18](https://github.com/MarcusK00/Umbrella/blob/v18/main/README.md) and [for Umbraco 17](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md).

## Requirements

| | |
|---|---|
| Umbraco | 17 (Umbrella 17.x) or 18 (Umbrella 18.x) |
| Products | Umbraco CMS, Forms, Automate, Engage |
| AI tool machine | Node.js 22.23.4+, 24.22.1+ or 26.12.1+ |

## More

- Full documentation, [Umbraco 18](https://github.com/MarcusK00/Umbrella/blob/v18/main/README.md) or [Umbraco 17](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md): configuration, tool groups, troubleshooting and known limitations
- [Issues on GitHub](https://github.com/MarcusK00/Umbrella/issues): bugs, ideas and questions
- [Security policy](https://github.com/MarcusK00/Umbrella/blob/v17/main/SECURITY.md): report vulnerabilities privately

Umbrella is a community project, not an official Umbraco HQ package. MIT licensed.
