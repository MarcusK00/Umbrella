import { CAPTURE_RAW_HTTP_RESPONSE } from "@umbraco-cms/mcp-server-sdk";
import type { ZodType } from "zod";
import type { ToolPatch } from "../core/tool-patches.js";

/** The longest date range the Forms analytics API accepts ("Date range must not exceed 1095 days."). */
export const ANALYTICS_MAX_RANGE_DAYS = 1095;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The start date to send when the caller gave none: the longest range the API accepts, ending at `endDate`
 * (or now). Returns null for an unreadable `endDate`, so the call goes through unchanged and the API reports it.
 */
export function defaultAnalyticsStartDate(endDate: unknown, now: Date = new Date()): string | null {
  const end = typeof endDate === "string" ? new Date(endDate) : now;
  if (Number.isNaN(end.getTime())) return null;
  return new Date(end.getTime() - ANALYTICS_MAX_RANGE_DAYS * DAY_MS).toISOString();
}

const START_DATE_DEFAULT_TEXT =
  `Omit for the ${ANALYTICS_MAX_RANGE_DAYS.toLocaleString("en-US")} days before the end date, the longest range the API accepts.`;

/**
 * The analytics tools send 0001-01-01 when `startDate` is omitted ("Omit to include all history"), and the API refuses
 * any range over 1,095 days, so every call without a start date fails. Default it to the longest range the API takes.
 */
export const analyticsStartDatePatch: ToolPatch = {
  inputSchema: (shape) => {
    const field = shape.startDate as ZodType | undefined;
    if (!field) return shape;
    const current = field.description ?? "";
    const description = current.includes("Omit to include all history.")
      ? current.replace("Omit to include all history.", START_DATE_DEFAULT_TEXT)
      : `${current} ${START_DATE_DEFAULT_TEXT}`.trim();
    return { ...shape, startDate: field.describe(description) };
  },
  handler: (original) => (args, extra) => {
    if (args.startDate !== undefined) return original(args, extra);
    const startDate = defaultAnalyticsStartDate(args.endDate);
    return original(startDate ? { ...args, startDate } : args, extra);
  },
};

/** Top-level form keys never copied from the saved form: the caller's own values, or ones the server sets on save. */
const NOT_KEPT = new Set(["id", "pages", "concurrencyToken", "updated", "updatedBy", "updatedByName"]);

/** Copies every input key the caller left out (undefined) from the saved form, apart from `NOT_KEPT`. */
export function keepSavedFormValues(
  args: Record<string, unknown>,
  saved: Record<string, unknown>,
  inputKeys: readonly string[],
): Record<string, unknown> {
  const merged = { ...args };
  for (const key of inputKeys) {
    if (NOT_KEPT.has(key) || merged[key] !== undefined || saved[key] === undefined) continue;
    merged[key] = saved[key];
  }
  return merged;
}

interface FormsFormClient {
  getFormById(id: string, params: Record<string, unknown>, options: unknown): Promise<{ status?: number; data?: unknown }>;
}

/**
 * update-form fills every top-level setting the caller leaves out with a default before it replaces the form, so
 * leaving out `created`, `createdBy` or a setting such as the retention days resets it, although the tool description
 * says such keys are optional. Read the saved form first and keep its values for the keys the caller left out.
 * If the form can't be read, the call goes through unchanged and the API reports any problem.
 */
export const updateFormKeepsSavedValuesPatch: ToolPatch = {
  description: (description) =>
    `${description} Top-level settings you leave out keep the form's current values.`,
  handler: (original, ctx) => async (args, extra) => {
    if (typeof args.id !== "string") return original(args, extra);
    let saved: unknown;
    try {
      const response = await (ctx.createApiClient() as FormsFormClient).getFormById(args.id, {}, CAPTURE_RAW_HTTP_RESPONSE);
      const ok = response.status === undefined || (response.status >= 200 && response.status < 300);
      saved = ok ? response.data : undefined;
    } catch {
      saved = undefined;
    }
    if (!saved || typeof saved !== "object") return original(args, extra);
    return original(keepSavedFormValues(args, saved as Record<string, unknown>, ctx.inputKeys), extra);
  },
};

const ANALYTICS_TOOLS = [
  "query-analytics-overview",
  "query-analytics-submissions",
  "query-analytics-submissions-hourly",
  "query-analytics-workflows",
  "query-analytics-origins",
  "query-analytics-origins-overview",
];

export const formsToolPatches: Readonly<Record<string, ToolPatch>> = {
  ...Object.fromEntries(ANALYTICS_TOOLS.map((name) => [name, analyticsStartDatePatch])),
  "update-form": updateFormKeepsSavedValuesPatch,
};
