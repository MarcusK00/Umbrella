import type { McpProductModule } from "../../core/module-contract.js";

/** Node reports a missing package as ERR_MODULE_NOT_FOUND; Jest's resolver as MODULE_NOT_FOUND. */
const MISSING = new Set(["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]);

/**
 * Ids of modules whose package is not installed, but only in CI (`CI=true`). CI runs without local-only product
 * tarballs (today: Engage), so the contract tests that load a module skip those. Locally nothing is skipped, so a
 * missing package still fails the tests.
 */
export function modulesSkippedInCi(
  mods: readonly McpProductModule[],
  env: Record<string, string | undefined>,
  resolve: (specifier: string) => string,
): Set<string> {
  const skipped = new Set<string>();
  if (env.CI !== "true") return skipped;
  for (const mod of mods) {
    try {
      resolve(`${mod.packageName}/collections`);
    } catch (error) {
      if (!MISSING.has((error as { code?: string }).code ?? "")) throw error;
      skipped.add(mod.id);
    }
  }
  return skipped;
}
