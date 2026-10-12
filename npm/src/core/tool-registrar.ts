import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createToolAnnotations,
  registerToolCollection,
  shouldIncludeTool,
  type CollectionConfiguration,
} from "@umbraco-cms/mcp-server-sdk";
import type { ZodRawShape, ZodType } from "zod";
import { bindClient } from "./client-context.js";
import type { LoadedModule, McpProductModule } from "./module-contract.js";
import { isDestructive } from "./destructive.js";
import { buildToolNameIndex, describeTool, prefixToolReferences, type ToolNameIndex } from "./routing.js";

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

export function registerModuleTools(
  ctx: RegistrationContext,
  module: McpProductModule,
  loaded: LoadedModule,
  filter: CollectionConfiguration,
  options: { excludeDestructive?: boolean } = {},
): { registered: number; destructiveRemoved: number } {
  let count = 0;
  let destructiveRemoved = 0;
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

      const name = `${module.toolPrefix}${tool.name}`;
      const owner = ctx.registered.get(name);
      if (owner) throw new DuplicateToolNameError(name, owner, module.id);
      ctx.registered.set(name, module.id);
      registerToolCollection(name, `${module.id}:${collectionName}`);

      ctx.server.registerTool(
        name,
        {
          description: describeTool(module, references(tool.description)),
          inputSchema: tool.inputSchema && prefixInputReferences(tool.inputSchema, references),
          outputSchema: tool.outputSchema,
          annotations: createToolAnnotations(tool),
        },
        bindClient(loaded.createApiClient, tool.handler as (...args: unknown[]) => unknown) as ToolCallback<any>,
      );
      count++;
    }
  }
  return { registered: count, destructiveRemoved };
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
