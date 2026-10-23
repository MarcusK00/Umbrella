import type { McpProductModule } from "../module-contract.js";
import type { CapabilitiesResult, ProductCapability } from "../capabilities.js";
import { majorOf, parseForcedModules, selectModules } from "../module-selection.js";

const mod = (id: string, required = false): McpProductModule => ({
  id, displayName: id, toolPrefix: `${id}--`, packageName: `@x/${id}`, expectedMajor: "17", description: `${id} description`, useWhen: [`${id} requests`], required,
  load: async () => { throw new Error("not used"); },
});
const product = (id: string, over: Partial<ProductCapability> = {}): ProductCapability => ({
  id, displayName: id, installed: true, enabled: true, version: "17.1.0", issues: [], ...over,
});
const ok = (...products: ProductCapability[]): CapabilitiesResult => ({ kind: "ok", payload: { addonVersion: "17.0.0", products } });
const modules = [mod("cms", true), mod("forms"), mod("automate")];
const decision = (ds: ReturnType<typeof selectModules>, id: string) => ds.find((d) => d.module.id === id)!;

describe("selectModules", () => {
  it("always loads required modules, even without capabilities", () => {
    const ds = selectModules(modules, { kind: "no-addon" }, []);
    expect(decision(ds, "cms").load).toBe(true);
    expect(decision(ds, "forms").load).toBe(false);
    expect(decision(ds, "forms").reason).toMatch(/Umbraco\.Community\.Umbrella add-on is not installed/);
  });

  it("loads installed and enabled products with a matching major", () => {
    const ds = selectModules(modules, ok(product("cms"), product("forms"), product("automate", { installed: false, enabled: false, version: null })), []);
    expect(decision(ds, "forms").load).toBe(true);
    expect(decision(ds, "automate").load).toBe(false);
    expect(decision(ds, "automate").reason).toMatch(/not installed/);
  });

  it("skips installed-but-disabled products", () => {
    const ds = selectModules(modules, ok(product("forms", { enabled: false })), []);
    expect(decision(ds, "forms").load).toBe(false);
    expect(decision(ds, "forms").reason).toMatch(/not enabled/);
  });

  // Review Focus 3: odd versions
  it.each([
    ["17.6.1-beta.1+abc", true],
    ["v17.2.0", true],
    ["18.0.0", false],
  ])("version %s -> load=%s", (version, load) => {
    const ds = selectModules(modules, ok(product("forms", { version })), []);
    expect(decision(ds, "forms").load).toBe(load);
  });

  it("skips an installed product with an unknown version", () => {
    const ds = selectModules(modules, ok(product("forms", { version: null })), []);
    expect(decision(ds, "forms").load).toBe(false);
    expect(decision(ds, "forms").reason).toMatch(/unknown version/);
  });

  describe("switched off in the backoffice", () => {
    it("does not load a product that is off, with the site reason", () => {
      const d = decision(selectModules(modules, ok(product("forms", { off: true })), []), "forms");
      expect(d.load).toBe(false);
      expect(d.reason).toBe("Switched off in the backoffice (Settings → Umbrella).");
      expect(d.switchedOff).toBe(true);
    });

    it("uses the API user wording when settingsScope is user", () => {
      const d = decision(selectModules(modules, ok(product("forms", { off: true, settingsScope: "user" })), []), "forms");
      expect(d.reason).toBe("Switched off for this API user in the backoffice (Settings → Umbrella).");
    });

    it("off wins over UMBRACO_MCP_MODULES", () => {
      const d = decision(selectModules(modules, ok(product("forms", { off: true })), ["forms"]), "forms");
      expect(d.load).toBe(false);
      expect(d.switchedOff).toBe(true);
    });

    it("still loads the required module when the payload says off", () => {
      const d = decision(selectModules(modules, ok(product("cms", { off: true })), []), "cms");
      expect(d.load).toBe(true);
      expect(d.switchedOff).toBeUndefined();
    });

    // Review Focus 5: older add-ons send no off field.
    it.each([[null], [undefined], [false]])("loads as before when off is %s", (off) => {
      const d = decision(selectModules(modules, ok(product("forms", { off })), []), "forms");
      expect(d.load).toBe(true);
      expect(d.switchedOff).toBeUndefined();
    });
  });

  describe("no section access", () => {
    it("does not load a product the API user has no section for", () => {
      const d = decision(selectModules(modules, ok(product("forms", { noSectionAccess: true })), []), "forms");
      expect(d.load).toBe(false);
      expect(d.noSectionAccess).toBe(true);
      expect(d.reason).toMatch(/^This API user's user groups don't grant the forms section, so its tools were not loaded\./);
    });

    it("wins over UMBRACO_MCP_MODULES, since the API would refuse every tool", () => {
      const d = decision(selectModules(modules, ok(product("forms", { noSectionAccess: true })), ["forms"]), "forms");
      expect(d.load).toBe(false);
    });

    it.each([[null], [undefined], [false]])("loads as before when noSectionAccess is %s", (noSectionAccess) => {
      const d = decision(selectModules(modules, ok(product("forms", { noSectionAccess })), []), "forms");
      expect(d.load).toBe(true);
      expect(d.noSectionAccess).toBeUndefined();
    });
  });

  it("forced modules load regardless of capabilities", () => {
    const ds = selectModules(modules, { kind: "unavailable", reason: "HTTP 500" }, ["automate"]);
    expect(decision(ds, "automate").load).toBe(true);
    expect(decision(ds, "automate").reason).toMatch(/UMBRACO_MCP_MODULES/);
    expect(decision(ds, "forms").reason).toMatch(/HTTP 500/);
  });
});

describe("parseForcedModules", () => {
  // Review Focus 4
  it("normalises case, whitespace and empties", () => {
    expect(parseForcedModules(" Forms, ,automate,engage ")).toEqual(["forms", "automate", "engage"]);
  });
  it("returns [] for undefined or blank", () => {
    expect(parseForcedModules(undefined)).toEqual([]);
    expect(parseForcedModules("  ")).toEqual([]);
  });
});

describe("majorOf", () => {
  it.each([["17.6.1", "17"], ["v17", "17"], ["17", "17"], [null, null], ["abc", null]])("%s -> %s", (v, m) => {
    expect(majorOf(v)).toBe(m);
  });
});
