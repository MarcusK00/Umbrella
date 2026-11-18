import { buildCatalogue, reportCatalogue, shortDescription, type CataloguePayload } from "../catalogue.js";
import type { LoadedModule, McpProductModule } from "../module-contract.js";

const mod = (id: string): McpProductModule => ({
  id, displayName: id, toolPrefix: `${id}--`, packageName: `@x/${id}`, expectedMajor: "17", description: `${id} description`, useWhen: [`${id} requests`],
  load: async () => { throw new Error("unused"); },
});

type FakeTool = { name: string; description?: string; enabled?: (user: unknown) => boolean; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }; isReadOnly?: boolean };

const collection = (name: string, tools: FakeTool[]) => ({
  metadata: { name, displayName: name, description: "" },
  tools: () => tools as never,
});

const loaded = (collections: LoadedModule["collections"]): LoadedModule => ({
  collections, allModes: [], allModeNames: [], allSliceNames: [], createApiClient: () => "client",
});

describe("shortDescription", () => {
  it("keeps the first sentence", () => {
    expect(shortDescription("Lists forms.  Use list-folders first.")).toBe("Lists forms.");
  });
  it("does not end a sentence at e.g", () => {
    expect(shortDescription("Lists step types (e.g. email). Then add one.")).toBe("Lists step types (e.g. email).");
  });
  it("returns an empty string for undefined", () => {
    expect(shortDescription(undefined)).toBe("");
  });
  it("cuts a long sentence to 160 characters ending in an ellipsis", () => {
    const out = shortDescription("a".repeat(200));
    expect(out).toHaveLength(160);
    expect(out.endsWith("…")).toBe(true);
  });
  it("collapses whitespace", () => {
    expect(shortDescription("Line one\n  continues here.")).toBe("Line one continues here.");
  });
});

describe("buildCatalogue", () => {
  it("lists each collection's usable tools with flags", () => {
    const forms = loaded([
      collection("form", [
        { name: "list-forms", description: "Lists forms. More.", annotations: { readOnlyHint: true } },
        { name: "delete-form", annotations: { destructiveHint: true } },
        { name: "admin-only", enabled: () => false },
      ]),
    ]);
    const [c] = buildCatalogue("1", [{ module: mod("forms"), loaded: forms }], {}).modules[0].collections;
    expect(c.tools).toEqual([
      { name: "list-forms", description: "Lists forms.", readOnly: true, destructive: false },
      { name: "delete-form", description: "", readOnly: false, destructive: true },
    ]);
    expect(c.toolCount).toBe(2);
  });

  it("lists every collection with the tools the user can use, before filters", () => {
    const forms = loaded([
      collection("form", [{ name: "list-forms" }, { name: "admin-only", enabled: () => false }]),
      collection("prevalue-source", [{ name: "get-prevalue-source" }]),
    ]);

    expect(buildCatalogue("17.0.0", [{ module: mod("forms"), loaded: forms }], { id: "u" })).toEqual({
      umbrellaVersion: "17.0.0",
      modules: [{
        id: "forms",
        collections: [
          { name: "form", toolCount: 1, readOnlyToolCount: 0, nonDestructiveToolCount: 1, tools: [{ name: "list-forms", description: "", readOnly: false, destructive: false }] },
          { name: "prevalue-source", toolCount: 1, readOnlyToolCount: 0, nonDestructiveToolCount: 1, tools: [{ name: "get-prevalue-source", description: "", readOnly: false, destructive: false }] },
        ],
      }],
    });
  });

  it("flags default-off collections", () => {
    const forms = loaded([collection("umbraco-server", [{ name: "get-server-info" }]), collection("form", [{ name: "list-forms" }])]);
    const module = { ...mod("forms"), defaultDisabledCollections: ["umbraco-server"] };
    const [server, form] = buildCatalogue("17.0.0", [{ module, loaded: forms }], {}).modules[0].collections;
    expect(server).toMatchObject({ name: "umbraco-server", disabledByDefault: true });
    expect(form).not.toHaveProperty("disabledByDefault");
  });

  it("counts the usable tools that a read-only filter keeps", () => {
    const forms = loaded([
      collection("form", [
        { name: "list-forms", annotations: { readOnlyHint: true } },
        { name: "get-form", isReadOnly: true },
        { name: "delete-form", annotations: { readOnlyHint: false } },
        { name: "admin-list", annotations: { readOnlyHint: true }, enabled: () => false },
      ]),
    ]);

    const [module] = buildCatalogue("1", [{ module: mod("forms"), loaded: forms }], {}).modules;

    expect(module.collections).toEqual([{ name: "form", toolCount: 3, readOnlyToolCount: 2, nonDestructiveToolCount: 3, tools: expect.any(Array) }]);
  });

  it("reports nonDestructiveToolCount per collection", () => {
    const forms = loaded([
      collection("form", [
        { name: "list-forms" },
        { name: "delete-form", annotations: { destructiveHint: true } },
        { name: "update-form", annotations: { destructiveHint: false } },
        { name: "admin-delete", annotations: { destructiveHint: true }, enabled: () => false },
      ]),
    ]);

    const [module] = buildCatalogue("1", [{ module: mod("forms"), loaded: forms }], {}).modules;

    expect(module.collections[0]).toMatchObject({ toolCount: 3, nonDestructiveToolCount: 2 });
  });

  it("leaves out a module whose tools cannot be listed", () => {
    const broken = loaded([{ metadata: { name: "x", displayName: "x", description: "" }, tools: () => { throw new Error("boom"); } }]);
    const ok = loaded([collection("persona", [{ name: "get-persona" }])]);

    const r = buildCatalogue("1", [
      { module: mod("automate"), loaded: broken },
      { module: mod("engage"), loaded: ok },
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
