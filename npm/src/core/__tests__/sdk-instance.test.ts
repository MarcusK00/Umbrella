import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPackageDir, hasNestedSdkCopy } from "../sdk-instance.js";

function fakePackage(nested: boolean): { dir: string; entry: string } {
  const root = mkdtempSync(join(tmpdir(), "umb-mcp-"));
  const dir = join(root, "node_modules", "@x", "product");
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@x/product" }));
  writeFileSync(join(dir, "dist", "collections.js"), "");
  if (nested) mkdirSync(join(dir, "node_modules", "@umbraco-cms", "mcp-server-sdk"), { recursive: true });
  return { dir, entry: join(dir, "dist", "collections.js") };
}

describe("sdk instance check", () => {
  it("finds the package dir by walking up to the matching package.json", () => {
    const { dir, entry } = fakePackage(false);
    expect(findPackageDir(entry, "@x/product")).toBe(dir);
  });

  it("returns null when no matching package.json exists", () => {
    const { entry } = fakePackage(false);
    expect(findPackageDir(entry, "@x/other")).toBeNull();
  });

  it("detects a nested toolkit copy", () => {
    expect(hasNestedSdkCopy(fakePackage(true).dir)).toBe(true);
    expect(hasNestedSdkCopy(fakePackage(false).dir)).toBe(false);
  });
});
