import type { McpProductModule } from "../../core/module-contract.js";

/** Node reports a missing package as ERR_MODULE_NOT_FOUND; Jest's resolver as MODULE_NOT_FOUND. */
const MISSING = new Set(["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]);

/**
 * Ids of modules whose package CI removed before installing (`CI_ABSENT_PACKAGES`, comma-separated, set in ci.yml
 * for a product that is only a local tarball; none today) and that is indeed not installed. Only when `CI=true`.
 * Any other missing package, locally or in CI, still fails the contract tests.
 */
export function modulesSkippedInCi(
  mods: readonly McpProductModule[],
  env: Record<string, string | undefined>,
  resolve: (specifier: string) => string,
): Set<string> {
  const skipped = new Set<string>();
  if (env.CI !== "true") return skipped;
  const absent = new Set((env.CI_ABSENT_PACKAGES ?? "").split(",").map((p) => p.trim()));
  for (const mod of mods) {
    if (!absent.has(mod.packageName)) continue;
    try {
      resolve(`${mod.packageName}/collections`);
    } catch (error) {
      if (!MISSING.has((error as { code?: string }).code ?? "")) throw error;
      skipped.add(mod.id);
    }
  }
  return skipped;
}
