import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createToolAnnotations,
  registerToolCollection,
  shouldIncludeTool,
  type CollectionConfiguration,
} from "@umbraco-cms/mcp-server-sdk";
import { bindClient } from "./client-context.js";
import type { LoadedModule, McpProductModule } from "./module-contract.js";
import { describeTool } from "./routing.js";

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
}

export function registerModuleTools(
  ctx: RegistrationContext,
  module: McpProductModule,
  loaded: LoadedModule,
  filter: CollectionConfiguration,
): number {
  let count = 0;
  for (const collection of loaded.collections) {
    const collectionName = collection.metadata.name;
    for (const tool of collection.tools(ctx.user)) {
      if (tool.enabled && !tool.enabled(ctx.user)) continue;
      if (!shouldIncludeTool(tool, { collectionName, config: filter })) continue;

      const name = `${module.toolPrefix}${tool.name}`;
      const owner = ctx.registered.get(name);
      if (owner) throw new DuplicateToolNameError(name, owner, module.id);
      ctx.registered.set(name, module.id);
      registerToolCollection(name, `${module.id}:${collectionName}`);

      ctx.server.registerTool(
        name,
        {
          description: describeTool(module, tool.description),
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: createToolAnnotations(tool),
        },
        bindClient(loaded.createApiClient, tool.handler as (...args: unknown[]) => unknown) as ToolCallback<any>,
      );
      count++;
    }
  }
  return count;
}
