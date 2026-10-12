import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CAPTURE_RAW_HTTP_RESPONSE,
  SERVER_INFORMATION_PATH,
  UmbracoManagementClient,
  checkUmbracoVersion,
  configureVersionCheckHook,
  createCollectionConfigLoader,
  getVersionCheckMessage,
  initializeUmbracoFetch,
  useDraft202012ToolSchemas,
  type HttpResponse,
} from "@umbraco-cms/mcp-server-sdk";
import { fetchCapabilities, siteDisabledCollections, siteReadOnly } from "./capabilities.js";
import { buildCatalogue, reportCatalogue, type CatalogueReportResult } from "./catalogue.js";
import { installClientContext } from "./client-context.js";
import { buildEffectiveFilterInput } from "./filter-config.js";
import { HEALTH_TOOL_NAME, registerHealthTool, type HealthState, type ModuleRuntimeState } from "./health.js";
import type { LoadedModule, McpProductModule } from "./module-contract.js";
import { parseForcedModules, selectModules } from "./module-selection.js";
import { buildRoutingInstructions, buildToolNameIndex } from "./routing.js";
import { checkPackageInstalled, checkSingleSdk } from "./sdk-instance.js";
import { DuplicateToolNameError, listToolNames, registerModuleTools, type RegistrationContext } from "./tool-registrar.js";

const EXPECTED_UMBRACO_MAJOR = "17";

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    console.error(`Error: ${name} is required.`);
    process.exit(1);
  }
  return value;
}

export async function startServer(options: {
  modules: McpProductModule[];
  env: NodeJS.ProcessEnv;
  version: string;
}): Promise<{ server: McpServer; toolNames: string[] }> {
  const { env, version } = options;
  initializeUmbracoFetch({
    baseUrl: requireEnv(env, "UMBRACO_BASE_URL"),
    clientId: requireEnv(env, "UMBRACO_CLIENT_ID"),
    clientSecret: requireEnv(env, "UMBRACO_CLIENT_SECRET"),
  });

  const cms = options.modules.find((m) => m.required);
  if (!cms) throw new Error("No required (CMS) module configured.");
  const cmsLoaded = await cms.load();
  installClientContext(cmsLoaded.createApiClient);

  // First call doubles as the credentials check and supplies the user for collection.tools(user).
  let user: unknown;
  try {
    user = await (cmsLoaded.createApiClient() as { getUserCurrent(): Promise<unknown> }).getUserCurrent();
  } catch (error) {
    console.error("Could not authenticate against Umbraco. Check UMBRACO_BASE_URL, UMBRACO_CLIENT_ID and UMBRACO_CLIENT_SECRET.", error);
    process.exit(1);
  }

  const info = (await UmbracoManagementClient<unknown>(
    { url: SERVER_INFORMATION_PATH, method: "GET" },
    CAPTURE_RAW_HTTP_RESPONSE,
  )) as unknown as HttpResponse<{ version?: string }>;
  const umbracoVersion = info.data?.version ?? null;
  await checkUmbracoVersion({
    mcpVersion: version,
    expectedUmbracoMajor: EXPECTED_UMBRACO_MAJOR,
    client: {
      getServerInformation: async () => {
        if (!umbracoVersion) throw new Error("Server information returned no version.");
        return { version: umbracoVersion };
      },
    },
  });
  configureVersionCheckHook();
  const versionCheckMessage = getVersionCheckMessage();

  const capabilities = await fetchCapabilities();
  const forcedModules = parseForcedModules(env.UMBRACO_MCP_MODULES);
  const decisions = selectModules(options.modules, capabilities, forcedModules);

  // Phase 1: load the selected modules. Server instructions are fixed at construction,
  // so we need to know which modules loaded before creating the server.
  const states: ModuleRuntimeState[] = [];
  const ready: Array<{ state: ModuleRuntimeState; loaded: LoadedModule }> = [];
  for (const decision of decisions) {
    const state: ModuleRuntimeState = { decision, loaded: false, toolCount: 0, issues: [] };
    states.push(state);
    if (!decision.load) continue;
    if (decision.module.required) {
      ready.push({ state, loaded: cmsLoaded });
      continue;
    }
    try {
      const missing = checkPackageInstalled(decision.module.packageName, decision.module.displayName);
      if (missing) {
        state.issues.push(missing);
        continue;
      }
      const sdkIssue = checkSingleSdk(decision.module.packageName);
      if (sdkIssue) {
        state.issues.push(sdkIssue);
        continue;
      }
      ready.push({ state, loaded: await decision.module.load() });
    } catch (error) {
      state.issues.push(`Failed to load: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const server = new McpServer(
    { name: "Umbrella MCP", version },
    { instructions: buildRoutingInstructions(ready.map((r) => r.state.decision.module), [versionCheckMessage]) },
  );

  // Phase 2: register each loaded module's tools.
  const ctx: RegistrationContext = {
    server,
    user,
    registered: new Map([[HEALTH_TOOL_NAME, "core"]]),
    toolNames: buildToolNameIndex(ready.flatMap(({ state, loaded }) => {
      // A module whose tools can't be listed reports that when it registers below.
      try {
        return [{ module: state.decision.module, toolNames: listToolNames(loaded, user) }];
      } catch {
        return [];
      }
    })),
  };
  for (const { state, loaded } of ready) {
    const { module } = state.decision;
    try {
      state.siteDisabledCollections = siteDisabledCollections(capabilities, module.id);
      state.siteReadOnly = siteReadOnly(capabilities, module.id);
      const { config, siteSettingsIgnored } = buildEffectiveFilterInput(
        env, module.id, module.required === true, state.siteDisabledCollections, state.siteReadOnly,
      );
      state.siteSettingsIgnored = siteSettingsIgnored;
      const filter = createCollectionConfigLoader({
        modeRegistry: loaded.allModes,
        allModeNames: loaded.allModeNames,
        allSliceNames: loaded.allSliceNames,
      }).loadFromConfig(config);
      state.toolCount = registerModuleTools(ctx, module, loaded, filter);
      state.loaded = true;
    } catch (error) {
      if (error instanceof DuplicateToolNameError || module.required) throw error;
      state.issues.push(`Failed to register tools: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Tell the site which tool groups exist, for the backoffice "Umbrella" dashboard. Without the add-on there is nowhere to send it.
  let catalogueReport: CatalogueReportResult | undefined;
  if (capabilities.kind === "ok") {
    catalogueReport = await reportCatalogue(buildCatalogue(
      version,
      ready.map(({ state, loaded }) => ({ module: state.decision.module, loaded, siteSettingsIgnored: state.siteSettingsIgnored ?? false })),
      user,
    ));
  }

  const healthState: HealthState = { capabilities, umbracoVersion, versionCheckMessage, forcedModules, modules: states, catalogueReport };
  registerHealthTool(server, () => healthState);

  // Must run after every registerTool call.
  useDraft202012ToolSchemas(server);

  return { server, toolNames: [...ctx.registered.keys()].sort() };
}
