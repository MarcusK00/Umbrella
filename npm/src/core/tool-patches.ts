import { z, type ZodRawShape, type ZodType } from "zod";

/** A product tool's handler as Umbrella registers it: parsed arguments first, the MCP request context second. */
export type ToolHandler = (args: Record<string, unknown>, extra?: unknown) => unknown;

export interface ToolPatchContext {
  /** The product's API client factory. A patched handler runs inside the client context, so this is the product's client. */
  createApiClient: () => unknown;
  /** The top-level input field names of the tool, after the input patches. */
  inputKeys: readonly string[];
}

/**
 * A fix Umbrella applies to one product tool when it registers it, for a product package bug that Umbrella works
 * around instead of waiting for a package release. Each part is optional and receives what the package defined.
 */
export interface ToolPatch {
  description?: (description: string) => string;
  inputSchema?: (shape: ZodRawShape) => ZodRawShape;
  /** Wraps the handler. Throwing is not needed for errors: return the original handler's result or call it as a fallback. */
  handler?: (original: ToolHandler, ctx: ToolPatchContext) => ToolHandler;
}

const CONCURRENCY_TOKEN = "concurrencyToken";

/**
 * Forms update tools take `concurrencyToken` as a nullable string. The token is all digits (for example
 * "63930582072163"), and some AI clients send such a value as a JSON number, which the string schema rejects.
 * Accept a number too and pass it on as the string the API expects.
 */
export const numericConcurrencyTokenPatch: ToolPatch = {
  inputSchema: (shape) => {
    const field = shape[CONCURRENCY_TOKEN] as ZodType | undefined;
    if (!field) return shape;
    const widened = z.union([z.string(), z.number()]).nullable().optional();
    return { ...shape, [CONCURRENCY_TOKEN]: field.description ? widened.describe(field.description) : widened };
  },
  handler: (original) => (args, extra) => {
    const token = args[CONCURRENCY_TOKEN];
    return original(typeof token === "number" ? { ...args, [CONCURRENCY_TOKEN]: String(token) } : args, extra);
  },
};

/** Patches every tool gets, whatever its product; each one leaves a tool without the field it fixes unchanged. */
export function generalPatches(inputSchema: ZodRawShape | undefined): ToolPatch[] {
  return inputSchema && CONCURRENCY_TOKEN in inputSchema ? [numericConcurrencyTokenPatch] : [];
}

export interface PatchedTool {
  description: string;
  inputSchema: ZodRawShape | undefined;
  handler: ToolHandler;
}

/** Applies the patches in order. A tool without patches comes back as it was. */
export function applyToolPatches(
  tool: { description: string; inputSchema?: ZodRawShape; handler: ToolHandler },
  patches: readonly ToolPatch[],
  createApiClient: () => unknown,
): PatchedTool {
  let { description, inputSchema, handler } = tool;
  for (const patch of patches) {
    if (patch.description) description = patch.description(description);
    if (patch.inputSchema && inputSchema) inputSchema = patch.inputSchema(inputSchema);
  }
  const ctx: ToolPatchContext = { createApiClient, inputKeys: Object.keys(inputSchema ?? {}) };
  for (const patch of patches) {
    if (patch.handler) handler = patch.handler(handler, ctx);
  }
  return { description, inputSchema, handler };
}
