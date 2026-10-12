import { CAPTURE_RAW_HTTP_RESPONSE, UmbracoManagementClient, type HttpResponse } from "@umbraco-cms/mcp-server-sdk";
import type { LoadedModule, McpProductModule } from "./module-contract.js";

export const CATALOGUE_PATH = "/umbraco/management/api/v1/mcp/catalogue";

export interface CatalogueModule {
  id: string;
  /** The environment sets collection filters for this module, so the backoffice settings do not apply. */
  siteSettingsIgnored: boolean;
  collections: { name: string; toolCount: number }[];
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
  modules: Array<{ module: McpProductModule; loaded: LoadedModule; siteSettingsIgnored: boolean }>,
  user: unknown,
): CataloguePayload {
  const result: CatalogueModule[] = [];
  for (const { module, loaded, siteSettingsIgnored } of modules) {
    try {
      result.push({
        id: module.id,
        siteSettingsIgnored,
        collections: loaded.collections.map((c) => ({
          name: c.metadata.name,
          toolCount: c.tools(user).filter((t) => !t.enabled || t.enabled(user)).length,
        })),
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
