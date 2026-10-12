import { buildCatalogue, reportCatalogue, type CataloguePayload } from "../catalogue.js";
import type { LoadedModule, McpProductModule } from "../module-contract.js";

const mod = (id: string): McpProductModule => ({
  id, displayName: id, toolPrefix: `${id}--`, packageName: `@x/${id}`, expectedMajor: "17", description: `${id} description`, useWhen: [`${id} requests`],
  load: async () => { throw new Error("unused"); },
});

const collection = (name: string, tools: Array<{ name: string; enabled?: (user: unknown) => boolean }>) => ({
  metadata: { name, displayName: name, description: "" },
  tools: () => tools as never,
});

const loaded = (collections: LoadedModule["collections"]): LoadedModule => ({
  collections, allModes: [], allModeNames: [], allSliceNames: [], createApiClient: () => "client",
});

describe("buildCatalogue", () => {
  it("lists every collection with the tools the user can use, before filters", () => {
    const forms = loaded([
      collection("form", [{ name: "list-forms" }, { name: "admin-only", enabled: () => false }]),
      collection("prevalue-source", [{ name: "get-prevalue-source" }]),
    ]);

    expect(buildCatalogue("17.0.0", [{ module: mod("forms"), loaded: forms, siteSettingsIgnored: true }], { id: "u" })).toEqual({
      umbrellaVersion: "17.0.0",
      modules: [{
        id: "forms",
        siteSettingsIgnored: true,
        collections: [{ name: "form", toolCount: 1 }, { name: "prevalue-source", toolCount: 1 }],
      }],
    });
  });

  it("leaves out a module whose tools cannot be listed", () => {
    const broken = loaded([{ metadata: { name: "x", displayName: "x", description: "" }, tools: () => { throw new Error("boom"); } }]);
    const ok = loaded([collection("persona", [{ name: "get-persona" }])]);

    const r = buildCatalogue("1", [
      { module: mod("automate"), loaded: broken, siteSettingsIgnored: false },
      { module: mod("engage"), loaded: ok, siteSettingsIgnored: false },
    ], {});

    expect(r.modules.map((m) => m.id)).toEqual(["engage"]);
  });
});

describe("reportCatalogue", () => {
  const payload: CataloguePayload = { umbrellaVersion: "1", modules: [] };

  it("passes the payload to the request and reports success on 2xx", async () => {
    let sent: unknown;
    await expect(reportCatalogue(payload, async (p) => { sent = p; return { status: 204, data: "" }; })).resolves.toEqual({ ok: true });
    expect(sent).toBe(payload);
  });

  it.each([403, 404, 500])("turns HTTP %i into a reason", async (status) => {
    const r = await reportCatalogue(payload, async () => ({ status, data: "" }));
    expect(r).toEqual({ ok: false, reason: `Catalogue endpoint returned HTTP ${status}.` });
  });

  it("turns a thrown error into a reason instead of throwing", async () => {
    await expect(reportCatalogue(payload, async () => { throw new Error("ECONNRESET"); }))
      .resolves.toEqual({ ok: false, reason: "Request failed: ECONNRESET" });
  });
});
