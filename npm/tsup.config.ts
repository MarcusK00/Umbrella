import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  dts: false,
  // dependencies stay external (tsup default), so product packages are resolved from node_modules at runtime.
  // Engage is a devDependency until a v17 release with the createApiClient export is published: keep it external
  // so it is not bundled, and the published package reports it as unavailable instead.
  external: ["@umbraco-engage/mcp-dev"],
});
