import { CAPTURE_RAW_HTTP_RESPONSE, UmbracoManagementClient, type HttpResponse, type ToolDefinition } from "@umbraco-cms/mcp-server-sdk";
import { isDestructive } from "./destructive.js";
import type { LoadedModule, McpProductModule } from "./module-contract.js";

export const CATALOGUE_PATH = "/umbraco/management/api/v1/mcp/catalogue";

export interface CatalogueTool {
  name: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
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
export function catalogueTool(tool: ToolDefinition<any, any>): CatalogueTool {
  return {
    name: tool.name,
    description: shortDescription(tool.description),
    // The same test as the toolkit's read-only filter (shouldIncludeTool).
    readOnly: Boolean(tool.annotations?.readOnlyHint || tool.isReadOnly),
    destructive: isDestructive(tool),
  };
}

export interface CatalogueModule {
  id: string;
  /**
   * `readOnlyToolCount`: how many of the usable tools are left when the module is read-only.
   * `nonDestructiveToolCount`: how many are left when destructive tools are removed.
   * `disabledByDefault`: present (true) only on the module's default-off collections.
   */
  collections: { name: string; toolCount: number; readOnlyToolCount: number; nonDestructiveToolCount: number; disabledByDefault?: true; tools: CatalogueTool[] }[];
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
): CataloguePayload {
  const result: CatalogueModule[] = [];
  for (const { module, loaded } of modules) {
    try {
      const defaults = new Set(module.defaultDisabledCollections ?? []);
      result.push({
        id: module.id,
        collections: loaded.collections.map((c) => {
          const usable = c.tools(user).filter((t) => !t.enabled || t.enabled(user));
          return {
            name: c.metadata.name,
            toolCount: usable.length,
            // The same test as the toolkit's read-only filter (shouldIncludeTool).
            readOnlyToolCount: usable.filter((t) => t.annotations?.readOnlyHint || t.isReadOnly).length,
            nonDestructiveToolCount: usable.filter((t) => !isDestructive(t)).length,
            tools: usable.map(catalogueTool),
            ...(defaults.has(c.metadata.name) && { disabledByDefault: true as const }),
          };
        }),
      });
    } catch {
      // A module whose tools can't be listed already reports that when it registers.
    }
  }
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
