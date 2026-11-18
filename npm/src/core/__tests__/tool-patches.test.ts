import { z } from "zod";
import { createCollectionConfigLoader, getApiClient } from "@umbraco-cms/mcp-server-sdk";
import { installClientContext } from "../client-context.js";
import type { LoadedModule, McpProductModule } from "../module-contract.js";
import { applyToolPatches, generalPatches, numericConcurrencyTokenPatch, type ToolPatch } from "../tool-patches.js";
import { registerModuleTools, type RegistrationContext } from "../tool-registrar.js";

const echo = async (args: Record<string, unknown>) => args;

describe("numericConcurrencyTokenPatch", () => {
  const shape = { id: z.string(), concurrencyToken: z.string().nullable().optional().describe("Token") };

  it("accepts a number, a string, null or nothing, and keeps the description", () => {
    const widened = z.object(numericConcurrencyTokenPatch.inputSchema!(shape));
    expect(widened.safeParse({ id: "a", concurrencyToken: 63930582072163 }).success).toBe(true);
    expect(widened.safeParse({ id: "a", concurrencyToken: "63930582072163" }).success).toBe(true);
    expect(widened.safeParse({ id: "a", concurrencyToken: null }).success).toBe(true);
    expect(widened.safeParse({ id: "a" }).success).toBe(true);
    expect((widened.shape.concurrencyToken as z.ZodType).description).toBe("Token");
  });

  it("passes a numeric token on as a string and leaves others alone", async () => {
    const handler = numericConcurrencyTokenPatch.handler!(echo, { createApiClient: () => null, inputKeys: [] });
    expect(await handler({ id: "a", concurrencyToken: 63930582072163 })).toEqual({ id: "a", concurrencyToken: "63930582072163" });
    expect(await handler({ id: "a", concurrencyToken: "1" })).toEqual({ id: "a", concurrencyToken: "1" });
    expect(await handler({ id: "a" })).toEqual({ id: "a" });
  });

  it("is a general patch only for tools with a concurrencyToken field", () => {
    expect(generalPatches(shape)).toEqual([numericConcurrencyTokenPatch]);
    expect(generalPatches({ id: z.string() })).toEqual([]);
    expect(generalPatches(undefined)).toEqual([]);
  });
});

describe("applyToolPatches", () => {
  it("returns an unpatched tool as it was", () => {
    const tool = { description: "d", inputSchema: { a: z.string() }, handler: echo };
    const patched = applyToolPatches(tool, [], () => null);
    expect(patched.description).toBe("d");
    expect(patched.inputSchema).toBe(tool.inputSchema);
    expect(patched.handler).toBe(echo);
  });

  it("applies patches in order and gives handlers the patched input keys and the client factory", async () => {
    const seen: unknown[] = [];
    const first: ToolPatch = {
      description: (d) => `${d} one`,
      inputSchema: (s) => ({ ...s, extra: z.string().optional() }),
      handler: (original, ctx) => (args, extra) => {
        seen.push(ctx.inputKeys, ctx.createApiClient());
        return original({ ...args, first: true }, extra);
      },
    };
    const second: ToolPatch = { description: (d) => `${d} two`, handler: (original) => (args, extra) => original({ ...args, second: true }, extra) };
    const patched = applyToolPatches({ description: "d", inputSchema: { a: z.string() }, handler: echo }, [first, second], () => "client");
    expect(patched.description).toBe("d one two");
    expect(Object.keys(patched.inputSchema!)).toEqual(["a", "extra"]);
    expect(await patched.handler({ a: "x" })).toEqual({ a: "x", first: true, second: true });
    expect(seen).toEqual([["a", "extra"], "client"]);
  });
});

describe("registerModuleTools with patches", () => {
  const loaded: LoadedModule = {
    collections: [{
      metadata: { name: "things", displayName: "Things", description: "" },
      tools: () => [
        {
          name: "update-thing",
          description: "Updates a thing.",
          slices: ["update"],
          inputSchema: { id: z.string(), concurrencyToken: z.string().nullable().optional() },
          handler: async (args: Record<string, unknown>) => ({ args, client: getApiClient() }),
        },
        { name: "plain", description: "Plain.", slices: ["read"], handler: async () => "plain" },
      ] as never,
    }],
    allModes: [],
    allModeNames: [],
    allSliceNames: ["read", "update"],
    createApiClient: () => "forms-client",
  };
  const module: McpProductModule = {
    id: "forms", displayName: "Forms", toolPrefix: "forms--", packageName: "@x/forms", expectedMajor: "17",
    description: "Forms: things.", useWhen: ["things"],
    toolPatches: { "update-thing": { description: (d) => `${d} Patched.`, handler: (original) => (args, extra) => original({ ...args, patched: true }, extra) } },
    load: async () => loaded,
  };

  it("registers the patched description, input schema and handler, inside the product's client context", async () => {
    installClientContext(() => "default-client");
    const calls = new Map<string, (...a: unknown[]) => Promise<any>>();
    const configs = new Map<string, { description?: string; inputSchema?: Record<string, z.ZodType> }>();
    const ctx: RegistrationContext = {
      user: {},
      registered: new Map(),
      server: { registerTool: ((name: string, cfg: never, cb: never) => { calls.set(name, cb); configs.set(name, cfg); }) as never },
    };
    const filter = createCollectionConfigLoader({ modeRegistry: [], allModeNames: [], allSliceNames: loaded.allSliceNames }).loadFromConfig({});
    registerModuleTools(ctx, module, loaded, filter);

    expect(configs.get("forms--update-thing")!.description).toBe("[Forms] Updates a thing. Patched.");
    expect(z.object(configs.get("forms--update-thing")!.inputSchema!).safeParse({ id: "a", concurrencyToken: 12 }).success).toBe(true);
    expect(await calls.get("forms--update-thing")!({ id: "a", concurrencyToken: 12 }, {})).toEqual({
      args: { id: "a", concurrencyToken: "12", patched: true },
      client: "forms-client",
    });
    expect(configs.get("forms--plain")!.description).toBe("[Forms] Plain.");
    expect(await calls.get("forms--plain")!({}, {})).toBe("plain");
  });
});
