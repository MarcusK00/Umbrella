---
description: Check Umbrella's connection to the Umbraco site and explain what the MCP server loaded, what is missing and how to fix it. Use when Umbraco tools seem missing, a product's tools don't show up, or the user asks whether the Umbraco connection works.
---

# Umbrella health

Call the `get-mcp-health` tool of the `umbraco` MCP server from the Umbrella plugin, with no arguments. It only reads; it changes nothing on the site.

If the tool is not available, the MCP server did not start. Tell the user to:

1. Run `/mcp` and look at the `umbraco` server from the `umbrella` plugin for the error.
2. Check the plugin's settings with `/plugin configure umbrella@umbrella`: the site address must start with `https://`, and the client id and secret must belong to an API user in the site's backoffice.
3. Run `/reload-plugins` after changing them.

Otherwise, report from the result, in this order:

1. **Access:** the `access` summary: which API user the server signed in as and what it can use.
2. **Products:** one line per product: loaded with how many tools, or not loaded and why (`access` is `off`, `noSectionAccess`, `notLoaded`, or the product isn't installed). Quote each product's `issues`.
3. **Notes:** each entry in `notes`, with what to do about it. A version note means the plugin's `umbrella-mcp` differs from the add-on on the site: update the plugin with `claude plugin marketplace update umbrella` and `claude plugin update umbrella@umbrella`, then restart Claude Code.

Keep it short. Leave out products that loaded without issues beyond a single line, and don't repeat the raw JSON.
