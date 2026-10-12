import type { LoadedModule, McpProductModule } from "../core/module-contract.js";

export const automateModule: McpProductModule = {
  id: "automate",
  displayName: "Umbraco Automate",
  toolPrefix: "automate--",
  packageName: "@umbraco-automate/mcp-dev",
  expectedMajor: "17",
  description: "Umbraco Automate: automations that react to triggers and run steps.",
  useWhen: [
    "automations: creating, editing, publishing and triggering them",
    "triggers, steps, connections and the trigger/step catalogue",
    "automation runs, their history, retries and pending approvals",
    "workspaces, metrics and version history",
    "general automations that are not tied to a form submission",
  ],
  // get-server-info duplicates Forms' and CMS get-server-information.
  defaultDisabledCollections: ["umbraco-server"],
  load: async (): Promise<LoadedModule> => {
    const m = await import("@umbraco-automate/mcp-dev/collections");
    return {
      collections: m.collections,
      allModes: m.allModes,
      allModeNames: m.allModeNames,
      allSliceNames: m.allSliceNames,
      createApiClient: m.createApiClient,
    };
  },
};
