import { fetchCapabilities, interpretCapabilitiesResponse } from "../capabilities.js";

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
