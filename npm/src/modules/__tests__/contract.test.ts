import { createPermissiveCodegenUser } from "@umbraco-cms/mcp-server-sdk";
import { buildRoutingInstructions } from "../../core/routing.js";
import { modules } from "../index.js";

const user = createPermissiveCodegenUser();

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

  it("loads every LoadedModule field", async () => {
    const loaded = await module.load();
    expect(Array.isArray(loaded.collections)).toBe(true);
    expect(loaded.collections.length).toBeGreaterThan(0);
    expect(Array.isArray(loaded.allModes)).toBe(true);
    expect(Array.isArray(loaded.allModeNames)).toBe(true);
    expect(Array.isArray(loaded.allSliceNames)).toBe(true);
    expect(typeof loaded.createApiClient).toBe("function");
  });

  it("defines well-formed tools", async () => {
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

  it("keeps the routing instructions for all modules under 2,000 characters", () => {
    expect(buildRoutingInstructions(modules).length).toBeLessThan(2000);
  });

  it("produces unique prefixed tool names across all modules", async () => {
    const seen = new Map<string, string>();
    for (const module of modules) {
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
