import type { McpServer } from "@modelcontextprotocol/server";

import { redact, type ControlDClient } from "./client.js";
import { diagnosticsTools } from "./tools-diagnostics.js";
import { readTools } from "./tools-read.js";
import { writeTools } from "./tools-write.js";
import { textResult, type ToolDefinition } from "./tools-shared.js";

/** Sent to the client on connect. Keep every claim here true to the code below. */
export const INSTRUCTIONS = [
  "Control D DNS management. Start with controld_list_profiles, then controld_get_profile_config with section \"all\" for one profile.",
  "Every tool with readOnlyHint true only reads. Write tools exist only when the server has a write credential.",
  "A failed call returns isError true and a short plain-text message. Control D failures end with the HTTP status and Control D code, for example \"(HTTP 404, code 40401)\".",
  "HTTP 403 code 40301 \"This token does not have access to this endpoint\" can also mean the path does not exist. Check the path before you blame the token.",
  "Organization tools fail on a personal account. That is expected, not a token problem.",
  "controld_request_read and controld_request_write are escape hatches for undocumented paths. Use a named tool first.",
].join("\n");

function registerTool(server: McpServer, client: ControlDClient, tool: ToolDefinition): void {
  server.registerTool(tool.name, tool.config, async (args) => {
    try {
      return textResult(await tool.handler(client, args));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(redact(message, [
        process.env.CONTROLD_API_TOKEN,
        process.env.CONTROLD_API_TOKEN_READ,
        process.env.CONTROLD_API_TOKEN_WRITE,
      ]));
    }
  });
}

export function registerTools(
  server: McpServer,
  client: ControlDClient,
  writesEnabled: boolean,
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
