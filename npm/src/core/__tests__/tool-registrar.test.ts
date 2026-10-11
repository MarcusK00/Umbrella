import { createCollectionConfigLoader, getApiClient, type CollectionConfiguration } from "@umbraco-cms/mcp-server-sdk";
import { installClientContext } from "../client-context.js";
import type { LoadedModule, McpProductModule } from "../module-contract.js";
import { DuplicateToolNameError, registerModuleTools, type RegistrationContext } from "../tool-registrar.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tool = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: `${name} tool`,
  slices: ["read"],
  annotations: { readOnlyHint: true },
  handler: async () => {
    await sleep(name.includes("slow") ? 20 : 1);
    return { content: [{ type: "text", text: String(getApiClient()) }] };
  },
  ...extra,
});

const loaded = (client: string, tools: ReturnType<typeof tool>[]): LoadedModule => ({
  collections: [{ metadata: { name: "things", displayName: "Things", description: "" }, tools: () => tools as never }],
  allModes: [],
  allModeNames: [],
  allSliceNames: ["read", "create"],
  createApiClient: () => client,
});

const mod = (id: string): McpProductModule => ({
  id, displayName: id, toolPrefix: `${id}--`, packageName: `@x/${id}`, expectedMajor: "17", description: `${id} description`, useWhen: [`${id} requests`],
  load: async () => { throw new Error("unused"); },
});

const noFilter = (l: LoadedModule): CollectionConfiguration =>
  createCollectionConfigLoader({ modeRegistry: l.allModes, allModeNames: l.allModeNames, allSliceNames: l.allSliceNames }).loadFromConfig({});

const ctx = (): RegistrationContext & {
  calls: Map<string, (...a: unknown[]) => Promise<any>>;
  configs: Map<string, { description?: string }>;
} => {
  const calls = new Map<string, (...a: unknown[]) => Promise<any>>();
  const configs = new Map<string, { description?: string }>();
  return {
    calls,
    configs,
    user: { id: "u" },
    registered: new Map(),
    server: { registerTool: ((name: string, cfg: { description?: string }, cb: any) => { calls.set(name, cb); configs.set(name, cfg); }) as never },
  };
};

beforeEach(() => installClientContext(() => "default-client"));

describe("registerModuleTools", () => {
  it("prefixes every tool and returns the count", () => {
    const c = ctx();
    const l = loaded("forms-client", [tool("list-forms"), tool("get-form")]);
    expect(registerModuleTools(c, mod("forms"), l, noFilter(l))).toBe(2);
    expect([...c.calls.keys()]).toEqual(["forms--list-forms", "forms--get-form"]);
    expect(c.registered.get("forms--list-forms")).toBe("forms");
  });

  it("prefixes every description with the product display name", () => {
    const c = ctx();
    const l = loaded("forms-client", [tool("list-forms")]);
    registerModuleTools(c, mod("forms"), l, noFilter(l));
    expect(c.configs.get("forms--list-forms")!.description).toBe("[forms] list-forms tool");
  });

  it("skips tools whose enabled(user) is false", () => {
    const c = ctx();
    const l = loaded("forms-client", [tool("secret", { enabled: () => false }), tool("open")]);
    expect(registerModuleTools(c, mod("forms"), l, noFilter(l))).toBe(1);
  });

  it("applies the filter config", () => {
    const c = ctx();
    const l = loaded("forms-client", [tool("a"), tool("b")]);
    const filter = createCollectionConfigLoader({ modeRegistry: [], allModeNames: [], allSliceNames: ["read"] })
      .loadFromConfig({ excludeTools: ["b"] });
    expect(registerModuleTools(c, mod("forms"), l, filter)).toBe(1);
  });

  it("excludes non-read-only tools in readonly mode", () => {
    const c = ctx();
    const l = loaded("forms-client", [tool("list-forms"), tool("delete-form", { annotations: { destructiveHint: true } })]);
    const filter = createCollectionConfigLoader({ modeRegistry: [], allModeNames: [], allSliceNames: ["read"] })
      .loadFromConfig({ readonly: true });
    expect(registerModuleTools(c, mod("forms"), l, filter)).toBe(1);
    expect([...c.calls.keys()]).toEqual(["forms--list-forms"]);
  });

  it("throws on a duplicate final name", () => {
    const c = ctx();
    c.registered.set("forms--a", "other");
    const l = loaded("forms-client", [tool("a")]);
    expect(() => registerModuleTools(c, mod("forms"), l, noFilter(l))).toThrow(DuplicateToolNameError);
  });

  // Review Focus 1 through the real registration path
  it("binds each registered handler to its own product client under concurrency", async () => {
    const c = ctx();
    const f = loaded("forms-client", [tool("slow-list")]);
    const a = loaded("automate-client", [tool("list")]);
    registerModuleTools(c, mod("forms"), f, noFilter(f));
    registerModuleTools(c, mod("automate"), a, noFilter(a));

    const [formsResult, automateResult] = await Promise.all([
      c.calls.get("forms--slow-list")!({}, {}),
      c.calls.get("automate--list")!({}, {}),
    ]);

    expect(formsResult.content[0].text).toBe("forms-client");
    expect(automateResult.content[0].text).toBe("automate-client");
  });
});
