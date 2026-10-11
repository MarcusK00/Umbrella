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
    expect(decision(ds, "forms").reason).toMatch(/Umbraco\.Mcp addon is not installed/);
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
