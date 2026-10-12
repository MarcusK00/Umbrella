import type { ToolCollectionExport, ToolModeDefinition } from "@umbraco-cms/mcp-server-sdk";

/** What a product package's `./collections` entry point provides once loaded. */
export interface LoadedModule {
  collections: ToolCollectionExport[];
  allModes: ToolModeDefinition[];
  allModeNames: readonly string[];
  allSliceNames: readonly string[];
  /** The product's Orval API client factory. Bound per tool call by the client context. */
  createApiClient: () => unknown;
}

/** One HQ product. Adding a product = one file implementing this + one entry in modules/index.ts. */
export interface McpProductModule {
  /** Matches the .NET detector Id. Lowercase, e.g. "forms". */
  id: string;
  displayName: string;
  /** Always `${id}--`. Applied to every tool name. */
  toolPrefix: string;
  /** npm package that provides `./collections`, e.g. "@umbraco-forms/mcp-dev". */
  packageName: string;
  /** Product major this release line supports, e.g. "17". */
  expectedMajor: string;
  /** One sentence starting with the display name: what this product is. Used in routing instructions. */
  description: string;
  /** Short phrases for the requests this product handles. Disambiguate words shared with other products here. */
  useWhen: string[];
  /** Collections that stay off until the site or the env switches them on. Must exist in the package. */
  defaultDisabledCollections?: string[];
  /** Required modules load even without capabilities (CMS only). */
  required?: boolean;
  /** Dynamic import so absent products are never loaded. */
  load(): Promise<LoadedModule>;
}
