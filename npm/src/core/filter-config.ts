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

function entriesFor(
  value: string | undefined,
  moduleId: string,
  isDefaultModule: boolean,
  acceptPrefixedToolName: boolean,
): string[] | undefined {
  const mine: string[] = [];
  for (const entry of split(value)) {
    const colon = entry.indexOf(":");
    if (colon === -1) {
      // Tool lists also accept the visible name `<moduleId>--<tool>`.
      const dashes = acceptPrefixedToolName ? entry.indexOf("--") : -1;
      if (dashes !== -1) {
        if (entry.slice(0, dashes).toLowerCase() === moduleId && entry.length > dashes + 2) mine.push(entry.slice(dashes + 2));
      } else if (isDefaultModule) {
        mine.push(entry);
      }
      continue;
    }
    if (entry.slice(0, colon).toLowerCase() !== moduleId) continue;
    const item = entry.slice(colon + 1).trim();
    if (item === "*") return undefined; // no restriction for this module
    if (item.length > 0) mine.push(item);
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
    const entries = entriesFor(env[envName], moduleId, isDefaultModule, key === "includeTools" || key === "excludeTools");
    if (entries) config[key] = entries;
  }
  for (const [key, envName] of Object.entries(GLOBAL) as [keyof typeof GLOBAL, string][]) {
    const entries = split(env[envName]);
    if (entries.length > 0) config[key] = entries;
  }
  if (envReadOnly(env)) config.readonly = true;
  return config;
}

const COLLECTION_FILTERS = [MODULE_SCOPED.includeToolCollections, MODULE_SCOPED.excludeToolCollections];

/** True when the environment sets any collection filter for this module, including `module:*`. */
export function envSetsCollectionFilter(env: NodeJS.ProcessEnv, moduleId: string, isDefaultModule: boolean): boolean {
  return COLLECTION_FILTERS.some((envName) =>
    split(env[envName]).some((entry) => {
      const colon = entry.indexOf(":");
      if (colon === -1) return isDefaultModule;
      return entry.slice(0, colon).toLowerCase() === moduleId && entry.slice(colon + 1).trim().length > 0;
    }),
  );
}

/**
 * The module's filter input with the backoffice settings and the module's defaults applied. Collection exclusions
 * come from the first of: the environment (when it sets collection filters for the module, the site's list and the
 * defaults are ignored), the site's saved list (`[]` included), or the module's default-off collections when the
 * site has no saved list (`null`). Read-only always applies, since it can only remove tools; together with
 * `UMBRACO_READONLY` either one turns it on. The no-destructive level works the same way, with `UMBRACO_NO_DESTRUCTIVE`;
 * it is returned as `excludeDestructive` because the toolkit filter has no such option.
 */
export function buildEffectiveFilterInput(
  env: NodeJS.ProcessEnv,
  moduleId: string,
  isDefaultModule: boolean,
  siteDisabled: readonly string[] | null,
  siteReadOnly = false,
  defaults: readonly string[] = [],
  siteNoDestructive = false,
): { config: ServerConfigForCollections; siteSettingsIgnored: boolean; defaultsApplied: string[]; excludeDestructive: boolean } {
  const config = buildModuleFilterInput(env, moduleId, isDefaultModule);
  const siteSettingsIgnored = envSetsCollectionFilter(env, moduleId, isDefaultModule);
  const excluded = siteSettingsIgnored ? [] : [...(siteDisabled ?? defaults)];
  if (excluded.length > 0) config.excludeToolCollections = excluded;
  if (siteReadOnly) config.readonly = true;
  const defaultsApplied = !siteSettingsIgnored && siteDisabled === null ? [...defaults] : [];
  return { config, siteSettingsIgnored, defaultsApplied, excludeDestructive: siteNoDestructive || envNoDestructive(env) };
}

/** `UMBRACO_NO_DESTRUCTIVE=true` removes the tools products flag as destructive, for every module. */
export function envNoDestructive(env: NodeJS.ProcessEnv): boolean {
  return env.UMBRACO_NO_DESTRUCTIVE?.trim().toLowerCase() === "true";
}

/** `UMBRACO_READONLY=true` keeps only read-only tools, for every module. */
export function envReadOnly(env: NodeJS.ProcessEnv): boolean {
  return env.UMBRACO_READONLY?.trim().toLowerCase() === "true";
}
