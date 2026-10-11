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
