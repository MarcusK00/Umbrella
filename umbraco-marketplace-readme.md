**Let your AI tool work with your Umbraco site: content, forms, automations and personalisation, through one MCP server.**

Install Umbrella in your site, then connect Claude Code, VS Code, Cursor or Claude Desktop with the config the backoffice gives you. The AI gets tools for exactly the Umbraco products your site has: Umbraco CMS always, plus Umbraco Forms, Automate and Engage when they are installed. No product installed, no tools for it, so the AI isn't buried in tools it can't use.

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

Umbrella has two parts, released together with the same version number:

| Part | Where it runs | Job |
|---|---|---|
| `Umbraco.Community.Umbrella` | In your site | Detects the installed products and adds the dashboard and health checks |
| [`umbrella-mcp`](https://www.npmjs.com/package/umbrella-mcp) | On the machine running your AI tool | The MCP server. Your AI tool starts it with `npx`, so there is nothing to install |

The server signs in as an Umbraco API user, asks the site which products it has, and loads the tools for exactly those. The package doesn't depend on any product package: it detects them by name.

## Get started

1. **Install the package** and restart the site: `dotnet add package Umbraco.Community.Umbrella`
2. **Create an API user** (Users → Create → API user) with client credentials, and give its groups the sections the AI should work in. Copy the secret when you create it: Umbraco only keeps a hash.
3. **Copy the config** from **Settings → Umbrella → Overview**: pick the API user and your AI tool, and follow the steps it shows. For Claude Code you can install the plugin instead.
4. **Say hello.** Ask the AI to *"call get-mcp-health"*. It lists each product and how many tools it loaded.

The [setup guide](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md) has each step in detail, including the secret, the Claude Code plugin and troubleshooting.

## Requirements

| | |
|---|---|
| Umbraco | 17 |
| Products | Umbraco CMS, Forms, Automate, Engage |
| AI tool machine | Node.js 22.23.4+, 24.22.1+ or 26.12.1+ |

## More

- [Full documentation](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md): configuration, tool groups, troubleshooting and known limitations
- [Issues on GitHub](https://github.com/MarcusK00/Umbrella/issues): bugs, ideas and questions
- [Security policy](https://github.com/MarcusK00/Umbrella/blob/v17/main/SECURITY.md): report vulnerabilities privately

Umbrella is a community project, not an official Umbraco HQ package. MIT licensed.
