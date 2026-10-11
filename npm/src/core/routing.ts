import type { McpProductModule } from "./module-contract.js";

export const HEALTH_TOOL_NAME = "get-mcp-health";

/** Every tool description starts with its product so keyword-based tool search finds the right product. */
export function describeTool(module: Pick<McpProductModule, "displayName">, description: string): string {
  return `[${module.displayName}] ${description}`;
}

/**
 * Routing table sent as MCP server `instructions` (most clients fold it into the system prompt),
 * so the agent chooses a product before looking through tools. Only pass modules that actually loaded.
 */
export function buildRoutingInstructions(modules: McpProductModule[], extras: Array<string | null> = []): string {
  const routing = [
    "This server exposes tools for several Umbraco products on one site. Every tool name starts with its product prefix.",
    "Pick the product from the user's request first, then only use tools with that prefix:",
    "",
    ...modules.map((m) => `- \`${m.toolPrefix}\` ${m.description} Use for: ${m.useWhen.join("; ")}.`),
    "",
    `If the request does not clearly match one product, or product tools seem missing, call ${HEALTH_TOOL_NAME}.`,
  ].join("\n");
  return [routing, ...extras.filter((e): e is string => Boolean(e))].join("\n\n");
}
