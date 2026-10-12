import type { McpProductModule } from "../../core/module-contract.js";
import { modulesSkippedInCi } from "./skipped-modules.js";

const mods = [
  { id: "cms", packageName: "@a/cms" },
  { id: "engage", packageName: "@a/engage" },
] as McpProductModule[];

function missingEngage(code: string) {
  return (specifier: string) => {
    if (specifier === "@a/engage/collections") throw Object.assign(new Error("x"), { code });
    return `file:///${specifier}`;
  };
}

describe("modulesSkippedInCi", () => {
  it("skips a missing package in CI", () => {
    expect(modulesSkippedInCi(mods, { CI: "true" }, missingEngage("MODULE_NOT_FOUND"))).toEqual(new Set(["engage"]));
  });

  it("treats Node's ERR_MODULE_NOT_FOUND as missing too", () => {
    expect(modulesSkippedInCi(mods, { CI: "true" }, missingEngage("ERR_MODULE_NOT_FOUND"))).toEqual(new Set(["engage"]));
  });

  it("does not skip outside CI", () => {
    let calls = 0;
    const resolve = (s: string) => {
      calls++;
      return missingEngage("MODULE_NOT_FOUND")(s);
    };
    expect(modulesSkippedInCi(mods, {}, resolve)).toEqual(new Set());
    expect(calls).toBe(0);
  });

  it("rethrows other resolve errors", () => {
    expect(() => modulesSkippedInCi(mods, { CI: "true" }, missingEngage("EACCES"))).toThrow("x");
  });

  it("skips nothing when every package resolves", () => {
    expect(modulesSkippedInCi(mods, { CI: "true" }, (s) => `file:///${s}`)).toEqual(new Set());
  });
});
