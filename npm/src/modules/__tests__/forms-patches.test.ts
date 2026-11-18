import { z } from "zod";
import {
  ANALYTICS_MAX_RANGE_DAYS,
  analyticsStartDatePatch,
  defaultAnalyticsStartDate,
  formsToolPatches,
  keepSavedFormValues,
  updateFormKeepsSavedValuesPatch,
} from "../forms-patches.js";

const echo = async (args: Record<string, unknown>) => args;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("analytics start date", () => {
  it("defaults to the longest range the API accepts, ending at the end date or now", () => {
    expect(defaultAnalyticsStartDate("2026-11-18T00:00:00Z")).toBe(new Date(Date.parse("2026-11-18T00:00:00Z") - ANALYTICS_MAX_RANGE_DAYS * DAY_MS).toISOString());
    const now = new Date("2026-11-18T12:00:00Z");
    expect(defaultAnalyticsStartDate(undefined, now)).toBe(new Date(now.getTime() - 1095 * DAY_MS).toISOString());
  });

  it("gives up on an unreadable end date", () => {
    expect(defaultAnalyticsStartDate("not a date")).toBeNull();
  });

  it("fills a missing start date and leaves a given one alone", async () => {
    const handler = analyticsStartDatePatch.handler!(echo, { createApiClient: () => null, inputKeys: [] });
    const filled = (await handler({ endDate: "2026-11-18T00:00:00Z" })) as Record<string, unknown>;
    expect(Date.parse("2026-11-18T00:00:00Z") - Date.parse(filled.startDate as string)).toBe(1095 * DAY_MS);
    expect(await handler({ startDate: "2026-01-01T00:00:00Z" })).toEqual({ startDate: "2026-01-01T00:00:00Z" });
    expect(await handler({ endDate: "nope" })).toEqual({ endDate: "nope" });
  });

  it("rewrites the start date description that promised all history", () => {
    const shape = analyticsStartDatePatch.inputSchema!({
      startDate: z.string().optional().describe("Start of the date range. Omit to include all history."),
      endDate: z.string().optional(),
    });
    expect((shape.startDate as z.ZodType).description).toBe(
      "Start of the date range. Omit for the 1,095 days before the end date, the longest range the API accepts.",
    );
  });

  it("covers every analytics query tool", () => {
    for (const name of ["overview", "submissions", "submissions-hourly", "workflows", "origins", "origins-overview"]) {
      expect(formsToolPatches[`query-analytics-${name}`]).toBe(analyticsStartDatePatch);
    }
  });
});

describe("update-form keeps saved values", () => {
  const saved = {
    id: "f", name: "Saved", created: "2026-11-18T07:01:12.163Z", createdBy: 1, updated: "x", updatedBy: 1,
    concurrencyToken: "1", daysToRetainApprovedRecordsFor: 365, pages: [{ saved: true }],
  };
  const keys = ["id", "name", "created", "createdBy", "updated", "updatedBy", "concurrencyToken", "daysToRetainApprovedRecordsFor", "pages", "cssClass"];

  it("copies left-out keys from the saved form, but not the caller's own or server-set ones", () => {
    expect(keepSavedFormValues({ id: "f", name: "New", pages: [] }, saved, keys)).toEqual({
      id: "f", name: "New", pages: [], created: "2026-11-18T07:01:12.163Z", createdBy: 1, daysToRetainApprovedRecordsFor: 365,
    });
  });

  it("keeps a value the caller sent, even a falsy one", () => {
    expect(keepSavedFormValues({ id: "f", pages: [], daysToRetainApprovedRecordsFor: 0 }, saved, keys).daysToRetainApprovedRecordsFor).toBe(0);
  });

  it("reads the saved form with the product client before calling the tool", async () => {
    const calls: unknown[][] = [];
    const getFormById = async (...args: unknown[]) => {
      calls.push(args);
      return { status: 200, data: saved };
    };
    const handler = updateFormKeepsSavedValuesPatch.handler!(echo, { createApiClient: () => ({ getFormById }), inputKeys: keys });
    const result = (await handler({ id: "f", name: "New", pages: [] })) as Record<string, unknown>;
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 2)).toEqual(["f", {}]);
    expect(result.created).toBe("2026-11-18T07:01:12.163Z");
    expect(result.createdBy).toBe(1);
  });

  it("calls the tool unchanged when the saved form can't be read", async () => {
    const failing = updateFormKeepsSavedValuesPatch.handler!(echo, {
      createApiClient: () => ({ getFormById: async () => { throw new Error("down"); } }),
      inputKeys: keys,
    });
    expect(await failing({ id: "f", pages: [] })).toEqual({ id: "f", pages: [] });
    const notFound = updateFormKeepsSavedValuesPatch.handler!(echo, {
      createApiClient: () => ({ getFormById: async () => ({ status: 404, data: { title: "Not found" } }) }),
      inputKeys: keys,
    });
    expect(await notFound({ id: "f", pages: [] })).toEqual({ id: "f", pages: [] });
  });

  it("says so in the description", () => {
    expect(updateFormKeepsSavedValuesPatch.description!("Replaces a form.")).toBe(
      "Replaces a form. Top-level settings you leave out keep the form's current values.",
    );
  });
});
