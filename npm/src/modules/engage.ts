import type { LoadedModule, McpProductModule } from "../core/module-contract.js";

export const engageModule: McpProductModule = {
  id: "engage",
  displayName: "Umbraco Engage",
  toolPrefix: "engage--",
  packageName: "@umbraco-engage/mcp-dev",
  expectedMajor: "17",
  description: "Umbraco Engage: personalisation, A/B tests and visitor analytics.",
  useWhen: [
    "A/B tests, their projects and variants",
    "personalisation: personas, customer journeys, Engage segments and content scoring",
    "visitor profiles, goals, campaigns, referral groups, heatmaps and annotations",
    "website visitor analytics and reports (not form submission analytics)",
    "the Engage main switch, traffic filters, data cleanup and Engage permissions",
  ],
  // License info, the add-on switches and the tracked cultures (CMS languages cover those).
  defaultDisabledCollections: ["package", "add-ons", "cultures"],
  load: async (): Promise<LoadedModule> => {
    const m = await import("@umbraco-engage/mcp-dev/collections");
    return {
      collections: m.collections,
      allModes: m.allModes,
      allModeNames: m.allModeNames,
      allSliceNames: m.allSliceNames,
      createApiClient: m.createApiClient,
    };
  },
};
