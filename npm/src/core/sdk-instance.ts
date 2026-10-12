import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function findPackageDir(entryFilePath: string, packageName: string): string | null {
  let dir = dirname(entryFilePath);
  while (true) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        if ((JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name === packageName) return dir;
      } catch {
        // unreadable package.json: keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function hasNestedSdkCopy(packageDir: string): boolean {
  return existsSync(join(packageDir, "node_modules", "@umbraco-cms", "mcp-server-sdk"));
}

/** Returns an issue message when the product would run on its own toolkit copy, else null. */
export function checkSingleSdk(packageName: string): string | null {
  const entry = fileURLToPath(import.meta.resolve(`${packageName}/collections`));
  const dir = findPackageDir(entry, packageName);
  if (dir && hasNestedSdkCopy(dir)) {
    return `${packageName} has its own copy of @umbraco-cms/mcp-server-sdk (toolkit version mismatch); module skipped.`;
  }
  return null;
}

/**
 * Returns an issue message when a product package is not installed with the server (for example a product that
 * is a local-tarball devDependency until a release exporting `createApiClient` is published), else null.
 */
export function checkPackageInstalled(
  packageName: string,
  displayName: string,
  resolve: (specifier: string) => string = (specifier) => import.meta.resolve(specifier),
): string | null {
  try {
    resolve(`${packageName}/collections`);
    return null;
  } catch (error) {
    if ((error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND") throw error;
    return `${packageName} is not installed with umbrella-mcp, so ${displayName} tools are not available.`;
  }
}
