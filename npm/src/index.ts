#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import packageJson from "../package.json" with { type: "json" };
import { startServer } from "./core/server.js";
import { modules } from "./modules/index.js";

const { server, toolNames } = await startServer({ modules, env: process.env, version: packageJson.version });

if (process.argv.includes("--list-tools")) {
  console.log(toolNames.join("\n"));
  process.exit(0);
}

await server.connect(new StdioServerTransport());
console.error(`Umbrella MCP started with ${toolNames.length} tool(s).`);
