import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createControlDClient } from "../src/client.js";
import { registerTools } from "../src/tools.js";
import { textResult } from "../src/tools-shared.js";

test("registers the full read surface, gates writes, and calls the foundation tools", async () => {
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(`${String(input)}|${new Headers(init?.headers).get("x-force-org-id") ?? ""}`);
    const body = String(input).endsWith("/profiles")
      ? { profiles: [{ PK: "1234567890", name: "example.com" }] }
      : { ip: "203.0.113.10", datacenter: "example.com" };
    return new Response(JSON.stringify({ body, success: true }));
  };
  const server = new McpServer({ name: "test-server", version: "0.1.0" });
  registerTools(server, createControlDClient({
    token: "YOUR_API_TOKEN",
    fetch: fetch as typeof globalThis.fetch,
  }), false);
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map(({ name }) => name);
    assert.equal(names.length, 12, `writes disabled should expose 12 tools, got: ${names.join(", ")}`);
    assert(names.includes("controld_list_profiles"));
    assert(names.includes("controld_get_request_ip"));
    assert(tools.tools.every(({ annotations }) => annotations?.readOnlyHint === true));

    await client.callTool({
      name: "controld_list_profiles",
      arguments: { sub_org_id: "1234567890" },
    });
    await client.callTool({ name: "controld_get_request_ip", arguments: {} });
    assert.deepEqual(requests, [
      "https://api.controld.com/profiles|1234567890",
      "https://api.controld.com/ip|",
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("caps text tool results at 1 MiB with a truncation notice", () => {
  const result = textResult("x".repeat(1024 * 1024 + 100));
  const text = result.content[0].text;

  assert(Buffer.byteLength(text) <= 1024 * 1024);
  assert.match(text, /TRUNCATED: output capped at 1048576 bytes/);
});

test("strips the environment token from handler-thrown errors", async () => {
  const previous = process.env.CONTROLD_API_TOKEN;
  process.env.CONTROLD_API_TOKEN = "YOUR_API_TOKEN";
  const server = new McpServer({ name: "test-server", version: "0.1.0" });
  registerTools(server, {
    request: async () => { throw new Error("failed with YOUR_API_TOKEN"); },
    rawGet: async () => ({ text: "", truncated: false }),
  }, false);
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: "controld_list_profiles", arguments: {} });
    const text = JSON.stringify(result);
    assert.equal(result.isError, true);
    assert(!text.includes("YOUR_API_TOKEN"));
    assert.match(text, /\[REDACTED\]/);
  } finally {
    await client.close();
    await server.close();
    if (previous === undefined) delete process.env.CONTROLD_API_TOKEN;
    else process.env.CONTROLD_API_TOKEN = previous;
  }
});

test("registers write tools only when writes are enabled", async () => {
  const controlDClient = createControlDClient({
    token: "YOUR_API_TOKEN",
    fetch: (async () => new Response(JSON.stringify({ body: {}, success: true }))) as typeof globalThis.fetch,
  });

  for (const [writesEnabled, expectedCount] of [[false, 12], [true, 30]] as const) {
    const server = new McpServer({ name: "test-server", version: "0.1.0" });
    registerTools(server, controlDClient, writesEnabled);
    const client = new Client({ name: "test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      assert.equal(tools.tools.length, expectedCount);
      const hasWriteTool = tools.tools.some(({ annotations }) => annotations?.readOnlyHint === false);
      assert.equal(hasWriteTool, writesEnabled);
    } finally {
      await client.close();
      await server.close();
    }
  }
});
