# Dashboard Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings → Umbrella opens on an Overview (status findings, per-client setup snippets, products, MCP server and API users, Forget, Write .mcp.json), and the three MCP health checks render the same findings as short rows.

**Architecture:** A new `McpOverviewService` builds one structured `McpOverview`, with all finding wording in a static `BuildFindings`. A new `McpOverviewController` serves it and the two actions. The `.mcp.json` logic moves from the hosted `McpJsonWriter` into an `McpJsonFile` service that returns an outcome. Snippets come from a new `McpClientSnippets`. The health checks become thin renderers of the overview's findings. The dashboard splits into a tab shell, the existing tool groups element and a new overview element.

**Tech Stack:** .NET 10, Umbraco 17.0.0 Management API, NUnit 3 with hand-written fakes, Lit + UUI (backoffice, no build step).

**Spec:** `docs/superpowers/specs/2026-10-12-dashboard-overview-design.md`

## Global Constraints

- Compile against `Umbraco.Cms.Api.Management` 17.0.0; no new package references, no dependency upgrades.
- No product dependencies; npm (`npm/`) is not touched.
- Health check names, GUIDs and group `MCP` stay as they are.
- New endpoints sit on `[VersionedApiBackOfficeRoute("mcp")]`, `[ApiVersion("1.0")]`, `[ApiExplorerSettings(GroupName = "MCP")]`, class-level `[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess)]`, each action `[Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]`.
- JSON payloads are camelCase; enum-like values are strings (`"warning"`, `"info"`, `"active"`, `"lockedOut"`, …).
- No snippet, file or response ever contains a client secret.
- Dates shown to people: DD-MM-YYYY HH:mm (UTC in health checks, browser time in the dashboard).
- Every value in a health check message is HTML-encoded.
- `.mcp.json` rules unchanged: never overwrite an edited file, never create folders, only upgrade to a newer version, secret as `${UMBRELLA_CLIENT_SECRET}`.
- Stage files explicitly; never commit `demo-site/appsettings*.json` changes, `artifacts/`, or other untracked demo files.
- `POST /mcp/mcp-json` returns `{ outcome, path, message }`: the spec's `{ outcome, path }` plus the outcome sentence, so the dashboard and the startup log share one wording.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A user name containing HTML** (`<b>x</b>`) shows as text in the health check and dashboard, never as markup. Test: Task 6 `Values_in_messages_are_html_encoded`.
2. **Forget for a user that reconnects**: the row returns with the new time, since the blanked row is overwritten. Test: Task 1 `Record_after_remove_brings_the_connection_back`.
3. **The site behind a host with no request (health check run by the scheduler)**: the overview is built with a null site URL and the snippets use `https://your-site`; nothing throws. Test: Task 3 `Unknown_site_url_falls_back_to_a_placeholder` and Task 4 `Overview_without_a_site_url_still_builds`.
4. **A `.mcp.json` written for the demo site's `Command`/`Args` overrides**: Write .mcp.json reports `upToDate`, not `notTouched`, because `McpJsonFile` builds with the same options as the startup writer. Test: Task 2 `Overridden_command_file_is_up_to_date`.
5. **The catalogue read throws** (corrupt row or DB hiccup): the overview still returns products and users with one info finding. Test: Task 4 `Catalogue_failure_is_an_info_finding_and_the_rest_still_builds`.

---

### Task 1: Connection removal and the API user's key

**Files:**
- Modify: `src/Umbraco.Mcp/Connections/IMcpConnectionStore.cs`, `src/Umbraco.Mcp/Connections/KeyValueMcpConnectionStore.cs`
- Modify: `src/Umbraco.Mcp/ApiUser/McpApiUser.cs`, `src/Umbraco.Mcp/ApiUser/ConnectedMcpApiUserProvider.cs`
- Modify: `tests/Umbraco.Mcp.Tests/Fakes.cs` (`FakeConnectionStore.Remove`), `tests/Umbraco.Mcp.Tests/McpApiUserHealthCheckTests.cs` (constructor call sites only)
- Test: `tests/Umbraco.Mcp.Tests/KeyValueMcpConnectionStoreTests.cs`, `tests/Umbraco.Mcp.Tests/ConnectedMcpApiUserProviderTests.cs`

**Interfaces:**
- Produces: `bool IMcpConnectionStore.Remove(Guid userKey)`, true when a connection with a valid date existed. `McpApiUser(Guid Key, string Name, UserState State, IReadOnlyCollection<string> AllowedSections, IReadOnlyCollection<string> ClientIds, DateTimeOffset LastConnected)` (`Key` is the new first parameter).

