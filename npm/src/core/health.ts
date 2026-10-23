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
  /** The site removes this module's destructive tools (from capabilities). */
  siteNoDestructive?: boolean;
  /** Whether the backoffice settings above are the site defaults or an override for the calling API user (from capabilities). */
  siteSettingsScope?: "site" | "user";
  /** How many destructive tools were removed from this module at registration. */
  destructiveRemoved?: number;
}

export interface HealthState {
  capabilities: CapabilitiesResult;
  /** The running umbrella-mcp's version. */
  serverVersion: string;
  umbracoVersion: string | null;
  versionCheckMessage: string | null;
  forcedModules: string[];
  modules: ModuleRuntimeState[];
  /** UMBRACO_NO_DESTRUCTIVE is set, which removes destructive tools for every module. */
  noDestructiveFromEnv: boolean;
  /** UMBRACO_READONLY is set, which keeps only read-only tools for every module. */
  readOnlyFromEnv: boolean;
  /** The name of the API user the server signed in as, when the site returned one. */
  apiUserName: string | null;
  /** Absent when the catalogue was not reported (no add-on). */
  catalogueReport?: CatalogueReportResult;
}

/**
 * What this API user's server got from a product: the level of the tools it loaded, `off` when the backoffice switched
 * it off, `noSectionAccess` when the user's groups don't grant its section, `notLoaded` for any other reason (see issues).
 */
export type HealthAccess = "full" | "noDestructive" | "readOnly" | "off" | "noSectionAccess" | "notLoaded";

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
  access: HealthAccess;
  /** Destructive tools removed by the no-destructive level; 0 when the level is off or the module did not load. */
  destructiveRemoved: number;
  issues: string[];
}

export interface HealthReport {
  /** The products and tools this API user can use, in one sentence, and which it cannot. */
  access: { apiUser: string | null; summary: string };
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
      `The two are released together: set umbrella-mcp@${addonVersion} in your MCP client config.`,
    );
  }

  if (caps.kind === "no-addon") {
    notes.push("Install the Umbraco.Community.Umbrella NuGet package on the site to enable product tools beyond the CMS.");
  }

  if (caps.kind === "unavailable") {
    notes.push(
      "The site's capabilities could not be read, so the backoffice tool levels (read-only, no destructive tools) and tool group settings were not applied. " +
      "Set UMBRACO_NO_DESTRUCTIVE=true or UMBRACO_READONLY=true in the MCP server's environment to enforce a level without the site.",
    );
  }

  if (state.noDestructiveFromEnv) {
    notes.push("UMBRACO_NO_DESTRUCTIVE is set, so destructive tools are removed for every product.");
  }

  const products: HealthProduct[] = state.modules.map((
    {
      decision, loaded, toolCount, issues,
      siteDisabledCollections = [], defaultDisabledCollections = [], siteSettingsIgnored = false, siteReadOnly = false,
      siteNoDestructive = false, siteSettingsScope = "site", destructiveRemoved = 0,
    },
  ) => {
    const name = decision.module.displayName;
    // Without the add-on there is no Umbrella dashboard, so there are no backoffice settings to mention.
    const hasDashboard = caps.kind === "ok";
    const inBackoffice = siteSettingsScope === "user" ? "in the backoffice for this API user" : "in the backoffice";
    if (defaultDisabledCollections.length > 0) {
      // `<id>:*`, not the group names: an include list keeps only the groups it names.
      const how = hasDashboard ? "Switch them on in the Umbrella dashboard." : `Set UMBRACO_INCLUDE_TOOL_COLLECTIONS=${decision.module.id}:* to switch them on.`;
      notes.push(`${name}: tool groups off by default: ${defaultDisabledCollections.join(", ")}. ${how}`);
    }
    if (hasDashboard && siteSettingsIgnored) {
      notes.push(`${name}: the backoffice tool group settings are ignored because the environment sets collection filters for this module.`);
    } else if (hasDashboard && siteDisabledCollections.length > 0) {
      notes.push(`${name}: tool groups disabled ${inBackoffice}: ${siteDisabledCollections.join(", ")}.`);
    }
    if (hasDashboard && siteReadOnly) {
      notes.push(`${name}: only read-only tools, as set ${inBackoffice}.`);
    }
    if (hasDashboard && loaded && siteNoDestructive) {
      notes.push(`${name}: no destructive tools (${destructiveRemoved} removed), as set ${inBackoffice}.`);
    }
    // Switched off on purpose, or no section on purpose more often than not: a note, not an issue.
    if (decision.switchedOff || decision.noSectionAccess) {
      notes.push(`${name}: ${decision.reason}`);
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
      access: accessOf(decision, loaded, siteReadOnly || state.readOnlyFromEnv, siteNoDestructive || state.noDestructiveFromEnv),
      destructiveRemoved: loaded ? destructiveRemoved : 0,
      issues: [
        ...(p?.issues ?? []),
        ...issues,
        ...(decision.load || decision.switchedOff || decision.noSectionAccess ? [] : [decision.reason]),
      ],
    };
  });

  for (const p of detected) {
    if (products.some((x) => x.id === p.id)) continue;
    products.push({ ...p, description: null, hasModule: false, loaded: false, toolCount: 0, access: "notLoaded", destructiveRemoved: 0 });
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
    access: { apiUser: state.apiUserName, summary: summarizeAccess(state.apiUserName, products) },
    server: { version: state.serverVersion },
    addon,
    umbraco: { version: state.umbracoVersion, versionCheck: state.versionCheckMessage ?? "ok" },
    forcedModules: state.forcedModules,
    products,
    notes,
  };
}

