# Umbrella for Umbraco

Connects your AI coding tool to an Umbraco 17 site through [`umbrella-mcp`](https://www.npmjs.com/package/umbrella-mcp): Umbraco CMS tools always, plus Umbraco Forms, Automate and Engage when the site has them installed.

## Prerequisites

- Umbraco 17 with [`Umbraco.Community.Umbrella`](https://www.nuget.org/packages/Umbraco.Community.Umbrella) installed
- An API user created in **Settings → Umbrella → Overview → New connection** (or **Users → Create → API user**)
- Node.js 22.23.4+ (24.22.1+ on Node 24, 26.12.1+ on Node 26)

## Configuration

| Variable | Meaning |
|---|---|
| `UMBRACO_BASE_URL` | The site's `https://` address |
| `UMBRACO_CLIENT_ID` | The API user's client id (for example `umbraco-back-office-mcp`) |
| `UMBRACO_CLIENT_SECRET` | The API user's client secret |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `1` to verify HTTPS certificates, or `0` only for a local site using the ASP.NET Core development certificate |

## Included skills

- **`health`** (`/umbrella:health` in Claude Code, `/health` in Antigravity, `$health` in Codex): calls `get-mcp-health` on the `umbraco` MCP server and explains what loaded and how to fix any issue.

See the [full Umbrella documentation](https://github.com/MarcusK00/Umbrella/blob/v17/main/README.md) for setup, permissions and troubleshooting.
