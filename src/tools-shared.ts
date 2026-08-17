import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { decodeTruncated, type ControlDClient } from "./client.js";

const MAX_TEXT_BYTES = 1024 * 1024;

export interface ToolDefinition {
  name: string;
  config: {
    description: string;
    inputSchema: z.ZodType;
    annotations: ToolAnnotations;
  };
  handler: (client: ControlDClient, args: unknown) => unknown | Promise<unknown>;
}

export function defineTool<Schema extends z.ZodType>(definition: {
  name: string;
  config: {
    description: string;
    inputSchema: Schema;
    annotations: ToolAnnotations;
  };
  handler: (client: ControlDClient, args: z.output<Schema>) => unknown | Promise<unknown>;
}): ToolDefinition {
  return {
    ...definition,
    handler: (client, args) => definition.handler(client, args as z.output<Schema>),
  };
}

export const nonEmptyString = z.string().min(1);

/**
 * A path for the raw escape-hatch tools. It must be host-relative and start
 * with exactly one slash: "//example.com/x" and "\\\\example.com/x" both resolve
 * to another host under WHATWG URL rules, which would send the bearer token
 * off-site. Whitespace and backslashes are rejected outright.
 */
export const apiPath = z.string()
  .regex(
    /^\/(?![/\\])[^\s\\#]*$/,
    "Path must start with a single '/', and must not contain whitespace, backslashes, or '#'.",
  )
  .describe("Control D API path starting with '/', for example '/devices/users'.");

export const queryInput = z.record(
  z.string().min(1),
  z.union([z.string(), z.number(), z.boolean()]),
).optional().describe("Optional query parameters.");

export function withQuery(path: string, query: Record<string, string | number | boolean> | undefined): string {
  if (query === undefined) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  const search = params.toString();
  return search === "" ? path : `${path}${path.includes("?") ? "&" : "?"}${search}`;
}

export function segment(value: string | number): string {
  const text = String(value);
  if (text === "" || text === "." || text === "..") {
    throw new Error("Path segments must not be empty, '.' or '..'.");
  }
  return encodeURIComponent(text);
}

export const subOrgInput = {
  sub_org_id: z.string().min(1).optional().describe("Sub-organization ID to act on."),
};

export const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const destructiveAnnotations = {
  ...writeAnnotations,
  destructiveHint: true,
} as const;

export function textResult(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
  const bytes = Buffer.from(text);
  if (bytes.length <= MAX_TEXT_BYTES) {
    return { content: [{ type: "text" as const, text }] };
  }

  const matchedNotice = text.match(/\n\n\[TRUNCATED:[^\r\n]*\]$/)?.[0] ?? "";
  const trailingNotice = Buffer.byteLength(matchedNotice) <= 1024 ? matchedNotice : "";
  const notice = `\n\n[TRUNCATED: output capped at ${MAX_TEXT_BYTES} bytes.]${trailingNotice}`;
  const prefix = decodeTruncated(bytes.subarray(0, MAX_TEXT_BYTES - Buffer.byteLength(notice)));
  return {
    content: [{ type: "text" as const, text: prefix + notice }],
  };
}
