import type { LoadedModule, McpProductModule } from "../core/module-contract.js";

export const cmsModule: McpProductModule = {
  id: "cms",
  displayName: "Umbraco CMS",
  toolPrefix: "cms--",
  packageName: "@umbraco-cms/mcp-dev",
  expectedMajor: "17",
  required: true,
  description: "Umbraco CMS: the site's content, structure, media, members and settings.",
  useWhen: [
    "content/documents, publishing, blueprints and the content and media recycle bins",
    "document types, data types, templates, partial views, stylesheets and scripts",
    "media and media types",
    "members, users and user groups",
    "dictionary items, languages, domains, redirects and CMS webhooks",
    "health checks, logs, search indexes and server information",
  ],
  // Backoffice plumbing: extension manifests, the per-user UI key-value store, image resize URLs.
  defaultDisabledCollections: ["manifest", "user-data", "imaging"],
  load: async (): Promise<LoadedModule> => {
    const m = await import("@umbraco-cms/mcp-dev/collections");
    return {
      collections: m.collections as LoadedModule["collections"],
      allModes: m.allModes as LoadedModule["allModes"],
      allModeNames: m.allModeNames,
      allSliceNames: m.allSliceNames,
      createApiClient: () => m.UmbracoManagementClient.getClient(),
    };
  },
};
