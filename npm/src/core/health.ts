import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createToolResult } from "@umbraco-cms/mcp-server-sdk";
import type { CapabilitiesResult } from "./capabilities.js";
import type { CatalogueReportResult } from "./catalogue.js";
import type { ModuleDecision } from "./module-selection.js";

import { HEALTH_TOOL_NAME } from "./routing.js";

export { HEALTH_TOOL_NAME };

export interface ModuleRuntimeState {
  decision: ModuleDecision;
  loaded: boolean;
  toolCount: number;
  issues: string[];
  /** Collections the site disabled for this module (from capabilities). */
  siteDisabledCollections?: string[];
  /** The module's default-off collections that were applied, because neither the site nor the env set a list. */
  defaultDisabledCollections?: string[];
  /** The environment sets collection filters for this module, so the site's list was not applied. */
  siteSettingsIgnored?: boolean;
  /** The site limits this module to read-only tools (from capabilities). */
  siteReadOnly?: boolean;
}

export interface HealthState {
  capabilities: CapabilitiesResult;
  /** The running umbrella-mcp's version. */
  serverVersion: string;
  umbracoVersion: string | null;
  versionCheckMessage: string | null;
  forcedModules: string[];
  modules: ModuleRuntimeState[];
  /** Absent when the catalogue was not reported (no add-on). */
  catalogueReport?: CatalogueReportResult;
}

export interface HealthProduct {
  id: string;
  displayName: string;
  description: string | null;
  installed: boolean | null;
  enabled: boolean | null;
  version: string | null;
  hasModule: boolean;
  loaded: boolean;
  toolCount: number;
  issues: string[];
}

export interface HealthReport {
  server: { version: string };
  addon: { installed: boolean; version: string | null; status: "ok" | "not-installed" | "unavailable"; detail?: string };
  umbraco: { version: string | null; versionCheck: string };
  forcedModules: string[];
  products: HealthProduct[];
  notes: string[];
}

export function buildHealthReport(state: HealthState): HealthReport {
  const caps = state.capabilities;
  const notes: string[] = [];
  const detected = caps.kind === "ok" ? caps.payload.products : [];

  const addon: HealthReport["addon"] =
    caps.kind === "ok"
      ? { installed: true, version: caps.payload.addonVersion, status: "ok" }
      : caps.kind === "no-addon"
        ? { installed: false, version: null, status: "not-installed" }
        : { installed: false, version: null, status: "unavailable", detail: caps.reason };

  // The two halves are released together. A config pinned to an older umbrella-mcp is the usual cause after an upgrade.
  if (caps.kind === "ok" && caps.payload.addonVersion !== state.serverVersion) {
    const addonVersion = caps.payload.addonVersion;
    notes.push(
      `umbrella-mcp ${state.serverVersion} is running, but the site's Umbraco.Community.Umbrella add-on is ${addonVersion}. ` +
      `The two are released together: set umbrella-mcp@${addonVersion} in your MCP client config. ` +
      "A .mcp.json the site wrote and nobody edited is upgraded when the site next starts in Development.",
    );
  }

  if (caps.kind === "no-addon") {
    notes.push("Install the Umbraco.Community.Umbrella NuGet package on the site to enable product tools beyond the CMS.");
  }

  const products: HealthProduct[] = state.modules.map((
    {
      decision, loaded, toolCount, issues,
      siteDisabledCollections = [], defaultDisabledCollections = [], siteSettingsIgnored = false, siteReadOnly = false,
    },
  ) => {
    const name = decision.module.displayName;
    // Without the add-on there is no Umbrella dashboard, so there are no backoffice settings to mention.
    const hasDashboard = caps.kind === "ok";
    if (defaultDisabledCollections.length > 0) {
      // `<id>:*`, not the group names: an include list keeps only the groups it names.
      const how = hasDashboard ? "Switch them on in the Umbrella dashboard." : `Set UMBRACO_INCLUDE_TOOL_COLLECTIONS=${decision.module.id}:* to switch them on.`;
      notes.push(`${name}: tool groups off by default: ${defaultDisabledCollections.join(", ")}. ${how}`);
    }
    if (hasDashboard && siteSettingsIgnored) {
      notes.push(`${name}: the backoffice tool group settings are ignored because the environment sets collection filters for this module.`);
    } else if (hasDashboard && siteDisabledCollections.length > 0) {
      notes.push(`${name}: tool groups disabled in the backoffice: ${siteDisabledCollections.join(", ")}.`);
    }
    if (hasDashboard && siteReadOnly) {
      notes.push(`${name}: only read-only tools, as set in the backoffice.`);
    }
    const p = detected.find((d) => d.id === decision.module.id) ?? null;
    if (caps.kind === "ok" && !decision.module.required && (!p || !p.installed)) {
      notes.push(`There is a module for ${decision.module.displayName}, but it is not installed on this site.`);
    }
    return {
      id: decision.module.id,
      displayName: decision.module.displayName,
      description: decision.module.description,
      installed: p ? p.installed : null,
      enabled: p ? p.enabled : null,
      version: p ? p.version : null,
      hasModule: true,
      loaded,
      toolCount,
      issues: [...(p?.issues ?? []), ...issues, ...(decision.load ? [] : [decision.reason])],
    };
  });

  for (const p of detected) {
    if (products.some((x) => x.id === p.id)) continue;
    products.push({ ...p, description: null, hasModule: false, loaded: false, toolCount: 0 });
    if (p.installed) notes.push(`${p.displayName} is installed, but this MCP has no ${p.displayName} module yet.`);
  }

  for (const id of state.forcedModules) {
    if (!state.modules.some((m) => m.decision.module.id === id)) {
      notes.push(`UMBRACO_MCP_MODULES lists "${id}", but there is no module with that id.`);
    }
  }

  if (state.catalogueReport && !state.catalogueReport.ok) {
    notes.push(`Could not report the tool groups to the site, so the backoffice Umbrella dashboard may be out of date: ${state.catalogueReport.reason}`);
  }

  return {
    server: { version: state.serverVersion },
    addon,
    umbraco: { version: state.umbracoVersion, versionCheck: state.versionCheckMessage ?? "ok" },
    forcedModules: state.forcedModules,
    products,
    notes,
  };
}

export function registerHealthTool(server: { registerTool: McpServer["registerTool"] }, getState: () => HealthState): void {
  server.registerTool(
    HEALTH_TOOL_NAME,
    {
      description:
        "Reports which Umbraco products this MCP detected on the site, which tool modules loaded (with tool counts), " +
        "the Umbraco version check result, and how to fix anything missing. Call this first when product tools seem absent.",
      annotations: { readOnlyHint: true },
    },
    async () => createToolResult(buildHealthReport(getState())),
  );
}