- [ ] **Step 1: Write the failing tests** in `KeyValueMcpConnectionStoreTests`:
  - `Remove_blanks_the_row_and_hides_the_connection`: record a key, `Remove(key)` returns true, `GetAll()` is empty, `FakeKeyValueService.Values["Umbraco.Mcp.Connection.<key D>"]` is `""`.
  - `Remove_of_an_unknown_or_already_removed_key_returns_false`: `Remove` on a fresh store is false; after one `Remove`, a second is false.
  - `Record_after_remove_brings_the_connection_back`: record, remove, record at a later time; `GetAll()` has that one connection with the later time.

  In `ConnectedMcpApiUserProviderTests`, extend an existing test (or add `Key_is_the_umbraco_user_key`) to assert `result[0].Key == user.Key`.
- [ ] **Step 2: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter "FullyQualifiedName~KeyValueMcpConnectionStoreTests|FullyQualifiedName~ConnectedMcpApiUserProviderTests"`. Expected: build fails (`Remove` and `Key` don't exist).
- [ ] **Step 3: Implement.** `Remove` reads the value, returns false unless it parses as a date, otherwise `SetValue(key, "")` and returns true. Add `Key` to `McpApiUser` and pass `user.Key` in the provider. `FakeConnectionStore.Remove` removes from `Recorded` and records the key in a `Removed` list. Update `McpApiUserHealthCheckTests.User(...)` and the other constructor calls with `Guid.NewGuid()`.
- [ ] **Step 4: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(addon): forget an MCP connection; API users carry their key`.

### Task 2: `McpJsonFile` with outcomes

**Files:**
- Create: `src/Umbraco.Mcp/Client/McpJsonFile.cs` (`IMcpJsonFile`, `McpJsonFile`, `McpJsonResult`, `McpJsonOutcome`)
- Modify: `src/Umbraco.Mcp/Client/McpJsonWriter.cs` (thin hosted service), `src/Umbraco.Mcp/McpComposer.cs`
- Rename/Modify test: `tests/Umbraco.Mcp.Tests/McpJsonWriterTests.cs` → `tests/Umbraco.Mcp.Tests/McpJsonFileTests.cs` (`git mv`)

**Interfaces:**
- Produces:
  - `public interface IMcpJsonFile { bool IsAvailable { get; } string? Path { get; } McpJsonResult WriteOrUpgrade(); }`
  - `public sealed record McpJsonResult(string Outcome, string Path, string Message)`
  - `public static class McpJsonOutcome { Written = "written", Upgraded = "upgraded", UpToDate = "upToDate", NotTouched = "notTouched", NoHttpsAddress = "noHttpsAddress", FolderMissing = "folderMissing" }`
  - `public sealed class McpJsonFile(IHostEnvironment environment, IServer server, IConfiguration configuration) : IMcpJsonFile`, registered as a singleton
  - `internal static McpJsonResult McpJsonFile.WriteOrUpgrade(string directory, string? siteUrl, Func<string, string> buildForVersion, string addonVersion)`, the testable core
  - `PickSiteUrl`, `BuildJson`, `TryWrite`, `TryUpgrade`, `ShouldWrite`, `FileName` move to `McpJsonFile` with unchanged signatures
