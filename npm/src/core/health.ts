import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createToolResult } from "@umbraco-cms/mcp-server-sdk";
import type { CapabilitiesResult } from "./capabilities.js";
import type { ModuleDecision } from "./module-selection.js";

import { HEALTH_TOOL_NAME } from "./routing.js";

export { HEALTH_TOOL_NAME };

export interface ModuleRuntimeState {
  decision: ModuleDecision;
  loaded: boolean;
  toolCount: number;
  issues: string[];
}

export interface HealthState {
  capabilities: CapabilitiesResult;
  umbracoVersion: string | null;
  versionCheckMessage: string | null;
  forcedModules: string[];
  modules: ModuleRuntimeState[];
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

  if (caps.kind === "no-addon") {
    notes.push("Install the Umbraco.Community.Umbrella NuGet package on the site to enable product tools beyond the CMS.");
  }

  const products: HealthProduct[] = state.modules.map(({ decision, loaded, toolCount, issues }) => {
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

  return {
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
