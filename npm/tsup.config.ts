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
  // dependencies stay external (tsup default), so product packages are resolved from node_modules at runtime
});
