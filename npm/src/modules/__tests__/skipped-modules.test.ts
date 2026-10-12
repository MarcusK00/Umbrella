import type { McpProductModule } from "../../core/module-contract.js";
import { modulesSkippedInCi } from "./skipped-modules.js";

const mods = [
  { id: "cms", packageName: "@a/cms" },
  { id: "engage", packageName: "@a/engage" },
] as McpProductModule[];

/** CI with the Engage package removed before install, the way ci.yml runs. */
const ci = { CI: "true", CI_ABSENT_PACKAGES: "@a/engage" };

function missing(packageName: string, code: string) {
  return (specifier: string) => {
    if (specifier === `${packageName}/collections`) throw Object.assign(new Error("x"), { code });
    return `file:///${specifier}`;
  };
}

describe("modulesSkippedInCi", () => {
  it("skips a missing package in CI", () => {
    expect(modulesSkippedInCi(mods, ci, missing("@a/engage", "MODULE_NOT_FOUND"))).toEqual(new Set(["engage"]));
  });

  it("treats Node's ERR_MODULE_NOT_FOUND as missing too", () => {
    expect(modulesSkippedInCi(mods, ci, missing("@a/engage", "ERR_MODULE_NOT_FOUND"))).toEqual(new Set(["engage"]));
  });

  it("does not skip outside CI", () => {
    let calls = 0;
    const resolve = (s: string) => {
      calls++;
      return missing("@a/engage", "MODULE_NOT_FOUND")(s);
    };
    expect(modulesSkippedInCi(mods, { CI_ABSENT_PACKAGES: "@a/engage" }, resolve)).toEqual(new Set());
    expect(calls).toBe(0);
  });

  it("does not skip a missing package that CI did not remove", () => {
    expect(modulesSkippedInCi(mods, ci, missing("@a/cms", "MODULE_NOT_FOUND"))).toEqual(new Set());
    expect(modulesSkippedInCi(mods, { CI: "true" }, missing("@a/engage", "MODULE_NOT_FOUND"))).toEqual(new Set());
  });

  it("rethrows other resolve errors", () => {
    expect(() => modulesSkippedInCi(mods, ci, missing("@a/engage", "EACCES"))).toThrow("x");
  });

  it("skips nothing when every package resolves", () => {
    expect(modulesSkippedInCi(mods, ci, (s) => `file:///${s}`)).toEqual(new Set());
  });
});
