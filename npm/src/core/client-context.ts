import { AsyncLocalStorage } from "node:async_hooks";
import { configureApiClient } from "@umbraco-cms/mcp-server-sdk";

/**
 * The toolkit keeps ONE global API client provider. Several products share a process here, so the
 * provider reads the current product's factory from AsyncLocalStorage, which follows each call across awaits.
 */
const clientContext = new AsyncLocalStorage<() => unknown>();

export function installClientContext(defaultFactory: () => unknown): void {
  configureApiClient(() => (clientContext.getStore() ?? defaultFactory)());
}

export function bindClient<A extends unknown[], R>(
  factory: () => unknown,
  handler: (...args: A) => R,
): (...args: A) => R {
  return (...args: A) => clientContext.run(factory, () => handler(...args));
}
