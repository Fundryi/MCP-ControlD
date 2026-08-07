#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createControlDClient } from "./client.js";
import type { ControlDClient } from "./client.js";
import { registerTools } from "./tools.js";

let client: ControlDClient;
try {
  client = createControlDClient();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const server = new McpServer({ name: "controld-mcp", version: "0.1.0" });

registerTools(server, client);
await server.connect(new StdioServerTransport());
