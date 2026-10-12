# Dashboard Overview — Design Spec

- **Date:** 12-10-2026
- **Status:** Approved, not implemented
- **Author:** mkr@umbraco.dk (with Claude)
- **Builds on:** `2026-10-12-backoffice-tool-toggles-design.md` (the Umbrella dashboard), `2026-10-11-umbraco-mcp-umbrella-design.md` (health checks, `.mcp.json` writer)
- **Part of:** the second brainstorm of 12-10-2026, idea (a). It comes before the setup wizard (roadmap #3), which will live in this Overview.

## 1. Intent

Umbrella's status and setup help are split over two places that do not point at each other: Settings → Health Check → MCP (three checks of plain text rows, no actions) and Settings → Umbrella (tool groups only). The Umbrella dashboard becomes the one place to connect an AI tool and see whether everything works. It serves both a developer connecting an AI tool and an admin checking a running site, with setup help first when something is not connected yet.

What we saw on the demo site (12-10-2026):

- "MCP API user" lists two API users, one a leftover test client (`umbraco-back-office-mcp-doctor`), with no way to tell which is current or to remove it.
- The version-mismatch warning sits under the JSON snippet in "MCP client setup", a check whose name suggests a config helper rather than status.
- The snippet has one format (`mcpServers`) and no copy button.
- The Umbrella dashboard shows 101 checkboxes and nothing about status.

### Success criteria

- Settings → Umbrella opens on an **Overview** tab. The existing page is the **Tool groups** tab and works as before.
- The Overview lists every warning the three health checks would show, with the same wording, and says "Everything is connected" when there are none.
- It has copy-ready setup for Claude Code, VS Code, Cursor and other `mcpServers` clients. None of them contains the client secret.
- In Development, **Write .mcp.json** creates or upgrades the file under exactly the startup writer's rules and says what it did.
- **Forget** removes an API user's connection record, never the user. The row disappears and comes back when that user connects again.
- The three health checks keep their names and GUIDs, show one line per problem (or one success line), and link to the dashboard. "MCP client setup" no longer contains the snippet.
- The npm server is unchanged.

### Out of scope

The setup wizard (creating users and secrets), live tool updates, moving the dashboard tab, npm changes, and pruning connections automatically.

## 2. Page layout

The dashboard element gets an inner tab group: **Overview** (default) and **Tool groups**. The Overview has four boxes, top to bottom.

1. **Status.** One headline: "Everything is connected", or "N things need attention" where N is the number of warnings. Below it, every finding with a warning or info icon. A finding with a fix says it in the same sentence.
2. **Connect an AI tool.** Expanded when no API user has connected, no MCP server has reported, or there is a warning in the `server` or `apiUsers` area; collapsed otherwise. One tab per client (section 4), each with the file name or "Run in a terminal", the content in a `<pre>`, and a **Copy** button (`navigator.clipboard.writeText`; on failure a danger notification says to copy by hand). Under the tabs, when `mcpJson.available`: a **Write .mcp.json** button and, after a click, the outcome sentence (section 5).
3. **Products.** A table of installed products: name, version, "API available" yes/no, "Loaded by the MCP server" (yes when the catalogue has the module), tool count (sum of `toolCount` over the module's reported collections). Products that are not installed are one muted line: "Not installed: Umbraco Engage, …".
4. **MCP server and API users.**
   - Server: "umbrella-mcp 17.0.0-alpha.2 last started 12-10-2026 15:05" (browser time, DD-MM-YYYY HH:mm, as the tool groups tab does), with a warning style when it does not match the add-on. Before the first report: "No MCP server has started yet."
   - One row per API user: name, client ids, last connected, state (active / disabled / locked out), products it can reach and products it cannot. A **Forget** button opens a confirm dialog ("Forget MCP connection? This does not delete the API user. It appears here again if it connects again.") and then calls `DELETE`.

All text is rendered by Lit, so values are escaped.

## 3. Backend

### 3.1 `McpOverviewService`

`IMcpOverviewService.GetOverviewAsync(string? siteUrl)` returns `McpOverview`. It uses `IMcpCapabilitiesService`, `IMcpToolSettingsStore` (catalogue), `IMcpApiUserProvider`, the detectors' `SectionAlias`, configuration (client id) and `IMcpJsonFile` (availability). The finding rules and their wording live here, in a static `BuildFindings(…)` that tests call directly; the health checks no longer have their own wording.

Each input is read in its own try/catch. A failure is logged as a warning and becomes an `info` finding in its area ("Could not read the API users the MCP server connected as: see the log."), and the rest of the overview is still returned.

### 3.2 Payload (camelCase)

```json
{
  "addonVersion": "17.0.0-alpha.2",
  "findings": [
    { "severity": "warning", "area": "server", "message": "…" }
  ],
  "products": [
    { "id": "forms", "displayName": "Umbraco Forms", "installed": true, "enabled": true, "version": "17.6.1",
      "issues": [], "loaded": true, "toolCount": 117 }
  ],
  "server": { "version": "17.0.0-alpha.1", "reportedAt": "2026-10-12T08:46:00Z", "matchesAddon": false },
  "apiUsers": [
    { "key": "…guid…", "name": "MCP API User", "clientIds": ["umbraco-back-office-mcp"], "state": "active",
      "lastConnected": "2026-10-12T01:21:00Z", "reachable": ["Umbraco Forms"], "unreachable": [] }
  ],
  "clients": [
    { "id": "claude-code", "label": "Claude Code", "fileName": ".mcp.json", "format": "json", "content": "…" }
  ],
  "mcpJson": { "available": true, "path": "C:\\…\\demo-site\\.mcp.json" }
}
```

- `server` is null until an MCP server has reported. `reportedAt` is the latest `ReportedAt` over the catalogue's modules.
- `state` is `active`, `disabled` or `lockedOut` (other Umbraco user states map to `active`, as the health check treats them today).
- `mcpJson.path` is null when `available` is false.

### 3.3 Findings

| Area | Severity | When |
|---|---|---|
| `products` | warning | An installed product whose API is not available, or any product with `issues` (the current "MCP products" warning text). |
| `server` | info | No MCP server has reported yet. |
| `server` | warning | The reported umbrella-mcp version differs from the add-on (current "MCP client setup" text). |
| `apiUsers` | info | No API user has connected yet (current "MCP API user" text). |
| `apiUsers` | warning | An API user is disabled or locked out. |
| `apiUsers` | warning | An API user's groups lack the section of an installed and enabled product. |
| any | info | Reading that area's data failed (3.1). |

Order: warnings first, then info; within a severity, `products`, `server`, `apiUsers`.

### 3.4 `McpApiUser`

Gains `Guid Key`, set by `ConnectedMcpApiUserProvider` from `IUser.Key`.

### 3.5 Endpoints

On the existing `mcp` route (`VersionedApiBackOfficeRoute("mcp")`, `ApiVersion("1.0")`, group `MCP`), each with `[Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]` like `tool-settings`, in a new `McpOverviewController`:

- `GET /mcp/overview` → 200 `McpOverview`. The site URL is built from the request as the "MCP client setup" check does today.
- `DELETE /mcp/connections/{userKey:guid}` → 204, or 404 when there is no record. `IMcpConnectionStore` gains `bool Remove(Guid userKey)`; the key/value store sets the row `Umbraco.Mcp.Connection.<key>` to an empty value and returns false when the row has no valid date. `IKeyValueService` in Umbraco 17.0.0 has no delete (only `GetValue`, `FindByKeyPrefix`, `SetValue`, `TrySetValue`), and `GetAll` already skips values that are not a date, so a blanked row reads as no connection. The row stays in the table; the next connection overwrites it.
- `POST /mcp/mcp-json` → 200 `{ "outcome": "<outcome>", "path": "…" }`; 404 when `mcpJson` is not available; a problem response (500 with the reason) on an IO failure.

## 4. Client snippets

`McpClientSnippets.Build(string siteUrl, string clientId, string addonVersion)` in `src/Umbraco.Mcp/Client/`, next to `McpClientConfig`. Every snippet starts `npx -y umbrella-mcp@<addonVersion>` and sets `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID` and `UMBRACO_CLIENT_SECRET`; `NODE_TLS_REJECT_UNAUTHORIZED=0` is added only when the site URL is loopback, the writer's rule. The site URL falls back to `https://your-site` when the request has no host.

| id | label | fileName | How the secret is supplied |
|---|---|---|---|
| `claude-code` | Claude Code | `.mcp.json` | `${UMBRELLA_CLIENT_SECRET}`, exactly what `McpJsonWriter.BuildJson` writes (Claude Code expands `${VAR}` in `env`). |
| `claude-code-cli` | Claude Code (command) | null, format `shell` | `claude mcp add --transport stdio --env UMBRACO_BASE_URL=… --env UMBRACO_CLIENT_ID=… --env UMBRACO_CLIENT_SECRET=YOUR_CLIENT_SECRET umbraco -- npx -y umbrella-mcp@<v>`. Default (local) scope, which is private to the user. The placeholder has no `<` `>`, which shells treat as redirects. |
| `vscode` | VS Code | `.vscode/mcp.json` | A `promptString` input with `"password": true`, id `umbrella-client-secret`, referenced as `${input:umbrella-client-secret}`. Top-level `servers`, entry `"type": "stdio"`. VS Code asks once and stores it securely. |
| `cursor` | Cursor | `.cursor/mcp.json` | `${env:UMBRELLA_CLIENT_SECRET}` in `mcpServers.umbraco.env`. |
| `other` | Other clients | null, format `json` | The plain `mcpServers` JSON with the placeholder `<the client secret you saved when creating the API user>`, as the health check shows today (for Claude Desktop and clients without variable expansion). |

Formats checked 12-10-2026 against code.claude.com/docs/en/mcp and code.visualstudio.com/docs/agents/reference/mcp-configuration. Cursor's `${env:NAME}` comes from cursor.com/docs/mcp as indexed by search; the plan opens the page to confirm it before writing that snippet. The server key is `McpClientConfig.ServerName` (`umbraco`) in every format. JSON is written with `Utf8JsonWriter` and `UnsafeRelaxedJsonEscaping`, as `McpClientConfig.Build` does; `McpClientConfig.Build` is reused for `claude-code`, `cursor` and `other`.

## 5. `.mcp.json` on demand

The file logic moves from `McpJsonWriter` to a new `McpJsonFile : IMcpJsonFile` (singleton), with the same rules:

- `bool IsAvailable` and `string? Path`: Development and `Umbraco:Mcp:McpJson:Enabled`, path from `Umbraco:Mcp:McpJson:Path` or the content root.
- `McpJsonResult WriteOrUpgrade()` picks the first HTTPS server address (`IServer` + `IServerAddressesFeature`, as now) and returns one outcome:

| Outcome | Dashboard sentence |
|---|---|
| `written` | Wrote `<path>`. Set UMBRELLA_CLIENT_SECRET and open your AI tool in that folder. |
| `upgraded` | Upgraded `<path>` to umbrella-mcp `<version>`. Restart the MCP server in your AI tool. |
| `upToDate` | `<path>` is already up to date. |
| `notTouched` | `<path>` was edited or pins a newer version, so it was left as it is. |
| `noHttpsAddress` | The site has no HTTPS address, which the MCP server needs, so nothing was written. |
| `folderMissing` | The folder `<folder>` does not exist, so nothing was written. |

`upToDate` means the file is byte-for-byte what it would write for the add-on's version. `McpJsonWriter` stays the hosted service: on `ApplicationStarted` it calls `WriteOrUpgrade()` and logs the outcome as today. The internal static helpers (`PickSiteUrl`, `BuildJson`, `TryWrite`, `TryUpgrade`) move with the logic, and their tests move unchanged.

## 6. Health checks

Same three checks, names, GUIDs, group and descriptions (the "MCP client setup" description drops "Shows the configuration to paste…" and says it checks the MCP server's version and points to the dashboard for setup).

- Each check calls `IMcpOverviewService` and renders the findings of its area: `MCP products` → `products`, `MCP client setup` → `server`, `MCP API user` → `apiUsers`. Warnings become Warning rows and info findings become Info rows. With no warning and no info finding in the area, one Success row: products "All installed products are available to the MCP server: Umbraco CMS 17.7.0, …"; server "The MCP server last started as umbrella-mcp X on … UTC, the same version as the add-on."; API users one row per user as today ("last connected … and can reach …").
- "MCP products" folds products that are not installed into one Info row.
- Each check ends with an Info row: "Details and setup for AI tools: Settings → Umbrella." (plain text: health check messages cannot rely on backoffice routes as links).
- Every value in a message is HTML-encoded (`WebUtility.HtmlEncode`), because the backoffice renders health check messages as HTML. Today the API user check inserts the user name unencoded; this fixes that.
- `ExecuteAction` still throws: actions live on the dashboard.

## 7. Dashboard code

`src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/`:

- `umbrella-dashboard.js`: the shell element (`umbrella-dashboard`, same manifest entry) with a `uui-tab-group` and the selected tab.
- `umbrella-overview.js`: the Overview element; loads `GET /mcp/overview`, runs Copy, Write .mcp.json and Forget.
- `umbrella-tool-groups.js`: today's element moved unchanged apart from its tag name.
- The `#request` helper moves to `umbrella-api.js`, shared by both.

No build step, as now. After Forget or Write .mcp.json the Overview reloads.

## 8. Errors

- Overview load failure: the error in a box, as the tool groups tab does.
- Action failure: a danger notification with the problem `detail`.
- Partial data failure: info findings (3.1), never a failed request.

## 9. Testing

NUnit with the existing fakes (`Fakes.cs`), plus new fakes for `IMcpApiUserProvider`, `IMcpConnectionStore` and `IMcpJsonFile` where missing:

- `BuildFindings`: each row of 3.3, ordering, and each partial failure.
- `McpClientSnippets`: each client's exact output for a loopback and a non-loopback site, that no snippet contains a real secret, and that the `claude-code` content equals `McpJsonWriter.BuildJson` for the same inputs.
- `McpJsonFile`: every outcome on a temporary folder. The current `McpJsonWriter` tests move here unchanged.
- `KeyValueMcpConnectionStore.Remove`: an existing and a missing key.
- The three health checks: rendering from findings, the success rows, the trailing dashboard row, HTML encoding.
- `scripts/e2e.sh`: `GET /mcp/overview` as the admin returns `addonVersion` and five `clients`.
- The dashboard has no JS tests; check it by hand on the demo site (both tabs, Copy, Forget with confirm, Write .mcp.json outcomes, a site with no connection yet).

## 10. Docs

- `README.md`: the setup steps and troubleshooting point to Settings → Umbrella → Overview; remove the known limitation about VS Code `${VAR}` expansion (the VS Code snippet now uses its documented `inputs`).
- `src/Umbraco.Mcp/README.md`: the dashboard has Overview and Tool groups.
- `docs/architecture.md` and `CLAUDE.md`: `McpOverviewService`, the three endpoints, `McpClientSnippets`, `McpJsonFile`, health checks rendering shared findings.
