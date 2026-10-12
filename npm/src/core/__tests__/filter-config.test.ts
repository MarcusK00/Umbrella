import { createCollectionConfigLoader, shouldIncludeTool } from "@umbraco-cms/mcp-server-sdk";
import { buildEffectiveFilterInput, buildModuleFilterInput, envSetsCollectionFilter } from "../filter-config.js";

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

describe("envSetsCollectionFilter", () => {
  it.each([
    ["forms exclude", { UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "forms:record" }, "forms", false, true],
    ["forms include", { UMBRACO_INCLUDE_TOOL_COLLECTIONS: "forms:form" }, "forms", false, true],
    ["forms:*", { UMBRACO_INCLUDE_TOOL_COLLECTIONS: "forms:*" }, "forms", false, true],
    ["unprefixed counts for CMS", { UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "log-viewer" }, "cms", true, true],
    ["unprefixed does not count for forms", { UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "log-viewer" }, "forms", false, false],
    ["another module only", { UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "engage:persona" }, "forms", false, false],
    // Review Focus 3
    ["empty item forms:", { UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "forms:, " }, "forms", false, false],
    ["tool-level lists", { UMBRACO_EXCLUDE_TOOLS: "forms:delete-form", UMBRACO_INCLUDE_TOOLS: "forms--list-forms" }, "forms", false, false],
    ["modes", { UMBRACO_TOOL_MODES: "forms:forms" }, "forms", false, false],
    ["nothing set", {}, "forms", false, false],
  ])("%s", (_label, env, id, isDefault, expected) => {
    expect(envSetsCollectionFilter(env as NodeJS.ProcessEnv, id, isDefault)).toBe(expected);
  });
});

describe("buildEffectiveFilterInput", () => {
  it("turns the site list into excludeToolCollections when env is silent", () => {
    const r = buildEffectiveFilterInput({ UMBRACO_EXCLUDE_TOOLS: "forms:delete-form" }, "forms", false, ["prevalue-source"]);
    expect(r).toEqual({ config: { excludeTools: ["delete-form"], excludeToolCollections: ["prevalue-source"] }, siteSettingsIgnored: false });
  });

  it("ignores the site list when env sets collection filters for the module", () => {
    const r = buildEffectiveFilterInput({ UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "forms:record" }, "forms", false, ["prevalue-source"]);
    expect(r).toEqual({ config: { excludeToolCollections: ["record"] }, siteSettingsIgnored: true });
  });

  it("flags ignored even when the site disabled nothing, so the dashboard can warn", () => {
    expect(buildEffectiveFilterInput({ UMBRACO_INCLUDE_TOOL_COLLECTIONS: "forms:*" }, "forms", false, []).siteSettingsIgnored).toBe(true);
  });

  it("leaves the config unchanged when the site disabled nothing", () => {
    expect(buildEffectiveFilterInput({}, "cms", true, [])).toEqual({ config: {}, siteSettingsIgnored: false });
  });

  const include = (config: ReturnType<typeof buildEffectiveFilterInput>["config"], name: string, collectionName: string) =>
    shouldIncludeTool(
      { name, slices: ["read"] },
      { collectionName, config: createCollectionConfigLoader({ modeRegistry: [], allModeNames: [], allSliceNames: ["read"] }).loadFromConfig(config) },
    );

  it("removes the disabled collection's tools and keeps the others", () => {
    const { config } = buildEffectiveFilterInput({}, "forms", false, ["prevalue-source"]);
    expect(include(config, "get-prevalue-source", "prevalue-source")).toBe(false);
    expect(include(config, "list-forms", "form")).toBe(true);
  });

  // Review Focus 2
  it("a disabled name the module does not have changes nothing", () => {
    const { config } = buildEffectiveFilterInput({}, "forms", false, ["no-such-collection"]);
    expect(include(config, "list-forms", "form")).toBe(true);
  });

  it("an env tool allow-list still wins over a site-disabled collection", () => {
    const { config } = buildEffectiveFilterInput({ UMBRACO_INCLUDE_TOOLS: "forms--get-prevalue-source" }, "forms", false, ["prevalue-source"]);
    expect(include(config, "get-prevalue-source", "prevalue-source")).toBe(true);
  });
});