- `IsAvailable` is `ShouldWrite(environment.IsDevelopment(), options)`. `Path` is `<GetFullPath(options.Path ?? ".", ContentRootPath)>/.mcp.json` when available, else null. The options are read from `McpJsonOptions.Section` on each call.
- Messages (the spec's section 5 sentences, with values filled in):
  - written: `Wrote {path}. Set UMBRELLA_CLIENT_SECRET and open your AI tool in that folder.`
  - upgraded: `Upgraded {path} to umbrella-mcp {version}. Restart the MCP server in your AI tool.`
  - upToDate: `{path} is already up to date.`
  - notTouched: `{path} was edited or pins a newer version, so it was left as it is.`
  - noHttpsAddress: `The site has no HTTPS address, which the MCP server needs, so nothing was written.`
  - folderMissing: `The folder {directory} does not exist, so nothing was written.`

- [ ] **Step 1: Move the tests.** `git mv` the test file, rename the fixture to `McpJsonFileTests`, and point the calls at `McpJsonFile.*`. Add:
  - `Outcome_written_when_missing`
  - `Outcome_upgraded_for_an_older_pin`
  - `Outcome_up_to_date_for_the_same_content`
  - `Outcome_not_touched_for_an_edited_file`
  - `Outcome_not_touched_for_a_newer_pin`
  - `Outcome_no_https_address_when_site_url_is_null`: no file is created.
  - `Outcome_folder_missing`: the folder is still missing afterwards.
  - `Overridden_command_file_is_up_to_date`: write with `buildForVersion` built from options `Command="node"`, `Args=["../npm/dist/index.js"]`; a second call returns `upToDate`.
  - Each asserts `Outcome`, `Path`, and that `Message` contains the path (or the directory, for folderMissing).
- [ ] **Step 2: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter McpJsonFileTests`. Expected: build fails.
- [ ] **Step 3: Implement.** In order: `siteUrl` null → noHttpsAddress; `!Directory.Exists(directory)` → folderMissing; `TryWrite` → written; `TryUpgrade` → upgraded; the file's text equals `buildForVersion(addonVersion)` → upToDate; else notTouched. IO exceptions are not caught here. The instance `WriteOrUpgrade()` gets the site URL from `server.Features.Get<IServerAddressesFeature>()`. `buildForVersion` is `v => BuildJson(siteUrl, ReadClientId(configuration), v, options)`.

  `McpJsonWriter` becomes `McpJsonWriter(IMcpJsonFile file, IHostApplicationLifetime lifetime, ILogger<McpJsonWriter> logger)`. On `ApplicationStarted`, when `file.IsAvailable`, it calls `WriteOrUpgrade()` and logs:
  - written: the existing info message
  - upgraded: the existing info message, with `from` replaced by `result.Message`
  - noHttpsAddress: the existing info message
  - other outcomes: nothing
  - any exception: the existing warning

  Register `builder.Services.AddSingleton<IMcpJsonFile, McpJsonFile>();` before the hosted service.
- [ ] **Step 4: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`. Expected: all pass, including the moved tests unchanged in substance.
- [ ] **Step 5: Commit** `refactor(addon): move .mcp.json writing into McpJsonFile with outcomes`.

### Task 3: Client snippets

**Files:**
- Create: `src/Umbraco.Mcp/Client/McpClientSnippets.cs`
- Test: `tests/Umbraco.Mcp.Tests/McpClientSnippetsTests.cs`

**Interfaces:**
- Consumes: `McpClientConfig.Build`, `NpxArgs`, `ServerName`, `SecretEnvironmentVariable`, `McpJsonFile.BuildJson(string siteUrl, string clientId, string addonVersion, McpJsonOptions options)` (Task 2).
- Produces: `public sealed record McpClientSnippet(string Id, string Label, string? FileName, string Format, string Content)`; `internal static IReadOnlyList<McpClientSnippet> McpClientSnippets.Build(string? siteUrl, string clientId, string addonVersion)`; `internal const string SiteUrlPlaceholder = "https://your-site"`; `internal const string SecretPlaceholder = "<the client secret you saved when creating the API user>"`; `internal const string CliSecretPlaceholder = "YOUR_CLIENT_SECRET"`.

- [ ] **Step 1: Confirm Cursor's format.** Open https://cursor.com/docs/mcp (WebFetch). Confirm the project file is `.cursor/mcp.json`, the top-level key is `mcpServers`, and `env` values support `${env:NAME}`. If any of that differs, stop and report it to the user before writing the `cursor` snippet.
- [ ] **Step 2: Write the failing tests.** Use `site = "https://localhost:44399"`, `remote = "https://example.com"`, `clientId = "umbraco-back-office-mcp"`, `version = "17.0.0-alpha.2"`.
  - `Five_clients_in_order`: ids are `claude-code, claude-code-cli, vscode, cursor, other`; labels `Claude Code, Claude Code (command), VS Code, Cursor, Other clients`; file names `.mcp.json, null, .vscode/mcp.json, .cursor/mcp.json, null`; formats `json, shell, json, json, json`.
  - `Claude_code_is_exactly_what_the_writer_writes`: content equals `BuildJson(site, clientId, version, new McpJsonOptions())`.
  - `Cli_command_adds_a_local_stdio_server_with_npx`: content equals
    `claude mcp add --transport stdio --env UMBRACO_BASE_URL=https://localhost:44399 --env UMBRACO_CLIENT_ID=umbraco-back-office-mcp --env UMBRACO_CLIENT_SECRET=YOUR_CLIENT_SECRET --env NODE_TLS_REJECT_UNAUTHORIZED=0 umbraco -- npx -y umbrella-mcp@17.0.0-alpha.2`, and for `remote` the same without the `NODE_TLS` pair. It contains no `--scope`, `<` or `>`.
  - `Vscode_prompts_for_the_secret`: parse the JSON. `inputs[0]` is `{type:"promptString", id:"umbrella-client-secret", description:"Client secret of the Umbraco MCP API user", password:true}`. `servers.umbraco.type == "stdio"`, `command == "npx"`, `args == ["-y","umbrella-mcp@17.0.0-alpha.2"]`, `env.UMBRACO_CLIENT_SECRET == "${input:umbrella-client-secret}"`.
  - `Cursor_reads_the_secret_from_the_environment`: `mcpServers.umbraco.env.UMBRACO_CLIENT_SECRET == "${env:UMBRELLA_CLIENT_SECRET}"`.
  - `Other_uses_the_placeholder`: `mcpServers.umbraco.env.UMBRACO_CLIENT_SECRET == SecretPlaceholder`.
  - `Loopback_sites_skip_certificate_checks_in_every_client`: for `site`, every content contains `NODE_TLS_REJECT_UNAUTHORIZED`; for `remote`, none does.
  - `Unknown_site_url_falls_back_to_a_placeholder`: `Build(null, …)` puts `https://your-site` as `UMBRACO_BASE_URL` in all five, with no `NODE_TLS`.
  - `Values_are_json_escaped`: a client id `a"b` gives valid JSON in the four JSON snippets with that value round-tripped.
- [ ] **Step 3: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter McpClientSnippetsTests`. Expected: build fails.
- [ ] **Step 4: Implement `McpClientSnippets.Build`.** Write the env pairs once (`UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID`, `UMBRACO_CLIENT_SECRET`, plus `NODE_TLS_REJECT_UNAUTHORIZED=0` when `new Uri(siteUrl).IsLoopback`) and vary only the secret value per client. `claude-code` calls `BuildJson`; `cursor` and `other` call `McpClientConfig.Build("npx", NpxArgs(version), env)`. Write `vscode` with `Utf8JsonWriter` and the same options as `McpClientConfig.Build` (indented, `UnsafeRelaxedJsonEscaping`), key order `inputs`, then `servers`.
- [ ] **Step 5: Run** the filter again. Expected: PASS.
- [ ] **Step 6: Commit** `feat(addon): client config snippets for Claude Code, VS Code, Cursor and others`.

### Task 4: Overview model and service

**Files:**
- Create: `src/Umbraco.Mcp/Overview/McpOverview.cs` (records), `src/Umbraco.Mcp/Overview/IMcpOverviewService.cs`, `src/Umbraco.Mcp/Overview/McpOverviewService.cs`
- Modify: `src/Umbraco.Mcp/McpComposer.cs`, `tests/Umbraco.Mcp.Tests/Fakes.cs` (`FakeApiUserProvider`, `FakeMcpJsonFile`; `FakeToolSettingsStore.GetCatalogue` throws when `Throws` is set)
- Test: `tests/Umbraco.Mcp.Tests/McpOverviewServiceTests.cs`

**Interfaces:**
- Consumes: `McpApiUser` (Task 1), `IMcpJsonFile` (Task 2), `McpClientSnippet` and `McpClientSnippets.Build` (Task 3), `IMcpCapabilitiesService`, `IMcpToolSettingsStore.GetCatalogue()`, `IEnumerable<IMcpProductDetector>` (`Id`, `SectionAlias`), `McpClientConfig.ReadClientId`.
- Produces (namespace `Umbraco.Mcp.Overview`):
  - `public sealed record McpFinding(string Severity, string Area, string Message)` with `public const string Warning = "warning", Info = "info"` and `public static class McpFindingArea { Products = "products", Server = "server", ApiUsers = "apiUsers" }`
  - `public sealed record McpOverviewProduct(string Id, string DisplayName, bool Installed, bool Enabled, string? Version, IReadOnlyList<string> Issues, bool Loaded, int ToolCount)`
  - `public sealed record McpServerReport(string Version, DateTimeOffset ReportedAt, bool MatchesAddon)`
  - `public sealed record McpOverviewApiUser(Guid Key, string Name, IReadOnlyList<string> ClientIds, string State, DateTimeOffset LastConnected, IReadOnlyList<string> Reachable, IReadOnlyList<string> Unreachable)`. `State` is `"active" | "disabled" | "lockedOut"`.
  - `public sealed record McpJsonStatus(bool Available, string? Path)`
  - `public sealed record McpOverview(string AddonVersion, IReadOnlyList<McpFinding> Findings, IReadOnlyList<McpOverviewProduct> Products, McpServerReport? Server, IReadOnlyList<McpOverviewApiUser> ApiUsers, IReadOnlyList<McpClientSnippet> Clients, McpJsonStatus McpJson)`
  - `public interface IMcpOverviewService { Task<McpOverview> GetOverviewAsync(string? siteUrl); }`
  - `public sealed class McpOverviewService(IMcpCapabilitiesService capabilities, IMcpToolSettingsStore toolSettings, IMcpApiUserProvider apiUsers, IEnumerable<IMcpProductDetector> detectors, IMcpJsonFile mcpJson, IConfiguration configuration, ILogger<McpOverviewService> logger)`, registered **scoped**
  - `internal static IReadOnlyList<McpFinding> BuildFindings(McpCapabilities? caps, McpToolCatalogue? catalogue, IReadOnlyList<McpApiUser>? users, IReadOnlyDictionary<string, string?> sectionByProduct, string addonVersion)`. A null input means reading it failed.

**Finding messages** (the existing health check wording, unencoded; `{name}` is `DisplayName` plus ` {Version}` when known):
- products warning: `{name}: {issues joined by " "}`, or `{name}: Installed, but its API is not available.`, for every product with issues or installed-but-not-enabled.
- server info (catalogue has no `UmbrellaVersion`): `The MCP server has not reported to this site yet. It reports when your AI tool starts it.`
- server warning: `The MCP server last started as umbrella-mcp {reported} on {dd-MM-yyyy HH:mm} UTC, but the add-on is {addon}. The two are released together: set umbrella-mcp@{addon} in your AI tool's MCP configuration. A .mcp.json the site wrote and nobody edited is upgraded when the site next starts in Development.` Drop ` on … UTC` when the catalogue has no modules.
- apiUsers info (no users): `No MCP server has connected to this site yet. The MCP server connects when your AI tool starts it; start it, then check again.`
- apiUsers warnings: `The API user "{Name}" ({clientIds joined ", "}) is {disabled|locked out}, so the MCP server can no longer sign in with it.` (the client id part is dropped when there are none), and `The API user "{Name}" cannot use {DisplayName} tools: none of its user groups grant the {section} section.`
- read failures (info, in their area): `Could not read the detected products. See the log.` / `Could not read what the MCP server last reported. See the log.` / `Could not read the API users the MCP server connected as. See the log.`
- Order: warnings before info; within a severity, products, server, apiUsers; within an area, input order.

**Other fields:**
- `Products` comes from caps. `Loaded` = the catalogue has the id. `ToolCount` = sum of `ToolCount` over its collections, 0 when not loaded.
- `Server` = null without `UmbrellaVersion`. Otherwise `ReportedAt` is the max module `ReportedAt` (or `DateTimeOffset.MinValue` with no modules), and `MatchesAddon` is an ordinal compare.
- `ApiUsers`: `Reachable`/`Unreachable` are the display names of installed and enabled products that have a section, the same rule as today's health check.
- `Clients = McpClientSnippets.Build(siteUrl, ReadClientId(configuration), caps.AddonVersion)`. `McpJson = new(mcpJson.IsAvailable, mcpJson.Path)`.
- Each read sits in its own try/catch that logs a warning. If capabilities fail, use `McpAddon.Version` and empty products.

- [ ] **Step 1: Write the failing tests:**
  - `No_problems_gives_no_warnings`
  - `Product_with_issues_is_a_products_warning`
  - `Installed_product_without_api_is_a_products_warning`
  - `No_report_is_a_server_info`
  - `Other_mcp_version_is_a_server_warning_with_the_version_to_run`: assert the full sentence, with time `12-10-2026 08:46`.
  - `No_users_is_an_api_users_info`
  - `Locked_out_user_is_a_warning`
  - `Missing_section_is_a_warning_naming_the_section`: `Umb.Section.Forms`.
  - `Warnings_come_before_info_in_area_order`
  - `Catalogue_failure_is_an_info_finding_and_the_rest_still_builds`: `FakeToolSettingsStore { Throws = … }`. Products and users are still filled, and one info finding exists with area `server`.
  - `Api_user_failure_is_an_info_finding`
  - `Product_tool_count_sums_the_reported_collections`
  - `Server_report_uses_the_latest_module_time`
  - `Api_user_state_and_reach`: a locked-out user maps to `"lockedOut"`, with Forms unreachable and Automate reachable.
  - `Overview_without_a_site_url_still_builds`: five clients, with `https://your-site` in each.
  - `Mcp_json_status_comes_from_the_file_service`
- [ ] **Step 2: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter McpOverviewServiceTests`. Expected: build fails.
- [ ] **Step 3: Implement** the records, the interface, the service and `BuildFindings` as specified. Register `builder.Services.AddScoped<IMcpOverviewService, McpOverviewService>();`.
- [ ] **Step 4: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(addon): McpOverviewService builds the dashboard's status, findings and snippets`.

### Task 5: Overview controller

**Files:**
- Create: `src/Umbraco.Mcp/Api/McpOverviewController.cs`
- Test: `tests/Umbraco.Mcp.Tests/McpOverviewControllerTests.cs`

**Interfaces:**
- Consumes: `IMcpOverviewService` (Task 4), `IMcpConnectionStore.Remove` (Task 1), `IMcpJsonFile` (Task 2).
- Produces: `public sealed class McpOverviewController(IMcpOverviewService overview, IMcpConnectionStore connections, IMcpJsonFile mcpJson, ILogger<McpOverviewController> logger) : ManagementApiControllerBase`, with:
  - `[HttpGet("overview")] Task<IActionResult> GetOverview()` → 200 `McpOverview`
  - `[HttpDelete("connections/{userKey:guid}")] IActionResult ForgetConnection(Guid userKey)` → 204 / 404
  - `[HttpPost("mcp-json")] IActionResult WriteMcpJson()` → 200 `McpJsonResult` / 404 / 500 problem
  - `internal static string? SiteUrlFrom(HttpRequest? request)`: `{Scheme}://{Host}{PathBase}`, or null without a host (the logic of the current `McpClientConfigHealthCheck.GetSiteUrl`)

- [ ] **Step 1: Write the failing tests**, constructing the controller directly as `McpToolSettingsControllerTests` does, with a stub overview service:
  - `Controller_requires_back_office_access_and_settings_for_every_endpoint`: check the class policy `BackOfficeAccess`, and that each of the three methods has `SectionAccessSettings`.
  - `Get_passes_the_request_site_url`: `ControllerContext` with a `DefaultHttpContext` whose request is `https://example.com/sub` (`PathBase = "/sub"`). The stub sees `"https://example.com/sub"`.
  - `Forget_known_connection_is_no_content`
  - `Forget_unknown_connection_is_not_found`
  - `Write_when_unavailable_is_not_found_and_writes_nothing`
  - `Write_returns_the_outcome`
  - `Write_io_failure_is_a_500_problem_with_the_reason`: the fake throws `IOException("disk full")`. The result is an `ObjectResult` with status 500 and a `ProblemDetails.Detail` containing `disk full`.
- [ ] **Step 2: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter McpOverviewControllerTests`. Expected: build fails.
- [ ] **Step 3: Implement** with the Global Constraints attributes plus `[MapToApiVersion("1.0")]` and `[ProducesResponseType]` per action, as in `McpToolSettingsController`. Catch `IOException` and `UnauthorizedAccessException` in `WriteMcpJson`, log a warning, and return `Problem(detail: ex.Message, statusCode: 500)`.
- [ ] **Step 4: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(addon): overview, forget-connection and write-.mcp.json endpoints`.

### Task 6: Health checks render shared findings

**Files:**
- Create: `src/Umbraco.Mcp/HealthChecks/McpHealthCheckRows.cs`
- Modify: `src/Umbraco.Mcp/HealthChecks/McpProductsHealthCheck.cs`, `McpClientConfigHealthCheck.cs`, `McpApiUserHealthCheck.cs`
- Test: rewrite `tests/Umbraco.Mcp.Tests/McpProductsHealthCheckTests.cs`, `McpClientConfigHealthCheckTests.cs` and `McpApiUserHealthCheckTests.cs` against `McpHealthCheckRows`. The finding-rule cases now live in `McpOverviewServiceTests`, so drop duplicates of them and the snippet tests (covered by `McpClientSnippetsTests`).

**Interfaces:**
- Consumes: `McpOverview`, `McpFinding`, `McpFindingArea` (Task 4).
- Produces: `internal static IReadOnlyList<HealthCheckStatus> McpHealthCheckRows.Build(McpOverview overview, string area)`; `internal const string DashboardRow = "Details and setup for AI tools: Settings → Umbrella."`. Each check's constructor becomes `(IMcpOverviewService overview)`. `GetStatusAsync` = `McpHealthCheckRows.Build(await overview.GetOverviewAsync(null), <area>)`. `ExecuteAction` still throws.

**Rows, in order:**
1. The area's findings: warning → `StatusResultType.Warning`, info → `Info`.
2. If the area has no findings, its success row(s):
   - products: `All installed products are available to the MCP server: {name version, joined ", "}.`
   - server: `The MCP server last started as umbrella-mcp {v} on {dd-MM-yyyy HH:mm} UTC, the same version as the add-on.`
   - apiUsers: per user, `The API user "{Name}" ({clientIds}) last connected {dd-MM-yyyy HH:mm} UTC and can reach {Reachable joined ", "}.`, without the ` and can reach …` part when empty.
3. With findings in the apiUsers area: a success row for each user that is `active` with no `Unreachable`.
4. Products only: when any product is not installed, `Not installed: {DisplayNames joined ", "}.` as Info.
5. Always last: `DashboardRow` as Info.

Every message is passed through `WebUtility.HtmlEncode` once, at this point.

Update descriptions:
- "MCP client setup": `Checks that the MCP server the AI tool last started is the add-on's version. Setup for AI tools is in Settings → Umbrella.`
- the other two: unchanged.

- [ ] **Step 1: Write the failing tests:**
  - Products: `All_available_is_one_success_row_then_the_dashboard_row`, `Not_installed_products_fold_into_one_info_row`, `Product_warning_rows_replace_the_success_row`.
  - Server: `Matching_version_is_a_success_row`, `Mismatch_is_a_warning_row`, `No_report_is_an_info_row`.
  - API users: `Each_healthy_user_is_a_success_row`, `Warnings_and_healthy_users_both_show`, `No_users_is_one_info_row`.
  - `Every_check_ends_with_the_dashboard_row`
  - `Values_in_messages_are_html_encoded`: a user named `<b>x</b>` → the message contains `&lt;b&gt;x&lt;/b&gt;`.
  - `Health_check_identities_are_unchanged`: check each class's `HealthCheckAttribute` id (`6f1d2c3a-8b47-4e2a-9c51-3d7e0b9a4f12`, `0c7e5a91-2d4b-4f63-8e1a-9b5d3c7f2e48`, `b3a9e0d4-5c2f-4f8e-a6d1-7e4b2c9f0a35`), name and group `MCP`.
- [ ] **Step 2: Run** `dotnet test tests/Umbraco.Mcp.Tests/Umbraco.Mcp.Tests.csproj --filter "FullyQualifiedName~HealthCheckTests"`. Expected: build fails.
- [ ] **Step 3: Implement** `McpHealthCheckRows` and reduce the three checks to it. Delete `McpClientConfigHealthCheck.SecretPlaceholder`/`SiteUrlPlaceholder`, now in `McpClientSnippets`, and `GetSiteUrl`/`SafeCatalogue`/`BuildVersionStatus`, now in the service and controller.
- [ ] **Step 4: Run** `dotnet test Umbraco.Mcp.slnx`. Stop the demo site first if it is running, or run the `.csproj`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(addon): MCP health checks show the overview's findings and point to the dashboard`.

### Task 7: Dashboard Overview tab

**Files:**
- Create: `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-api.js`, `umbrella-tool-groups.js`, `umbrella-overview.js`
- Modify: `src/Umbraco.Mcp/wwwroot/App_Plugins/Umbrella/umbrella-dashboard.js` (becomes the shell; same element name `umbrella-dashboard`, same manifest)

**Interfaces:**
- Consumes: `GET /mcp/overview`, `DELETE /mcp/connections/{key}`, `POST /mcp/mcp-json` (Task 5); payload shape from Task 4; `McpJsonResult.message`.
- Produces: `export async function request(host, auth, method, path, body)` in `umbrella-api.js`. It takes the path after `/umbraco/management/api/v1/mcp/` and returns parsed JSON, or null for 204. On failure it throws `Error(problem.detail ?? "HTTP <status>")`. It also exports `formatDate(iso)`.
- Elements:
  - `umbrella-tool-groups`: today's class, moved, using `request`.
  - `umbrella-overview`
  - `umbrella-dashboard`: a `uui-tab-group` with `Overview` and `Tool groups`, rendering one or the other.

**Overview rendering (spec section 2):**
- **Status:** a `uui-box` with headline `Everything is connected` when there are no warnings, otherwise `{n} thing(s) need attention`. Below it, a list with an icon per finding: `icon-alert` for warnings, `icon-info` for info.
- **Connect an AI tool:** a `uui-box` with a `<details>`, open when `apiUsers.length === 0 || server === null || findings.some(f => f.severity === "warning" && f.area !== "products")`.
  - Inside, a `uui-tab-group` over `clients`. Each tab shows `fileName` (or `Run in a terminal` for `format === "shell"`), a `<pre>`, and a `Copy` button. Copy uses `navigator.clipboard.writeText`, peeks positive `Copied`, and on failure peeks danger `Could not copy. Select the text and copy it by hand.`
  - When `mcpJson.available`: a `Write .mcp.json` button and, after the call, the returned `message`. Then reload.
- **Products:** a `uui-table` over installed products with name, version, API (`Available`/`Not available`), MCP server (`Loaded`/`Not loaded`) and tools. Then a muted `Not installed: …` line when any product is not installed.
- **MCP server and API users:**
  - The server line from the spec, with class `warning` when `!matchesAddon`, or `No MCP server has started yet.`
  - Per user: name, client ids, `Last connected {formatDate}`, state, `Can reach …` / `Cannot reach …`, and a `Forget` button. The button opens `umbOpenModal(this, UMB_CONFIRM_MODAL, { data: { headline: "Forget MCP connection?", content: "This does not delete the API user. It appears here again if it connects again.", confirmLabel: "Forget", color: "danger" } })` (from `@umbraco-cms/backoffice/modal`). After confirming, it sends `DELETE` and reloads. Check that `umbOpenModal` exists in 17.0.0's backoffice; if not, use `UMB_MODAL_MANAGER_CONTEXT` `.open(this, UMB_CONFIRM_MODAL, …).onSubmit()`.
- A load error is shown in a box, as the tool groups tab does it. Failed actions peek danger with the error message.

- [ ] **Step 1: Split without behaviour change.** Move the request helper and `formatDate` to `umbrella-api.js`, move today's class to `umbrella-tool-groups.js`, and make `umbrella-dashboard.js` the tab shell with only the Tool groups tab wired. On the demo site (`preview_start` `demo-site`, sign in with the demo admin), Settings → Umbrella → Tool groups works as before: toggle one group, Save, reload, still saved.
- [ ] **Step 2: Build `umbrella-overview.js`** as above, and make Overview the default tab.
- [ ] **Step 3: Verify by hand on the demo site** (rebuild and restart it):
  - The Overview loads with the four boxes.
  - Copy on each of the five tabs puts the content on the clipboard. Check one with `navigator.clipboard.readText()` via the browser tool.
  - Write .mcp.json shows `… is already up to date.` (the demo writes its own on start). After deleting `demo-site/.mcp.json`, it shows `Wrote …` and the file exists again. The file is gitignored.
  - Forget on the `-doctor` user asks first, then the row is gone, and the health check no longer lists it.
  - The browser console shows no errors.
  - Take a screenshot of the Overview for the PR.
- [ ] **Step 4: Commit** `feat(dashboard): Overview tab with status, client setup, products and API users`.

### Task 8: End-to-end check and docs

**Files:**
- Modify: `scripts/e2e.sh`, `README.md`, `src/Umbraco.Mcp/README.md`, `docs/architecture.md`, `CLAUDE.md`

- [ ] **Step 1: Extend `scripts/e2e.sh`.** After the tool-settings checks, fetch `OVERVIEW=$(curl -sfk -H "Authorization: Bearer $TOKEN" "$API/overview") || fail "GET overview failed"`. Check with node that `addonVersion` is a non-empty string, `clients.length === 5`, and that no client content contains the value of `$UMBRACO_CLIENT_SECRET`. Use here-strings for any grep, as the script does.
- [ ] **Step 2: Run** with the demo site up, `npm/.env` set and `npm/dist` built: `scripts/e2e.sh`. Expected: it ends without `FAIL:`.
- [ ] **Step 3: Docs.**
  - `README.md`: the setup and troubleshooting sections point to Settings → Umbrella → Overview for config snippets and status. Remove the VS Code `${VAR}` line from Known limitations.
  - `src/Umbraco.Mcp/README.md`: the dashboard has Overview and Tool groups.
  - `docs/architecture.md` and `CLAUDE.md`: under the add-on, add `McpOverviewService` (findings shared with the health checks), the three endpoints, `McpClientSnippets`, and `McpJsonFile` (used by `McpJsonWriter` and `POST /mcp/mcp-json`). In `CLAUDE.md`'s "Client config" bullets, replace the description of `McpJsonWriter`'s write logic with `McpJsonFile`.
- [ ] **Step 4: Run** `bash scripts/check-guards.sh` and `dotnet test Umbraco.Mcp.slnx`. Expected: both pass.
- [ ] **Step 5: Commit** `test(e2e)+docs: dashboard overview`.
