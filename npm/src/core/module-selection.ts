import type { CapabilitiesResult, ProductCapability } from "./capabilities.js";
import type { McpProductModule } from "./module-contract.js";

export interface ModuleDecision {
  module: McpProductModule;
  product: ProductCapability | null;
  load: boolean;
  reason: string;
  /** Set only when the module was skipped because the site switched it off in the backoffice. */
  switchedOff?: true;
  /** Set only when the module was skipped because the API user's user groups don't grant the product's section. */
  noSectionAccess?: true;
}

export function parseForcedModules(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function majorOf(version: string | null): string | null {
  const match = version?.match(/^v?(\d+)/i);
  return match ? match[1] : null;
}

export function selectModules(
  modules: McpProductModule[],
  capabilities: CapabilitiesResult,
  forced: string[],
): ModuleDecision[] {
  return modules.map((module) => {
    const product =
      capabilities.kind === "ok" ? capabilities.payload.products.find((p) => p.id === module.id) ?? null : null;
    const decide = (load: boolean, reason: string): ModuleDecision => ({ module, product, load, reason });

    if (module.required) return decide(true, "Required module.");
    // The backoffice's restrictions always apply, so Off wins over forcing it on via the environment.
    if (product?.off === true) {
      const reason = product.settingsScope === "user"
        ? "Switched off for this API user in the backoffice (Settings → Umbrella)."
        : "Switched off in the backoffice (Settings → Umbrella).";
      return { ...decide(false, reason), switchedOff: true };
    }
    // Without the section the product's API refuses every tool, so forcing it on would only add tools that fail.
    if (product?.noSectionAccess === true) {
      const reason =
        `This API user's user groups don't grant the ${module.displayName} section, so its tools were not loaded. ` +
        "Grant the section to one of its user groups in the backoffice if it should use them, then restart the MCP server.";
      return { ...decide(false, reason), noSectionAccess: true };
    }
    if (forced.includes(module.id)) return decide(true, "Forced on via UMBRACO_MCP_MODULES.");
    if (capabilities.kind === "no-addon") {
      return decide(false, "The Umbraco.Community.Umbrella add-on is not installed on the site, so products cannot be detected.");
    }
    if (capabilities.kind === "unavailable") return decide(false, `Capabilities unavailable: ${capabilities.reason}`);
    if (!product || !product.installed) return decide(false, `${module.displayName} is not installed on the site.`);
    if (!product.enabled) return decide(false, `${module.displayName} is installed but not enabled.`);
    const major = majorOf(product.version);
    if (major === null) return decide(false, `${module.displayName} is installed with an unknown version.`);
    if (major !== module.expectedMajor) {
      return decide(false, `${module.displayName} ${product.version} does not match supported major ${module.expectedMajor}.`);
    }
    return decide(true, `${module.displayName} is installed and enabled.`);
  });
}
