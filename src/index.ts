#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createControlDClient, resolveConfig } from "./client.js";
import type { ControlDClient, ResolvedConfig } from "./client.js";
import { registerTools } from "./tools.js";

let config: ResolvedConfig;
let client: ControlDClient;
try {
  config = resolveConfig();
  client = createControlDClient(config);
} catch (error) {
  // Config errors name the variable, never its value.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const server = new McpServer({ name: "mcp-controld", version: "0.1.0" });

registerTools(server, client, config.writeToken !== undefined);
await server.connect(new StdioServerTransport());
