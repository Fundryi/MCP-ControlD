import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createControlDClient } from "../src/client.js";
import { registerTools } from "../src/tools.js";

const token = "YOUR_API_TOKEN";
const ok = (body: unknown) => new Response(JSON.stringify({ body, success: true }), {
  headers: { "content-type": "application/json" },
});

async function withDiagnostics<T>(
  fetch: typeof globalThis.fetch,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const server = new McpServer({ name: "test-server", version: "0.1.0" });
  const controlD = createControlDClient({ token, fetch });
  registerTools(server, controlD, false);
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  assert.equal(content[0]?.type, "text");
  assert.equal(typeof content[0]?.text, "string");
  return content[0].text;
}

test("constructs the authenticated CSV export URL", async () => {
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "abcdefghij.analytics.controld.com");
    assert.equal(url.pathname, "/v2/activity-log/csv");
    assert.equal(url.searchParams.get("startTime"), "2025-12-04T00:00:00Z");
    assert.equal(url.searchParams.get("endTime"), "2025-12-05T00:00:00Z");
    assert.equal(url.searchParams.get("endpointId"), "abcdefghij");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${token}`);
    assert.equal(headers.get("x-force-org-id"), "1234567890");
    return new Response("timestamp,question\n2025-12-05T00:00:00Z,example.com\n");
  };

  await withDiagnostics(fetch as typeof globalThis.fetch, async (client) => {
    const result = await client.callTool({
      name: "controld_export_dns_query_logs",
      arguments: {
        analytics_endpoint_id: "abcdefghij",
        start_time: "2025-12-04T00:00:00Z",
        end_time: "2025-12-05T00:00:00Z",
        device_id: "abcdefghij",
        sub_org_id: "1234567890",
      },
    });
    assert.match(textContent(result), /example\.com/);
  });
});

test("rejects unsafe analytics endpoint IDs and invalid RFC 3339 timestamps", async () => {
  let fetched = false;
  const fetch = async () => {
    fetched = true;
    return new Response("");
  };

  await withDiagnostics(fetch as typeof globalThis.fetch, async (client) => {
    for (const analytics_endpoint_id of ["HTTPS://example.com", "example.com", "UPPER", "-leading"]) {
      const result = await client.callTool({
        name: "controld_export_dns_query_logs",
        arguments: { analytics_endpoint_id, start_time: "2025-12-04T00:00:00Z" },
      });
      assert.equal(result.isError, true);
    }
    for (const arguments_ of [
      { analytics_endpoint_id: "abcdefghij", start_time: "not-a-time" },
      {
        analytics_endpoint_id: "abcdefghij",
        start_time: "2025-12-04T00:00:00Z",
        end_time: "2025-02-30T00:00:00Z",
      },
    ]) {
      const result = await client.callTool({
        name: "controld_export_dns_query_logs",
        arguments: arguments_,
      });
      assert.equal(result.isError, true);
    }
  });
  assert.equal(fetched, false);
});

test("caps oversized CSV responses and reports truncation", async () => {
  const csv = "x".repeat(2 * 1024 * 1024 + 100);
  const fetch = async () => new Response(csv);

  await withDiagnostics(fetch as typeof globalThis.fetch, async (client) => {
    const result = await client.callTool({
      name: "controld_export_dns_query_logs",
      arguments: {
        analytics_endpoint_id: "abcdefghij",
        start_time: "2025-12-04T00:00:00Z",
      },
    });
    const text = textContent(result);
    assert(Buffer.byteLength(text) <= 1024 * 1024);
    assert.match(text, /TRUNCATED/);
    assert.match(text, /response exceeded 2097152 bytes/);
  });
});

test("walks root and folder rules and reports heuristic domain findings", async () => {
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(`${url.pathname}|${new Headers(init?.headers).get("x-force-org-id") ?? ""}`);
    const bodies: Record<string, unknown> = {
      "/profiles/1234567890/groups": {
        groups: [{ PK: "abcdefghij", group: "Example folder", action: { status: 1 }, count: 2 }],
      },
      "/profiles/1234567890/rules/0": {
        rules: [
          { PK: "example.com", order: 1, group: 0, action: { do: 0, status: 1 } },
          { PK: "*.example.com", order: 2, group: 0, action: { do: 0, status: "1" } },
          { PK: "unrelated.example", order: 3, group: 0, action: { do: 1, status: 1 } },
        ],
      },
      "/profiles/1234567890/rules/abcdefghij": {
        rules: [
          { PK: "sub.example.com", order: 3, group: "abcdefghij", action: { do: 1, status: 1 } },
        ],
      },
      "/profiles/1234567890/services": {
        services: [
          { PK: "google", name: "Google", action: { do: 0, status: 1 } },
          { PK: "discord", name: "Discord", action: { do: 0, status: 0 } },
        ],
      },
      "/profiles/1234567890/filters": {
        filters: [
          { PK: "ads", name: "Ads & Trackers", status: 1 },
          { PK: "social", name: "Social", status: 0 },
        ],
      },
      "/profiles/1234567890/filters/external": {
        filters: [
          { PK: "example.com", name: "Example external filter", status: "1" },
          { PK: "disabled.example", name: "Disabled external filter", status: 0 },
        ],
      },
      "/profiles/1234567890/default": { default: { do: 3, via: "LOCAL", status: 1 } },
    };
    assert(url.pathname in bodies, `Unexpected request: ${url.pathname}`);
    return ok(bodies[url.pathname]);
  };

  await withDiagnostics(fetch as typeof globalThis.fetch, async (client) => {
    const result = await client.callTool({
      name: "controld_explain_domain",
      arguments: {
        profile_id: "1234567890",
        domain: "sub.example.com",
        sub_org_id: "1234567890",
      },
    });
    const report = JSON.parse(textContent(result));
    assert.equal(report.domain, "sub.example.com");
    assert.match(report.scope, /not a DNS resolution trace/);
    assert.match(report.precedence_notice, /not formally documented/);
    assert.deepEqual(
      report.findings.exact_custom_rules.map(({ rule }: { rule: { PK: string } }) => rule.PK),
      ["sub.example.com"],
    );
    assert.deepEqual(
      report.findings.parent_domain_custom_rules.map(({ rule }: { rule: { PK: string } }) => rule.PK),
      ["example.com", "*.example.com"],
    );
    assert.deepEqual(
      report.findings.enabled_service_rules_not_domain_matched.map(({ PK }: { PK: string }) => PK),
      ["google"],
    );
    assert.deepEqual(
      report.findings.enabled_filters_not_domain_matched.map(({ PK }: { PK: string }) => PK),
      ["ads"],
    );
    assert.deepEqual(
      report.findings.enabled_external_filters_not_domain_matched.map(
        ({ PK }: { PK: string }) => PK,
      ),
      ["example.com"],
    );
    assert.deepEqual(report.findings.configured_default_rule, { do: 3, via: "LOCAL", status: 1 });

    const apexResult = await client.callTool({
      name: "controld_explain_domain",
      arguments: { profile_id: "1234567890", domain: "example.com" },
    });
    const apexReport = JSON.parse(textContent(apexResult));
    assert.deepEqual(
      apexReport.findings.parent_domain_custom_rules.map(
        ({ rule }: { rule: { PK: string } }) => rule.PK,
      ),
      ["*.example.com"],
    );
  });

  assert.deepEqual(requests, [
    "/profiles/1234567890/groups|1234567890",
    "/profiles/1234567890/rules/0|1234567890",
    "/profiles/1234567890/rules/abcdefghij|1234567890",
    "/profiles/1234567890/services|1234567890",
    "/profiles/1234567890/filters|1234567890",
    "/profiles/1234567890/filters/external|1234567890",
    "/profiles/1234567890/default|1234567890",
    "/profiles/1234567890/groups|",
    "/profiles/1234567890/rules/0|",
    "/profiles/1234567890/rules/abcdefghij|",
    "/profiles/1234567890/services|",
    "/profiles/1234567890/filters|",
    "/profiles/1234567890/filters/external|",
    "/profiles/1234567890/default|",
  ]);
});
