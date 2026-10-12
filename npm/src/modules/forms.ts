import type { LoadedModule, McpProductModule } from "../core/module-contract.js";

export const formsModule: McpProductModule = {
  id: "forms",
  displayName: "Umbraco Forms",
  toolPrefix: "forms--",
  packageName: "@umbraco-forms/mcp-dev",
  expectedMajor: "17",
  description: "Umbraco Forms: forms, their fields and the entries people submit.",
  useWhen: [
    "forms, form folders, fields, pages, conditions, themes and form templates",
    "form submissions (entries/records): searching, exporting and analysing them",
    "form workflows (actions that run after a form is submitted), data sources and prevalue sources",
    "the Forms recycle bin (deleted forms and folders)",
  ],
  load: async (): Promise<LoadedModule> => {
    const m = await import("@umbraco-forms/mcp-dev/collections");
    return {
      collections: m.collections,
      allModes: m.allModes,
      allModeNames: m.allModeNames,
      allSliceNames: m.allSliceNames,
      createApiClient: m.createApiClient,
    };
  },
};
