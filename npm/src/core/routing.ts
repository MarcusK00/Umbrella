import type { McpProductModule } from "./module-contract.js";

export const HEALTH_TOOL_NAME = "get-mcp-health";

/** Every tool description starts with its product so keyword-based tool search finds the right product. */
export function describeTool(module: Pick<McpProductModule, "displayName">, description: string): string {
  return `[${module.displayName}] ${description}`;
}

/** Unprefixed tool name -> every registered (prefixed) name it belongs to. */
export type ToolNameIndex = Map<string, string[]>;

export function buildToolNameIndex(
  entries: Array<{ module: Pick<McpProductModule, "toolPrefix">; toolNames: Iterable<string> }>,
): ToolNameIndex {
  const index: ToolNameIndex = new Map();
  for (const { module, toolNames } of entries) {
    for (const name of toolNames) {
      const names = index.get(name) ?? [];
      names.push(`${module.toolPrefix}${name}`);
      index.set(name, names);
    }
  }
  return index;
}

// A hyphenated lowercase word that is not part of a longer one, so `forms--list-forms` and `get-form-by-id` never match `list-forms` or `get-form`.
const TOOL_NAME_MENTION = /(?<![\w-])[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?![\w-])/g;

/**
 * Product descriptions mention sibling tools by their unprefixed names ("use list-forms first"), which
 * clients can't find. Points each mention at the registered name: the module's own tool first, otherwise
 * the only product that has it. Ambiguous names and ordinary hyphenated words are left alone.
 */
export function prefixToolReferences(text: string, module: Pick<McpProductModule, "toolPrefix">, index: ToolNameIndex): string {
  return text.replace(TOOL_NAME_MENTION, (word) => {
    const names = index.get(word);
    if (!names) return word;
    const own = `${module.toolPrefix}${word}`;
    if (names.includes(own)) return own;
    return names.length === 1 ? names[0] : word;
  });
}

/**
 * Routing table sent as MCP server `instructions` (most clients fold it into the system prompt),
 * so the agent chooses a product before looking through tools. Only pass modules that actually loaded.
 */
export function buildRoutingInstructions(modules: McpProductModule[], extras: Array<string | null> = []): string {
  const routing = [
    "This server exposes tools for several Umbraco products. Every product tool name starts with its product prefix.",
    "Pick the product from the user's request first, then only use tools with that prefix:",
    "",
    ...modules.map((m) => `- \`${m.toolPrefix}\` ${m.description} Use for: ${m.useWhen.join("; ")}.`),
    "",
    "Read a tool's input schema before the first call. Never call a tool with empty or guessed arguments to see what it needs: write tools change the site.",
    "",
    `If the request does not clearly match one product, or product tools seem missing, call ${HEALTH_TOOL_NAME}.`,
  ].join("\n");
  return [routing, ...extras.filter((e): e is string => Boolean(e))].join("\n\n");
}
