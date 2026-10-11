import type { ServerConfigForCollections } from "@umbraco-cms/mcp-server-sdk";

/** Lists that accept `module:` prefixes. Unprefixed entries belong to the default (CMS) module. */
const MODULE_SCOPED = {
  toolModes: "UMBRACO_TOOL_MODES",
  includeToolCollections: "UMBRACO_INCLUDE_TOOL_COLLECTIONS",
  excludeToolCollections: "UMBRACO_EXCLUDE_TOOL_COLLECTIONS",
  includeTools: "UMBRACO_INCLUDE_TOOLS",
  excludeTools: "UMBRACO_EXCLUDE_TOOLS",
} as const;

/** Lists that apply to every module unchanged. */
const GLOBAL = {
  includeSlices: "UMBRACO_INCLUDE_SLICES",
  excludeSlices: "UMBRACO_EXCLUDE_SLICES",
} as const;

const split = (value: string | undefined) =>
  (value ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);

function entriesFor(value: string | undefined, moduleId: string, isDefaultModule: boolean): string[] | undefined {
  const mine: string[] = [];
  for (const entry of split(value)) {
    const colon = entry.indexOf(":");
    if (colon === -1) {
      if (isDefaultModule) mine.push(entry);
      continue;
    }
    if (entry.slice(0, colon).toLowerCase() !== moduleId) continue;
    const item = entry.slice(colon + 1);
    if (item === "*") return undefined; // no restriction for this module
    mine.push(item);
  }
  return mine.length > 0 ? mine : undefined;
}

export function buildModuleFilterInput(
  env: NodeJS.ProcessEnv,
  moduleId: string,
  isDefaultModule: boolean,
): ServerConfigForCollections {
  const config: ServerConfigForCollections = {};
  for (const [key, envName] of Object.entries(MODULE_SCOPED) as [keyof typeof MODULE_SCOPED, string][]) {
    const entries = entriesFor(env[envName], moduleId, isDefaultModule);
    if (entries) config[key] = entries;
  }
  for (const [key, envName] of Object.entries(GLOBAL) as [keyof typeof GLOBAL, string][]) {
    const entries = split(env[envName]);
    if (entries.length > 0) config[key] = entries;
  }
  return config;
}
