import { CAPTURE_RAW_HTTP_RESPONSE, UmbracoManagementClient, type HttpResponse } from "@umbraco-cms/mcp-server-sdk";

export const CAPABILITIES_PATH = "/umbraco/management/api/v1/mcp/capabilities";

export interface ProductCapability {
  id: string;
  displayName: string;
  installed: boolean;
  enabled: boolean;
  version: string | null;
  issues: string[];
  /** Tool groups switched off in the backoffice. Missing on older add-ons. */
  disabledCollections?: string[] | null;
  /** Only read-only tools, as set in the backoffice. Missing on older add-ons. */
  readOnly?: boolean | null;
}

export interface CapabilitiesPayload {
  addonVersion: string;
  products: ProductCapability[];
}

export type CapabilitiesResult =
  | { kind: "ok"; payload: CapabilitiesPayload }
  | { kind: "no-addon" }
  | { kind: "unavailable"; reason: string };

type RawResponse = { status: number; data: unknown };

const isProduct = (p: unknown): p is ProductCapability => {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.displayName === "string" &&
    typeof o.installed === "boolean" &&
    typeof o.enabled === "boolean" &&
    (o.version === null || typeof o.version === "string") &&
    (o.disabledCollections === undefined ||
      o.disabledCollections === null ||
      (Array.isArray(o.disabledCollections) && o.disabledCollections.every((c) => typeof c === "string"))) &&
    (o.readOnly === undefined || o.readOnly === null || typeof o.readOnly === "boolean") &&
    Array.isArray(o.issues)
  );
};

const isPayload = (d: unknown): d is CapabilitiesPayload => {
  if (typeof d !== "object" || d === null) return false;
  const o = d as Record<string, unknown>;
  return typeof o.addonVersion === "string" && Array.isArray(o.products) && o.products.every(isProduct);
};

export function interpretCapabilitiesResponse(res: RawResponse): CapabilitiesResult {
  if (res.status === 404) return { kind: "no-addon" };
  if (res.status !== 200) return { kind: "unavailable", reason: `Capabilities endpoint returned HTTP ${res.status}.` };
  if (!isPayload(res.data)) return { kind: "unavailable", reason: "Capabilities endpoint returned an unexpected response." };
  return { kind: "ok", payload: res.data };
}

const defaultRequest = async (): Promise<RawResponse> =>
  (await UmbracoManagementClient<unknown>(
    { url: CAPABILITIES_PATH, method: "GET" },
    CAPTURE_RAW_HTTP_RESPONSE,
  )) as unknown as HttpResponse<unknown>;

export async function fetchCapabilities(request: () => Promise<RawResponse> = defaultRequest): Promise<CapabilitiesResult> {
  try {
    return interpretCapabilitiesResponse(await request());
  } catch (error) {
    return { kind: "unavailable", reason: `Request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The collections the site disabled for a module; empty without the add-on or on add-ons that predate the field. */
export function siteDisabledCollections(caps: CapabilitiesResult, moduleId: string): string[] {
  if (caps.kind !== "ok") return [];
  return caps.payload.products.find((p) => p.id === moduleId)?.disabledCollections ?? [];
}

/** Whether the site limits a module to read-only tools; false without the add-on or on add-ons that predate the field. */
export function siteReadOnly(caps: CapabilitiesResult, moduleId: string): boolean {
  if (caps.kind !== "ok") return false;
  return caps.payload.products.find((p) => p.id === moduleId)?.readOnly === true;
}
