---
name: health
description: Check Umbrella's connection to the Umbraco site and explain what the MCP server loaded, what is missing and how to fix it. Use when Umbraco tools seem missing, a product's tools don't show up, or the user asks whether the Umbraco connection works.
---

# Umbrella health

Call the `get-mcp-health` tool of the `umbraco` MCP server from the Umbrella plugin, with no arguments. It only reads; it changes nothing on the site.

If the tool is not available, the MCP server did not start. Tell the user how to check their client:

- **Claude Code:**
  1. Run `/mcp` and look at the `umbraco` server from the `umbrella` plugin for the error.
  2. Check the plugin's settings with `/plugin configure umbrella@umbrella`: the site address must start with `https://`, and the client id and secret must belong to an API user in the site's backoffice.
  3. Run `/reload-plugins` after changing them.
- **Codex:**
  1. Run `/mcp` to check whether the `umbraco` server started.
  2. Verify `UMBRACO_BASE_URL` (must start with `https://`), `UMBRACO_CLIENT_ID`, and `UMBRACO_CLIENT_SECRET` are exported in the environment before launching Codex (plus `NODE_TLS_REJECT_UNAUTHORIZED=0` for a local development certificate).
  3. Restart Codex after changing environment variables.
- **Antigravity:**
  1. Open **Customizations → Installed** (or `/plugin`) and `/mcp` to check the `umbrella` plugin and `umbraco` server status.
  2. Verify the plugin variables (`UMBRACO_BASE_URL` starting with `https://`, `UMBRACO_CLIENT_ID`, `UMBRACO_CLIENT_SECRET`, and `NODE_TLS_REJECT_UNAUTHORIZED` set to `1` or `0` for a local dev certificate).
  3. Re-enable or restart after changing them.

Otherwise, report from the result, in this order:

1. **Access:** the `access` summary: which API user the server signed in as and what it can use.
2. **Products:** one line per product: loaded with how many tools, or not loaded and why (`access` is `off`, `noSectionAccess`, `notLoaded`, or the product isn't installed). Quote each product's `issues`.
3. **Notes:** each entry in `notes`, with what to do about it. A version note means the plugin's `umbrella-mcp` differs from the add-on on the site: update the plugin (**Claude Code:** `claude plugin marketplace update umbrella` and `claude plugin update umbrella@umbrella`; **Codex:** `codex plugin marketplace upgrade umbrella` and reinstall `umbrella@umbrella`; **Antigravity:** reinstall the plugin from GitHub) and restart the client.

Keep it short. Leave out products that loaded without issues beyond a single line, and don't repeat the raw JSON.