function accessOf(decision: ModuleDecision, loaded: boolean, readOnly: boolean, noDestructive: boolean): HealthAccess {
  if (decision.noSectionAccess) return "noSectionAccess";
  if (decision.switchedOff) return "off";
  if (!loaded) return "notLoaded";
  return readOnly ? "readOnly" : noDestructive ? "noDestructive" : "full";
}

const LEVEL_WORDS: Partial<Record<HealthAccess, string>> = { full: "full", readOnly: "read-only", noDestructive: "no deletes" };

/** "API user "Ann" can use Umbraco CMS (full, 180 tools). No access to its section, so no tools: Umbraco Automate." */
export function summarizeAccess(apiUserName: string | null, products: HealthProduct[]): string {
  const names = (access: HealthAccess) => products.filter((p) => p.access === access).map((p) => p.displayName).join(", ");
  const usable = products
    .filter((p) => p.loaded && LEVEL_WORDS[p.access])
    .map((p) => `${p.displayName} (${LEVEL_WORDS[p.access]}, ${p.toolCount} ${p.toolCount === 1 ? "tool" : "tools"})`);
  const who = apiUserName ? `API user "${apiUserName}"` : "This API user";
  const parts = [usable.length > 0 ? `${who} can use ${usable.join(", ")}.` : `${who} can use no product tools.`];
  const noSection = names("noSectionAccess");
  if (noSection) parts.push(`Its user groups don't grant the section, so no tools: ${noSection}.`);
  const off = names("off");
  if (off) parts.push(`Switched off in the backoffice: ${off}.`);
  return parts.join(" ");
}

export function registerHealthTool(server: { registerTool: McpServer["registerTool"] }, getState: () => HealthState): void {
  server.registerTool(
    HEALTH_TOOL_NAME,
    {
      description:
        "Reports which Umbraco products this MCP detected on the site, which tool modules loaded (with tool counts), " +
        "what this API user can use per product (access level, or no section access), " +
        "the Umbraco version check result, and how to fix anything missing. Call this first when product tools seem absent.",
      annotations: { readOnlyHint: true },
    },
    async () => createToolResult(buildHealthReport(getState())),
  );
}
