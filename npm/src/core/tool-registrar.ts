import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createToolAnnotations,
  getRegisteredOutputSchema,
  registerToolCollection,
  shouldIncludeTool,
  useDraft202012ToolSchemas,
  type CollectionConfiguration,
  type ToolDefinition,
} from "@umbraco-cms/mcp-server-sdk";
import type { ZodRawShape, ZodType } from "zod";
import { bindClient } from "./client-context.js";
import type { LoadedModule, McpProductModule } from "./module-contract.js";
import { isDestructive } from "./destructive.js";
import { buildToolNameIndex, describeTool, prefixToolReferences, type ToolNameIndex } from "./routing.js";
import { applyToolPatches, generalPatches, type ToolHandler } from "./tool-patches.js";

export class DuplicateToolNameError extends Error {
  constructor(public readonly toolName: string, existingModule: string, newModule: string) {
    super(`Tool "${toolName}" is registered by both "${existingModule}" and "${newModule}".`);
    this.name = "DuplicateToolNameError";
  }
}

export interface RegistrationContext {
  server: { registerTool: McpServer["registerTool"] };
  user: unknown;
  /** final tool name -> owning module id */
  registered: Map<string, string>;
  /** Every loaded module's tool names, so descriptions can point at other products' tools too. */
  toolNames?: ToolNameIndex;
}

export interface PreparedTool {
  name: string;
  config: {
    description: string;
    inputSchema: ZodRawShape | undefined;
    outputSchema: ToolDefinition<any, any>["outputSchema"];
    annotations: ReturnType<typeof createToolAnnotations>;
  };
  handler: ToolHandler;
}

/** Builds the registered name, patched config and handler for one tool without touching a server. */
export function prepareToolRegistration(
  module: McpProductModule,
  loaded: Pick<LoadedModule, "createApiClient">,
  tool: ToolDefinition<any, any>,
  references: (text: string) => string,
): PreparedTool {
  const patches = [...generalPatches(tool.inputSchema), ...(module.toolPatches?.[tool.name] ? [module.toolPatches[tool.name]] : [])];
  const patched = applyToolPatches(
    { description: tool.description ?? "", inputSchema: tool.inputSchema, handler: tool.handler as ToolHandler },
    patches,
    loaded.createApiClient,
  );
  return {
    name: `${module.toolPrefix}${tool.name}`,
    config: {
      description: describeTool(module, references(patched.description)),
      inputSchema: patched.inputSchema && prefixInputReferences(patched.inputSchema, references),
      outputSchema: getRegisteredOutputSchema(tool),
      annotations: createToolAnnotations(tool),
    },
    handler: patched.handler,
  };
}

/**
 * Measures the UTF-8 byte length of each tool entry as `tools/list` sends it (after Draft 2020-12 schema conversion).
 * Uses an in-memory McpServer and `useDraft202012ToolSchemas` so sizes match runtime output exactly.
 */
export function measureToolListSizes(
  entries: ReadonlyArray<Pick<PreparedTool, "name" | "config">>,
): Map<string, number> {
  const sizes = new Map<string, number>();
  if (entries.length === 0) return sizes;

  const measureServer = new McpServer({ name: "umbrella-measure", version: "0.0.0" });
  const dummyHandler: ToolCallback<ZodRawShape> = async () => ({ content: [] });
  for (const { name, config } of entries) {
    measureServer.registerTool(name, config, dummyHandler);
  }

  let listHandler: (() => { tools: Array<{ name?: string }> }) | undefined;
  const originalSet = measureServer.server.setRequestHandler.bind(measureServer.server);
  measureServer.server.setRequestHandler = ((schema: unknown, handler: () => { tools: Array<{ name?: string }> }) => {
    if (schema === ListToolsRequestSchema) listHandler = handler;
    return originalSet(schema as never, handler as never);
  }) as typeof measureServer.server.setRequestHandler;
  useDraft202012ToolSchemas(measureServer);

  const response = listHandler?.();
  for (const wireTool of response?.tools ?? []) {
    if (typeof wireTool.name === "string") {
      sizes.set(wireTool.name, Buffer.byteLength(JSON.stringify(wireTool), "utf8"));
    }
  }
  return sizes;
}

export function registerModuleTools(
  ctx: RegistrationContext,
  module: McpProductModule,
  loaded: LoadedModule,
  filter: CollectionConfiguration,
  options: {
    excludeDestructive?: boolean;
    disabledTools?: ReadonlySet<string>;
    onRegister?: (entry: { name: string; collectionName: string; config: PreparedTool["config"] }) => void;
  } = {},
): { registered: number; destructiveRemoved: number; disabledRemoved: string[] } {
  let count = 0;
  let destructiveRemoved = 0;
  const disabledRemoved: string[] = [];
  const ownIndex = buildToolNameIndex([{ module, toolNames: listToolNames(loaded, ctx.user) }]);
  const index = new Map([...(ctx.toolNames ?? []), ...ownIndex]);
  const references = (text: string) => prefixToolReferences(text, module, index);
  for (const collection of loaded.collections) {
    const collectionName = collection.metadata.name;
    for (const tool of collection.tools(ctx.user)) {
      if (tool.enabled && !tool.enabled(ctx.user)) continue;
      if (!shouldIncludeTool(tool, { collectionName, config: filter })) continue;
      if (options.excludeDestructive && isDestructive(tool)) {
        destructiveRemoved++;
        continue;
      }
      // After the group filter and the level, so only a tool that would have been offered is counted, and an include list can't bring it back.
      if (options.disabledTools?.has(tool.name)) {
        disabledRemoved.push(tool.name);
        continue;
      }

      const prepared = prepareToolRegistration(module, loaded, tool, references);
      const owner = ctx.registered.get(prepared.name);
      if (owner) throw new DuplicateToolNameError(prepared.name, owner, module.id);
      ctx.registered.set(prepared.name, module.id);
      registerToolCollection(prepared.name, `${module.id}:${collectionName}`);
      options.onRegister?.({ name: prepared.name, collectionName, config: prepared.config });

      ctx.server.registerTool(
        prepared.name,
        prepared.config,
        bindClient(loaded.createApiClient, prepared.handler as (...args: unknown[]) => unknown) as ToolCallback<ZodRawShape>,
      );
      count++;
    }
  }
  return { registered: count, destructiveRemoved, disabledRemoved };
}

/** The unprefixed names of every tool a module provides, before filters. */
export function listToolNames(loaded: LoadedModule, user: unknown): string[] {
  return loaded.collections.flatMap((collection) => collection.tools(user).map((tool) => tool.name));
}

/**
 * Applies `references` to each top-level input field's description. Nested descriptions are left as they are.
 * Product tools are built with classic zod, whose schemas carry `description` and `describe()`.
 */
function prefixInputReferences(shape: ZodRawShape, references: (text: string) => string): ZodRawShape {
  return Object.fromEntries(
    Object.entries(shape).map(([key, field]) => {
      const { description } = field as ZodType;
      const updated = description && references(description);
      return [key, updated && updated !== description ? (field as ZodType).describe(updated) : field];
    }),
  );
}
