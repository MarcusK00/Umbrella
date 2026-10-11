import { buildModuleFilterInput } from "../filter-config.js";

describe("buildModuleFilterInput", () => {
  const env = {
    UMBRACO_TOOL_MODES: "content, forms:forms, engage:analytics",
    UMBRACO_INCLUDE_TOOL_COLLECTIONS: "automate:*",
    UMBRACO_EXCLUDE_TOOLS: "delete-document, forms:delete-form",
    UMBRACO_INCLUDE_SLICES: "read,list",
  };

  it("unprefixed entries apply to the default (CMS) module only", () => {
    const cms = buildModuleFilterInput(env, "cms", true);
    expect(cms.toolModes).toEqual(["content"]);
    expect(cms.excludeTools).toEqual(["delete-document"]);
  });

  it("prefixed entries apply to their module, with the prefix stripped", () => {
    const forms = buildModuleFilterInput(env, "forms", false);
    expect(forms.toolModes).toEqual(["forms"]);
    expect(forms.excludeTools).toEqual(["delete-form"]);
  });

  it("module:* means no restriction for that list", () => {
    expect(buildModuleFilterInput(env, "automate", false).includeToolCollections).toBeUndefined();
  });

  it("slices apply to every module", () => {
    expect(buildModuleFilterInput(env, "automate", false).includeSlices).toEqual(["read", "list"]);
    expect(buildModuleFilterInput(env, "cms", true).includeSlices).toEqual(["read", "list"]);
  });

  // Review Focus 5
  it("ignores entries for unknown or other modules", () => {
    const automate = buildModuleFilterInput(env, "automate", false);
    expect(automate.toolModes).toBeUndefined();
    expect(automate.excludeTools).toBeUndefined();
  });

  it("returns an empty config when no vars are set", () => {
    expect(buildModuleFilterInput({}, "cms", true)).toEqual({});
  });

  it("maps UMBRACO_READONLY=true (case-insensitive) to readonly on every module", () => {
    expect(buildModuleFilterInput({ UMBRACO_READONLY: "true" }, "cms", true).readonly).toBe(true);
    expect(buildModuleFilterInput({ UMBRACO_READONLY: "TRUE" }, "forms", false).readonly).toBe(true);
    expect(buildModuleFilterInput({ UMBRACO_READONLY: "false" }, "cms", true).readonly).toBeUndefined();
    expect(buildModuleFilterInput({}, "cms", true).readonly).toBeUndefined();
  });

  it("accepts <moduleId>--<tool> in include/exclude tool lists and routes it to that module", () => {
    const e = { UMBRACO_EXCLUDE_TOOLS: "cms--delete-document, forms--delete-form", UMBRACO_INCLUDE_TOOLS: "forms--list-forms" };
    expect(buildModuleFilterInput(e, "cms", true).excludeTools).toEqual(["delete-document"]);
    expect(buildModuleFilterInput(e, "forms", false).excludeTools).toEqual(["delete-form"]);
    expect(buildModuleFilterInput(e, "forms", false).includeTools).toEqual(["list-forms"]);
    expect(buildModuleFilterInput(e, "cms", true).includeTools).toBeUndefined();
    expect(buildModuleFilterInput(e, "automate", false).includeTools).toBeUndefined();
  });

  it("does not treat -- as a module prefix in other lists", () => {
    const e = { UMBRACO_INCLUDE_TOOL_COLLECTIONS: "forms--x" };
    expect(buildModuleFilterInput(e, "cms", true).includeToolCollections).toEqual(["forms--x"]);
  });

  it("skips empty items such as 'forms:'", () => {
    const e = { UMBRACO_EXCLUDE_TOOLS: "forms:, ,cms--" };
    expect(buildModuleFilterInput(e, "forms", false).excludeTools).toBeUndefined();
    expect(buildModuleFilterInput(e, "cms", true).excludeTools).toBeUndefined();
  });
});
