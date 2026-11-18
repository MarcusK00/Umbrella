import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkPackageInstalled, checkPackageMajor, findPackageDir, hasNestedSdkCopy, installedPackageVersion } from "../sdk-instance.js";

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

  it("reports a product package that is not installed alongside the server", () => {
    const missing = (): string => {
      throw Object.assign(new Error("Cannot find package"), { code: "ERR_MODULE_NOT_FOUND" });
    };
    expect(checkPackageInstalled("@x/product", "X Product", missing)).toBe(
      "@x/product is not installed with umbrella-mcp, so X Product tools are not available.",
    );
  });

  it("accepts a product package that resolves", () => {
    expect(checkPackageInstalled("@x/product", "X Product", () => "file:///x/collections.js")).toBeNull();
  });

  it("rethrows resolution errors other than a missing package", () => {
    const broken = (): string => {
      throw new Error("boom");
    };
    expect(() => checkPackageInstalled("@x/product", "X Product", broken)).toThrow("boom");
  });
});

describe("package major check", () => {
  it("reads the installed version from the package's package.json", () => {
    const { dir, entry } = fakePackage(false);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@x/product", version: "18.1.11" }));
    expect(installedPackageVersion("@x/product", () => pathToFileURL(entry).href)).toBe("18.1.11");
  });

  it("returns null when the version can't be read", () => {
    const { entry } = fakePackage(false);
    expect(installedPackageVersion("@x/product", () => pathToFileURL(entry).href)).toBeNull();
    expect(installedPackageVersion("@x/product", () => { throw new Error("missing"); })).toBeNull();
  });

  it("accepts a package for the expected major, or one whose version can't be read", () => {
    expect(checkPackageMajor("@x/product", "X Product", "17", () => "17.6.13")).toBeNull();
    expect(checkPackageMajor("@x/product", "X Product", "17", () => null)).toBeNull();
  });

  it("reports a package for another major", () => {
    expect(checkPackageMajor("@x/product", "X Product", "17", () => "18.1.11")).toBe(
      "@x/product 18.1.11 is installed, but this umbrella-mcp is for Umbraco 17, so X Product tools may not match the site. Reinstall umbrella-mcp's dependencies (npm ci).",
    );
  });
});
