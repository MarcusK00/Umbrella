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
  /** No destructive tools, as set in the backoffice. Missing on older add-ons. */
  noDestructive?: boolean | null;
  /** Switched off in the backoffice: the server does not load this product. Missing on older add-ons. */
  off?: boolean | null;
  /** "user" when the settings above are an override for the calling API user, "site" for the defaults. Missing on older add-ons; any other value counts as "site". */
  settingsScope?: string | null;
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
    (o.noDestructive === undefined || o.noDestructive === null || typeof o.noDestructive === "boolean") &&
    (o.off === undefined || o.off === null || typeof o.off === "boolean") &&
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

/**
 * The collections the site disabled for a module, or null when the site has no saved list for it (never saved, no
 * add-on, capabilities unavailable, or an add-on that omits the field). Null means the module's defaults apply.
 */
export function siteDisabledCollections(caps: CapabilitiesResult, moduleId: string): string[] | null {
  if (caps.kind !== "ok") return null;
  return caps.payload.products.find((p) => p.id === moduleId)?.disabledCollections ?? null;
}

/** Whether the site limits a module to read-only tools; false without the add-on or on add-ons that predate the field. */
export function siteReadOnly(caps: CapabilitiesResult, moduleId: string): boolean {
  if (caps.kind !== "ok") return false;
  return caps.payload.products.find((p) => p.id === moduleId)?.readOnly === true;
}

/** Whether the site removes a module's destructive tools; false without the add-on or on add-ons that predate the field. */
export function siteNoDestructive(caps: CapabilitiesResult, moduleId: string): boolean {
  if (caps.kind !== "ok") return false;
  return caps.payload.products.find((p) => p.id === moduleId)?.noDestructive === true;
}

/** Whether the site switched a module off; false without the add-on or on add-ons that predate the field. */
export function siteOff(caps: CapabilitiesResult, moduleId: string): boolean {
  if (caps.kind !== "ok") return false;
  return caps.payload.products.find((p) => p.id === moduleId)?.off === true;
}

/** "user" when the module's backoffice settings are an override for the calling API user; "site" otherwise, also for a missing, null or unknown value. */
export function siteSettingsScope(caps: CapabilitiesResult, moduleId: string): "site" | "user" {
  if (caps.kind !== "ok") return "site";
  return caps.payload.products.find((p) => p.id === moduleId)?.settingsScope === "user" ? "user" : "site";
}
