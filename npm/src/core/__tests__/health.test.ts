import type { CapabilitiesResult } from "../capabilities.js";
import { buildHealthReport, type HealthState, type ModuleRuntimeState } from "../health.js";
import type { McpProductModule } from "../module-contract.js";

const mod = (id: string, displayName: string, required = false): McpProductModule => ({
  id, displayName, toolPrefix: `${id}--`, packageName: `@x/${id}`, expectedMajor: "17", description: `${id} description`, useWhen: [`${id} requests`], required,
  load: async () => { throw new Error("unused"); },
});

const state = (capabilities: CapabilitiesResult, modules: ModuleRuntimeState[], forced: string[] = [], serverVersion = "17.0.0"): HealthState => ({
  capabilities, serverVersion, umbracoVersion: "17.7.0", versionCheckMessage: null, forcedModules: forced, modules, noDestructiveFromEnv: false,
});

const cmsLoaded: ModuleRuntimeState = {
  decision: { module: mod("cms", "Umbraco CMS", true), product: null, load: true, reason: "Required module." },
  loaded: true, toolCount: 300, issues: [],
};

describe("buildHealthReport", () => {
  it("reports a missing addon with an install hint", () => {
    const r = buildHealthReport(state({ kind: "no-addon" }, [cmsLoaded]));
    expect(r.addon).toEqual({ installed: false, version: null, status: "not-installed" });
    expect(r.notes.join(" ")).toMatch(/Install the Umbraco\.Community\.Umbrella NuGet package/);
    expect(r.umbraco).toEqual({ version: "17.7.0", versionCheck: "ok" });
  });

  it("reports the running server's version", () => {
    expect(buildHealthReport(state({ kind: "no-addon" }, [cmsLoaded], [], "17.0.0-alpha.1")).server).toEqual({ version: "17.0.0-alpha.1" });
  });

  it("notes when the running server is not the add-on's version, with the version to run", () => {
    const r = buildHealthReport(state(
      { kind: "ok", payload: { addonVersion: "17.0.0-alpha.2", products: [] } }, [cmsLoaded], [], "17.0.0-alpha.1",
    ));
    expect(r.notes).toContain(
      "umbrella-mcp 17.0.0-alpha.1 is running, but the site's Umbraco.Community.Umbrella add-on is 17.0.0-alpha.2. " +
      "The two are released together: set umbrella-mcp@17.0.0-alpha.2 in your MCP client config.",
    );
  });

  it("adds no version note when the server and the add-on have the same version", () => {
    const r = buildHealthReport(state({ kind: "ok", payload: { addonVersion: "17.0.0", products: [] } }, [cmsLoaded], [], "17.0.0"));
    expect(r.notes.join(" ")).not.toMatch(/is running, but/);
  });

  it("lists products with module and load state", () => {
    const forms = { id: "forms", displayName: "Umbraco Forms", installed: true, enabled: true, version: "17.6.1", issues: [] };
    const r = buildHealthReport(state(
      { kind: "ok", payload: { addonVersion: "17.0.0", products: [forms] } },
      [cmsLoaded, { decision: { module: mod("forms", "Umbraco Forms"), product: forms, load: true, reason: "ok" }, loaded: true, toolCount: 118, issues: [] }],
    ));
    expect(r.addon).toEqual({ installed: true, version: "17.0.0", status: "ok" });
    expect(r.products.find((p) => p.id === "forms")).toEqual({
      id: "forms", displayName: "Umbraco Forms", description: "forms description", installed: true, enabled: true, version: "17.6.1",
      hasModule: true, loaded: true, toolCount: 118, destructiveRemoved: 0, issues: [],
    });
  });

  it("notes a detected product with no module, and a module whose product is absent", () => {
    const engage = { id: "engage", displayName: "Umbraco Engage", installed: true, enabled: true, version: "17.0.0", issues: [] };
    const automateModule = mod("automate", "Umbraco Automate");
    const r = buildHealthReport(state(
      { kind: "ok", payload: { addonVersion: "17.0.0", products: [engage] } },
      [cmsLoaded, { decision: { module: automateModule, product: null, load: false, reason: "not installed" }, loaded: false, toolCount: 0, issues: [] }],
    ));
    expect(r.notes).toContain("Umbraco Engage is installed, but this MCP has no Umbraco Engage module yet.");
    expect(r.notes).toContain("There is a module for Umbraco Automate, but it is not installed on this site.");
    expect(r.products.find((p) => p.id === "engage")!.hasModule).toBe(false);
  });

  it("adds the decision reason to issues only when the module was not selected", () => {
    const forms = { id: "forms", displayName: "Umbraco Forms", installed: true, enabled: true, version: "17.6.1", issues: [] };
    const caps = { kind: "ok" as const, payload: { addonVersion: "17.0.0", products: [forms] } };
    const failed = buildHealthReport(state(caps, [cmsLoaded, {
      decision: { module: mod("forms", "Umbraco Forms"), product: forms, load: true, reason: "selected" },
      loaded: false, toolCount: 0, issues: ["Failed to load: boom"],
    }]));
    expect(failed.products.find((p) => p.id === "forms")!.issues).toEqual(["Failed to load: boom"]);
    const skipped = buildHealthReport(state(caps, [cmsLoaded, {
      decision: { module: mod("forms", "Umbraco Forms"), product: forms, load: false, reason: "disabled" },
      loaded: false, toolCount: 0, issues: [],
    }]));
    expect(skipped.products.find((p) => p.id === "forms")!.issues).toEqual(["disabled"]);
  });

  // Review Focus 4: unknown forced ids are reported, not thrown
  it("notes forced module ids that match no module", () => {
    const r = buildHealthReport(state({ kind: "no-addon" }, [cmsLoaded], ["engage"]));
    expect(r.forcedModules).toEqual(["engage"]);
    expect(r.notes).toContain('UMBRACO_MCP_MODULES lists "engage", but there is no module with that id.');
  });

  it("surfaces the version check message", () => {
    const s = state({ kind: "no-addon" }, [cmsLoaded]);
    s.versionCheckMessage = "Version mismatch: 18 vs 17";
    expect(buildHealthReport(s).umbraco.versionCheck).toBe("Version mismatch: 18 vs 17");
  });

  it("notes collections disabled in the backoffice", () => {
    const r = buildHealthReport(state({ kind: "ok", payload: { addonVersion: "17.0.0", products: [] } }, [{ ...cmsLoaded, siteDisabledCollections: ["log-viewer", "webhook"] }]));
    expect(r.notes).toContain("Umbraco CMS: tool groups disabled in the backoffice: log-viewer, webhook.");
  });

  const formsLoaded: ModuleRuntimeState = {
    decision: { module: mod("forms", "Umbraco Forms"), product: null, load: true, reason: "Installed." },
    loaded: true, toolCount: 100, issues: [],
  };

  it("notes default-off tool groups and points at the dashboard", () => {
    const caps = { kind: "ok" as const, payload: { addonVersion: "17.0.0", products: [] } };
    const r = buildHealthReport(state(caps, [{ ...formsLoaded, defaultDisabledCollections: ["umbraco-server", "acceptance-tests"] }]));
    expect(r.notes).toContain("Umbraco Forms: tool groups off by default: umbraco-server, acceptance-tests. Switch them on in the Umbrella dashboard.");
  });

  it("notes default-off tool groups without the add-on and points at the env var", () => {
    const r = buildHealthReport(state({ kind: "no-addon" }, [{ ...formsLoaded, defaultDisabledCollections: ["umbraco-server", "acceptance-tests"] }]));
    expect(r.notes).toContain("Umbraco Forms: tool groups off by default: umbraco-server, acceptance-tests. Set UMBRACO_INCLUDE_TOOL_COLLECTIONS=forms:* to switch them on.");
  });

  it("says nothing about defaults when none were applied", () => {
    const caps = { kind: "ok" as const, payload: { addonVersion: "17.0.0", products: [] } };
    expect(buildHealthReport(state(caps, [{ ...formsLoaded, defaultDisabledCollections: [] }])).notes.join(" ")).not.toMatch(/off by default/);
    expect(buildHealthReport(state(caps, [formsLoaded])).notes.join(" ")).not.toMatch(/off by default/);
  });

  it("notes when the environment overrides the backoffice settings", () => {
    const r = buildHealthReport(state({ kind: "ok", payload: { addonVersion: "17.0.0", products: [] } }, [{ ...cmsLoaded, siteDisabledCollections: ["log-viewer"], siteSettingsIgnored: true }]));
    expect(r.notes).toContain(
      "Umbraco CMS: the backoffice tool group settings are ignored because the environment sets collection filters for this module.",
    );
    expect(r.notes.join(" ")).not.toMatch(/disabled in the backoffice/);
  });

  it("says nothing about backoffice settings when the site has no add-on (there is no dashboard)", () => {
    const r = buildHealthReport(state({ kind: "no-addon" }, [{ ...cmsLoaded, siteSettingsIgnored: true, siteReadOnly: true }]));
    expect(r.notes.join(" ")).not.toMatch(/backoffice/);
  });

  it("notes a product set to read-only in the backoffice, also when the environment overrides its groups", () => {
    const caps = { kind: "ok" as const, payload: { addonVersion: "17.0.0", products: [] } };
    const note = "Umbraco CMS: only read-only tools, as set in the backoffice.";
    expect(buildHealthReport(state(caps, [{ ...cmsLoaded, siteReadOnly: true }])).notes).toContain(note);
    expect(buildHealthReport(state(caps, [{ ...cmsLoaded, siteReadOnly: true, siteSettingsIgnored: true }])).notes).toContain(note);
    expect(buildHealthReport(state(caps, [cmsLoaded])).notes.join(" ")).not.toMatch(/read-only/);
  });

  it("notes a product limited to non-destructive tools in the backoffice", () => {
    const caps = { kind: "ok" as const, payload: { addonVersion: "17.0.0", products: [] } };
    const forms: ModuleRuntimeState = {
      decision: { module: mod("forms", "Umbraco Forms"), product: null, load: true, reason: "ok" },
      loaded: true, toolCount: 80, issues: [], siteNoDestructive: true, destructiveRemoved: 10,
    };
    expect(buildHealthReport(state(caps, [forms])).notes).toContain("Umbraco Forms: no destructive tools (10 removed), as set in the backoffice.");
    expect(buildHealthReport(state(caps, [forms, { ...cmsLoaded, siteNoDestructive: false }])).notes.join(" ")).not.toMatch(/Umbraco CMS: no destructive/);
  });

  describe("settings set for the calling API user", () => {
    const caps = { kind: "ok" as const, payload: { addonVersion: "17.0.0", products: [] } };
    const forms: ModuleRuntimeState = {
      decision: { module: mod("forms", "Umbraco Forms"), product: null, load: true, reason: "ok" },
      loaded: true, toolCount: 80, issues: [], siteSettingsScope: "user",
    };

    it("words disabled tool groups for this API user", () => {
      const r = buildHealthReport(state(caps, [{ ...forms, siteDisabledCollections: ["media", "updates"] }]));
      expect(r.notes).toContain("Umbraco Forms: tool groups disabled in the backoffice for this API user: media, updates.");
      expect(r.notes.join(" ")).not.toMatch(/disabled in the backoffice: /);
    });

    it("words read-only for this API user", () => {
      const r = buildHealthReport(state(caps, [{ ...forms, siteReadOnly: true }]));
      expect(r.notes).toContain("Umbraco Forms: only read-only tools, as set in the backoffice for this API user.");
    });

    it("words no destructive tools for this API user", () => {
      const r = buildHealthReport(state(caps, [{ ...forms, siteNoDestructive: true, destructiveRemoved: 10 }]));
      expect(r.notes).toContain("Umbraco Forms: no destructive tools (10 removed), as set in the backoffice for this API user.");
    });

    it("keeps the site wording when the scope is site or absent", () => {
      const r = buildHealthReport(state(caps, [
        { ...forms, siteSettingsScope: "site", siteDisabledCollections: ["media"], siteReadOnly: true, siteNoDestructive: true, destructiveRemoved: 3 },
        { ...cmsLoaded, siteDisabledCollections: ["log-viewer"], siteReadOnly: true },
      ]));
      expect(r.notes).toContain("Umbraco Forms: tool groups disabled in the backoffice: media.");
      expect(r.notes).toContain("Umbraco Forms: only read-only tools, as set in the backoffice.");
      expect(r.notes).toContain("Umbraco Forms: no destructive tools (3 removed), as set in the backoffice.");
      expect(r.notes).toContain("Umbraco CMS: tool groups disabled in the backoffice: log-viewer.");
      expect(r.notes.join(" ")).not.toMatch(/for this API user/);
    });

    it("keeps the ignored-settings note unchanged under user scope", () => {
      const r = buildHealthReport(state(caps, [{ ...forms, siteDisabledCollections: ["media"], siteSettingsIgnored: true }]));
      expect(r.notes).toContain(
        "Umbraco Forms: the backoffice tool group settings are ignored because the environment sets collection filters for this module.",
      );
      expect(r.notes.join(" ")).not.toMatch(/for this API user/);
    });
  });

  it("notes UMBRACO_NO_DESTRUCTIVE once, and gives a module whose level comes from the env alone no backoffice note", () => {
    const caps = { kind: "ok" as const, payload: { addonVersion: "17.0.0", products: [] } };
    const forms: ModuleRuntimeState = {
      decision: { module: mod("forms", "Umbraco Forms"), product: null, load: true, reason: "ok" },
      loaded: true, toolCount: 80, issues: [], destructiveRemoved: 10,
    };
    const r = buildHealthReport({ ...state(caps, [cmsLoaded, forms]), noDestructiveFromEnv: true });
    const note = "UMBRACO_NO_DESTRUCTIVE is set, so destructive tools are removed for every product.";
    expect(r.notes.filter((n) => n === note)).toHaveLength(1);
    expect(r.notes.join(" ")).not.toMatch(/as set in the backoffice/);
    expect(buildHealthReport(state(caps, [cmsLoaded, forms])).notes.join(" ")).not.toMatch(/UMBRACO_NO_DESTRUCTIVE/);
  });

  it("gives no backoffice no-destructive note without the add-on", () => {
    const r = buildHealthReport(state({ kind: "no-addon" }, [{ ...cmsLoaded, siteNoDestructive: true, destructiveRemoved: 39 }]));
    expect(r.notes.join(" ")).not.toMatch(/no destructive tools/);
  });

  it("notes that backoffice levels were not applied when capabilities are unavailable", () => {
    const r = buildHealthReport(state({ kind: "unavailable", reason: "HTTP 500" }, [cmsLoaded]));
    expect(r.notes).toContain(
      "The site's capabilities could not be read, so the backoffice tool levels (read-only, no destructive tools) and tool group settings were not applied. " +
      "Set UMBRACO_NO_DESTRUCTIVE=true or UMBRACO_READONLY=true in the MCP server's environment to enforce a level without the site.",
    );
    expect(buildHealthReport(state({ kind: "no-addon" }, [cmsLoaded])).notes.join(" ")).not.toMatch(/could not be read/);
  });

  it("reports the removed destructive count on the product", () => {
    const caps = { kind: "ok" as const, payload: { addonVersion: "17.0.0", products: [] } };
    const forms: ModuleRuntimeState = {
      decision: { module: mod("forms", "Umbraco Forms"), product: null, load: true, reason: "ok" },
      loaded: true, toolCount: 80, issues: [], destructiveRemoved: 10,
    };
    const r = buildHealthReport({ ...state(caps, [cmsLoaded, forms]), noDestructiveFromEnv: true });
    expect(r.products.find((p) => p.id === "forms")?.destructiveRemoved).toBe(10);
    expect(r.products.find((p) => p.id === "cms")?.destructiveRemoved).toBe(0);
  });

  it("gives no backoffice no-destructive note for a module that did not load", () => {
    const caps = { kind: "ok" as const, payload: { addonVersion: "17.0.0", products: [] } };
    const forms: ModuleRuntimeState = {
      decision: { module: mod("forms", "Umbraco Forms"), product: null, load: true, reason: "ok" },
      loaded: false, toolCount: 0, issues: [], siteNoDestructive: true,
    };
    const r = buildHealthReport(state(caps, [forms]));
    expect(r.notes.join(" ")).not.toMatch(/no destructive tools/);
    expect(r.products[0].destructiveRemoved).toBe(0);
  });

  it("notes a failed catalogue report", () => {
    const r = buildHealthReport({ ...state({ kind: "no-addon" }, [cmsLoaded]), catalogueReport: { ok: false, reason: "HTTP 403" } });
    expect(r.notes).toContain("Could not report the tool groups to the site, so the backoffice Umbrella dashboard may be out of date: HTTP 403");
  });
});
