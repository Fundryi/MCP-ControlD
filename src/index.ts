#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createControlDClient, redact, resolveConfig } from "./client.js";
import type { ControlDClient, ResolvedConfig } from "./client.js";
import { INSTRUCTIONS, registerTools } from "./tools.js";

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

// serveStdio may build more than one server per process (a probe it throws
// away, then the real one), so keep state at module level, not on the server.
function buildServer(): McpServer {
  const server = new McpServer(
    { name: "mcp-controld", version: "0.1.1" },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, client, config.writeToken !== undefined);
  return server;
}

// Serves protocol 2026-07-28 and the 2024-10-07 to 2025-11-25 revisions.
serveStdio(buildServer, {
  onerror: (error) => console.error(
    `mcp-controld transport error: ${redact(error.message, [config.readToken, config.writeToken])}`,
  ),
});
