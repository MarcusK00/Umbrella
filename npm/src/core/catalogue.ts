import { CAPTURE_RAW_HTTP_RESPONSE, UmbracoManagementClient, type HttpResponse, type ToolDefinition } from "@umbraco-cms/mcp-server-sdk";
import { isDestructive } from "./destructive.js";
import type { LoadedModule, McpProductModule } from "./module-contract.js";
import { buildToolNameIndex, prefixToolReferences, type ToolNameIndex } from "./routing.js";
import { listToolNames, measureToolListSizes, prepareToolRegistration, type PreparedTool } from "./tool-registrar.js";

export const CATALOGUE_PATH = "/umbraco/management/api/v1/mcp/catalogue";

export interface CatalogueTool {
  name: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
  sizeBytes?: number;
}

const MAX_DESCRIPTION = 160;

/** The tool's first sentence with whitespace collapsed, at most 160 characters. A `.` closing `e.g` or `i.e` does not end a sentence. */
export function shortDescription(text: string | undefined): string {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  const sentenceEnd = /(?<!\be\.g|\bi\.e)[.!?](?=\s|$)/i.exec(collapsed);
  const first = sentenceEnd ? collapsed.slice(0, sentenceEnd.index + 1) : collapsed;
  return first.length > MAX_DESCRIPTION ? `${first.slice(0, MAX_DESCRIPTION - 1)}…` : first;
}

/** The one place a tool's catalogue entry is built. */
export function catalogueTool(tool: ToolDefinition<any, any>, sizeBytes?: number): CatalogueTool {
  return {
    name: tool.name,
    description: shortDescription(tool.description),
    // The same test as the toolkit's read-only filter (shouldIncludeTool).
    readOnly: Boolean(tool.annotations?.readOnlyHint || tool.isReadOnly),
    destructive: isDestructive(tool),
    ...(sizeBytes !== undefined && { sizeBytes }),
  };
}

export interface CatalogueModule {
  id: string;
  /**
   * `readOnlyToolCount`: how many of the usable tools are left when the module is read-only.
   * `nonDestructiveToolCount`: how many are left when destructive tools are removed.
   * `sizeBytes` / `readOnlySizeBytes` / `nonDestructiveSizeBytes`: UTF-8 bytes of the collection's tools as `tools/list` sends them.
   * `disabledByDefault`: present (true) only on the module's default-off collections.
   */
  collections: {
    name: string;
    toolCount: number;
    readOnlyToolCount: number;
    nonDestructiveToolCount: number;
    sizeBytes?: number;
    readOnlySizeBytes?: number;
    nonDestructiveSizeBytes?: number;
    disabledByDefault?: true;
    tools: CatalogueTool[];
  }[];
}

export interface CataloguePayload {
  umbrellaVersion: string;
  modules: CatalogueModule[];
}

export type CatalogueReportResult = { ok: true } | { ok: false; reason: string };

type RawResponse = { status: number; data: unknown };

/** Every collection of every loaded module, before filters, so the backoffice can also show the disabled ones. */
export function buildCatalogue(
  version: string,
  modules: Array<{ module: McpProductModule; loaded: LoadedModule }>,
  user: unknown,
  toolNames?: ToolNameIndex,
): CataloguePayload {
  const moduleEntries: Array<{
    module: McpProductModule;
    loaded: LoadedModule;
    collections: Array<{ name: string; usable: ToolDefinition<any, any>[] }>;
    references: (text: string) => string;
  }> = [];
  const preparedEntries: Array<Pick<PreparedTool, "name" | "config">> = [];

  for (const { module, loaded } of modules) {
    try {
      const ownIndex = buildToolNameIndex([{ module, toolNames: listToolNames(loaded, user) }]);
      const index = new Map([...(toolNames ?? []), ...ownIndex]);
      const references = (text: string) => prefixToolReferences(text, module, index);
      const collections = loaded.collections.map((c) => ({
        name: c.metadata.name,
        usable: c.tools(user).filter((t) => !t.enabled || t.enabled(user)),
      }));
      for (const { usable } of collections) {
        for (const tool of usable) {
          const prepared = prepareToolRegistration(module, loaded, tool, references);
          preparedEntries.push({ name: prepared.name, config: prepared.config });
        }
      }
      moduleEntries.push({ module, loaded, collections, references });
    } catch {
      // A module whose tools can't be listed already reports that when it registers.
    }
  }

  const sizeMap = measureToolListSizes(preparedEntries);
  const result: CatalogueModule[] = moduleEntries.map(({ module, collections }) => {
    const defaults = new Set(module.defaultDisabledCollections ?? []);
    return {
      id: module.id,
      collections: collections.map(({ name, usable }) => {
        const tools = usable.map((t) => catalogueTool(t, sizeMap.get(`${module.toolPrefix}${t.name}`) ?? 0));
        const sumBytes = (predicate: (t: CatalogueTool) => boolean) =>
          tools.reduce((sum, t) => (predicate(t) ? sum + (t.sizeBytes ?? 0) : sum), 0);
        return {
          name,
          toolCount: tools.length,
          // The same test as the toolkit's read-only filter (shouldIncludeTool).
          readOnlyToolCount: tools.filter((t) => t.readOnly).length,
          nonDestructiveToolCount: tools.filter((t) => !t.destructive).length,
          sizeBytes: sumBytes(() => true),
          readOnlySizeBytes: sumBytes((t) => t.readOnly),
          nonDestructiveSizeBytes: sumBytes((t) => !t.destructive),
          tools,
          ...(defaults.has(name) && { disabledByDefault: true as const }),
        };
      }),
    };
  });
  return { umbrellaVersion: version, modules: result };
}

const defaultRequest = async (payload: CataloguePayload): Promise<RawResponse> =>
  (await UmbracoManagementClient<unknown>(
    { url: CATALOGUE_PATH, method: "POST", data: payload, headers: { "Content-Type": "application/json" } },
    CAPTURE_RAW_HTTP_RESPONSE,
  )) as unknown as HttpResponse<unknown>;

/** Sends the catalogue to the site. Never throws: a failure is returned for `get-mcp-health`. */
export async function reportCatalogue(
  payload: CataloguePayload,
  request: (payload: CataloguePayload) => Promise<RawResponse> = defaultRequest,
): Promise<CatalogueReportResult> {
  try {
    const { status } = await request(payload);
    return status >= 200 && status < 300 ? { ok: true } : { ok: false, reason: `Catalogue endpoint returned HTTP ${status}.` };
  } catch (error) {
    return { ok: false, reason: `Request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
