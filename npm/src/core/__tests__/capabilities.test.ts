import { fetchCapabilities, interpretCapabilitiesResponse, siteDisabledCollections, siteNoDestructive, siteReadOnly } from "../capabilities.js";

const payload = {
  addonVersion: "17.0.0",
  products: [
    { id: "cms", displayName: "Umbraco CMS", installed: true, enabled: true, version: "17.7.0", issues: [] },
    { id: "forms", displayName: "Umbraco Forms", installed: true, enabled: true, version: "17.6.1", issues: [] },
  ],
};

describe("interpretCapabilitiesResponse", () => {
  it("accepts a valid 200 payload", () => {
    expect(interpretCapabilitiesResponse({ status: 200, data: payload })).toEqual({ kind: "ok", payload });
  });

  it("maps 404 to no-addon", () => {
    expect(interpretCapabilitiesResponse({ status: 404, data: "" })).toEqual({ kind: "no-addon" });
  });

  it.each([401, 403, 500, 503])("maps %i to unavailable with the status in the reason", (status) => {
    const r = interpretCapabilitiesResponse({ status, data: null });
    expect(r.kind).toBe("unavailable");
    expect(r.kind === "unavailable" && r.reason).toContain(String(status));
  });

  // Review Focus 2: a 200 that is not capabilities
  it.each([
    ["html login page", "<html>login</html>"],
    ["empty object", {}],
    ["products not an array", { addonVersion: "1", products: "x" }],
    ["product missing id", { addonVersion: "1", products: [{ installed: true }] }],
    ["disabledCollections not a string array", { addonVersion: "1", products: [{ ...payload.products[0], disabledCollections: [1] }] }],
    ["readOnly not a boolean", { addonVersion: "1", products: [{ ...payload.products[0], readOnly: "true" }] }],
    ["noDestructive not a boolean", { addonVersion: "1", products: [{ ...payload.products[0], noDestructive: "true" }] }],
  ])("treats a malformed 200 (%s) as unavailable", (_label, data) => {
    const r = interpretCapabilitiesResponse({ status: 200, data });
    expect(r.kind).toBe("unavailable");
    expect(r.kind === "unavailable" && r.reason).toMatch(/unexpected/i);
  });
});

describe("fetchCapabilities", () => {
  it("turns a thrown network error into unavailable", async () => {
    const r = await fetchCapabilities(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(r).toEqual({ kind: "unavailable", reason: "Request failed: ECONNREFUSED" });
  });

  it("uses the injected request result", async () => {
    await expect(fetchCapabilities(async () => ({ status: 404, data: "" }))).resolves.toEqual({ kind: "no-addon" });
  });
});

describe("siteDisabledCollections", () => {
  const withDisabled = (disabledCollections: unknown) =>
    interpretCapabilitiesResponse({ status: 200, data: { ...payload, products: [{ ...payload.products[1], disabledCollections }] } });

  it("returns the module's list", () => {
    expect(siteDisabledCollections(withDisabled(["prevalue-source"]), "forms")).toEqual(["prevalue-source"]);
  });

  it("saved empty list stays empty", () => {
    expect(siteDisabledCollections(withDisabled([]), "forms")).toEqual([]);
  });

  it("is null (no saved list) for another module or without the add-on", () => {
    expect(siteDisabledCollections(withDisabled(["prevalue-source"]), "cms")).toBeNull();
    expect(siteDisabledCollections({ kind: "no-addon" }, "forms")).toBeNull();
    expect(siteDisabledCollections({ kind: "unavailable", reason: "x" }, "forms")).toBeNull();
  });

  it("missing field means no saved list", () => {
    expect(siteDisabledCollections(interpretCapabilitiesResponse({ status: 200, data: payload }), "forms")).toBeNull();
  });

  // Review Focus 1: a null must not make the whole payload unexpected.
  it("treats null as no saved list and keeps the payload ok", () => {
    const r = withDisabled(null);
    expect(r.kind).toBe("ok");
    expect(siteDisabledCollections(r, "forms")).toBeNull();
  });
});

describe("siteReadOnly", () => {
  const withReadOnly = (readOnly: unknown) =>
    interpretCapabilitiesResponse({ status: 200, data: { ...payload, products: [{ ...payload.products[1], readOnly }] } });

  it("is true only for the module the site set to read-only", () => {
    expect(siteReadOnly(withReadOnly(true), "forms")).toBe(true);
    expect(siteReadOnly(withReadOnly(true), "cms")).toBe(false);
    expect(siteReadOnly(withReadOnly(false), "forms")).toBe(false);
  });

  it("is false for an old add-on without the field, a null, or no add-on", () => {
    expect(siteReadOnly(interpretCapabilitiesResponse({ status: 200, data: payload }), "forms")).toBe(false);
    const nulled = withReadOnly(null);
    expect(nulled.kind).toBe("ok");
    expect(siteReadOnly(nulled, "forms")).toBe(false);
    expect(siteReadOnly({ kind: "no-addon" }, "forms")).toBe(false);
    expect(siteReadOnly({ kind: "unavailable", reason: "x" }, "forms")).toBe(false);
  });
});

describe("siteNoDestructive", () => {
  const withLevel = (noDestructive: unknown) =>
    interpretCapabilitiesResponse({ status: 200, data: { ...payload, products: [{ ...payload.products[1], noDestructive }] } });

  it("reads the product", () => {
    expect(siteNoDestructive(withLevel(true), "forms")).toBe(true);
    expect(siteNoDestructive(withLevel(true), "cms")).toBe(false);
    expect(siteNoDestructive(withLevel(false), "forms")).toBe(false);
  });

  it("noDestructive missing or null is false", () => {
    expect(siteNoDestructive(interpretCapabilitiesResponse({ status: 200, data: payload }), "forms")).toBe(false);
    const nulled = withLevel(null);
    expect(nulled.kind).toBe("ok");
    expect(siteNoDestructive(nulled, "forms")).toBe(false);
    expect(siteNoDestructive({ kind: "no-addon" }, "forms")).toBe(false);
  });
});
