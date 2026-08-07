import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ControlDClient } from "./client.js";
import { diagnosticsTools } from "./tools-diagnostics.js";
import { readTools } from "./tools-read.js";
import { writeTools } from "./tools-write.js";
import { textResult, type ToolDefinition } from "./tools-shared.js";

function registerTool(server: McpServer, client: ControlDClient, tool: ToolDefinition): void {
  server.registerTool(tool.name, tool.config, async (args) => {
    try {
      return textResult(await tool.handler(client, args));
    } catch (error) {
      const token = process.env.CONTROLD_API_TOKEN;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(token ? message.split(token).join("[REDACTED]") : message);
    }
  });
}

export function registerTools(
  server: McpServer,
  client: ControlDClient,
  writesEnabled = process.env.CONTROLD_ENABLE_WRITES === "1",
): void {
  for (const tool of [...readTools, ...diagnosticsTools]) {
    if (tool.config.annotations.readOnlyHint !== true) {
      throw new Error(`${tool.name} must be annotated read-only.`);
    }
  }
  for (const tool of writeTools) {
    if (tool.config.annotations.readOnlyHint === true) {
      throw new Error(`${tool.name} must not be annotated read-only.`);
    }
  }

  for (const tool of readTools) registerTool(server, client, tool);
  for (const tool of diagnosticsTools) registerTool(server, client, tool);
  if (writesEnabled) for (const tool of writeTools) registerTool(server, client, tool);
}
