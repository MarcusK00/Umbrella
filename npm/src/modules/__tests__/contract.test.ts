import { createPermissiveCodegenUser } from "@umbraco-cms/mcp-server-sdk";
import { buildRoutingInstructions } from "../../core/routing.js";
import { modules } from "../index.js";
import { modulesSkippedInCi } from "./skipped-modules.js";

const user = createPermissiveCodegenUser();

const skipped = modulesSkippedInCi(modules, process.env, (s) => import.meta.resolve(s));
if (skipped.size > 0) {
  console.warn(`Skipping load tests for ${[...skipped].join(", ")}: CI removed the package before installing (CI_ABSENT_PACKAGES).`);
}
const loadable = modules.filter((m) => !skipped.has(m.id));

describe.each(modules.map((m) => [m.id, m] as const))("module %s", (_id, module) => {
  it("has a valid id, prefix, package and major", () => {
    expect(module.id).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(module.toolPrefix).toBe(`${module.id}--`);
    expect(module.packageName).toMatch(/^@[a-z0-9-]+\/[a-z0-9-]+$/);
    expect(module.expectedMajor).toBe("17");
  });

  it("has routing text: description starts with the display name, useWhen is non-empty", () => {
    expect(module.description.startsWith(`${module.displayName}: `)).toBe(true);
    expect(module.useWhen.length).toBeGreaterThan(0);
    for (const phrase of module.useWhen) expect(phrase.trim().length).toBeGreaterThan(0);
  });

  const itLoads = skipped.has(module.id) ? it.skip : it;

  itLoads("loads every LoadedModule field", async () => {
    const loaded = await module.load();
    expect(Array.isArray(loaded.collections)).toBe(true);
    expect(loaded.collections.length).toBeGreaterThan(0);
    expect(Array.isArray(loaded.allModes)).toBe(true);
    expect(Array.isArray(loaded.allModeNames)).toBe(true);
    expect(Array.isArray(loaded.allSliceNames)).toBe(true);
    expect(typeof loaded.createApiClient).toBe("function");
  });

  itLoads("default-off collections exist in the package", async () => {
    const loaded = await module.load();
    const names = loaded.collections.map((c) => c.metadata.name);
    for (const name of module.defaultDisabledCollections ?? []) expect(names).toContain(name);
  });

  itLoads("defines well-formed tools", async () => {
    const loaded = await module.load();
    for (const collection of loaded.collections) {
      for (const tool of collection.tools(user)) {
        expect(typeof tool.name).toBe("string");
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.handler).toBe("function");
      }
    }
  });
});

describe("module set", () => {
  it("has exactly one required module, and it is cms", () => {
    expect(modules.filter((m) => m.required).map((m) => m.id)).toEqual(["cms"]);
  });

  it("has unique ids", () => {
    expect(new Set(modules.map((m) => m.id)).size).toBe(modules.length);
  });

  // CMS and Forms both have a recycle bin (and an empty-recycle-bin tool), so each must name its own.
  it("names whose recycle bin each product handles", () => {
    const useWhen = (id: string) => modules.find((m) => m.id === id)!.useWhen.join("; ");
    expect(useWhen("cms")).toContain("content and media recycle bins");
    expect(useWhen("forms")).toContain("the Forms recycle bin");
  });

  it("routes form submission analytics to Forms, which Engage points away from", () => {
    const forms = modules.find((m) => m.id === "forms")!.useWhen.join("; ");
    expect(forms).toMatch(/analys/);
  });

  it("switches off duplicate, test-aid and backoffice-plumbing groups", () => {
    const defaults = (id: string) => modules.find((m) => m.id === id)!.defaultDisabledCollections;
    expect(defaults("cms")).toEqual(["manifest", "user-data", "imaging"]);
    expect(defaults("forms")).toEqual(["umbraco-server", "acceptance-tests", "licensing", "updates", "media"]);
    expect(defaults("automate")).toEqual(["umbraco-server"]);
    expect(defaults("engage")).toEqual(["package", "add-ons", "cultures"]);
  });

  it("keeps the routing instructions for all modules under 2,000 characters", () => {
    expect(buildRoutingInstructions(modules).length).toBeLessThan(2000);
  });

  it("produces unique prefixed tool names across all modules", async () => {
    const seen = new Map<string, string>();
    for (const module of loadable) {
      const loaded = await module.load();
      for (const collection of loaded.collections) {
        for (const tool of collection.tools(user)) {
          const name = `${module.toolPrefix}${tool.name}`;
          expect(seen.get(name)).toBeUndefined();
          seen.set(name, module.id);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});
