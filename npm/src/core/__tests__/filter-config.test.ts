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
});
