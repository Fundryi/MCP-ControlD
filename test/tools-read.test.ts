import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createControlDClient } from "../src/client.js";
import { registerTools } from "../src/tools.js";

test("calls every read tool endpoint with exact paths and queries", async () => {
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(init?.method, "GET");
    requests.push(
      `${url.pathname}${url.search}|${new Headers(init.headers).get("x-force-org-id") ?? ""}`,
    );
    return new Response(JSON.stringify({ body: { ok: true }, success: true }));
  };
  const server = new McpServer({ name: "test-server", version: "0.1.0" });
  const controlDClient = createControlDClient({
    token: "YOUR_API_TOKEN",
    fetch: fetch as typeof globalThis.fetch,
  });
  registerTools(server, controlDClient, false);

  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const profileSections = [
      ["filters", { sub_org_id: "1234567890", folder_id: "abcdefghij" }],
      ["external_filters", {}],
      ["services", {}],
      ["folders", {}],
      ["rules", {}],
      ["rules", { folder_id: "abcdefghij" }],
      ["default_rule", {}],
    ] as const;
    for (const [section, extra] of profileSections) {
      await client.callTool({
        name: "controld_get_profile_config",
        arguments: { profile_id: "1234567890", section, ...extra },
      });
    }

    const catalogs = [
      ["profile_options", {}],
      ["device_types", {}],
      ["service_categories", {}],
      ["services", { category: "tools" }],
      ["proxies", {}],
      ["analytics_levels", {}],
      ["analytics_regions", {}],
    ] as const;
    for (const [catalog, extra] of catalogs) {
      await client.callTool({
        name: "controld_list_catalog",
        arguments: { catalog, ...extra },
      });
    }

    await client.callTool({
      name: "controld_list_devices",
      arguments: { sub_org_id: "1234567890" },
    });
    await client.callTool({
      name: "controld_list_known_ips",
      arguments: { device_id: "abcdefghij", sub_org_id: "1234567890" },
    });
    await client.callTool({ name: "controld_get_account", arguments: {} });
    for (const view of ["products", "subscriptions", "payments"] as const) {
      await client.callTool({ name: "controld_get_billing", arguments: { view } });
    }
    for (const view of ["info", "members", "sub_organizations"] as const) {
      await client.callTool({ name: "controld_get_organization", arguments: { view } });
    }
    await client.callTool({ name: "controld_get_network_status", arguments: {} });

    assert.deepEqual(requests, [
      "/profiles/1234567890/filters|1234567890",
      "/profiles/1234567890/filters/external|",
      "/profiles/1234567890/services|",
      "/profiles/1234567890/groups|",
      "/profiles/1234567890/rules|",
      "/profiles/1234567890/rules/abcdefghij|",
      "/profiles/1234567890/default|",
      "/profiles/options|",
      "/devices/types|",
      "/services/categories|",
      "/services/categories/tools|",
      "/proxies|",
      "/analytics/levels|",
      "/analytics/endpoints|",
      "/devices|1234567890",
      "/access?device_id=abcdefghij|1234567890",
      "/users|",
      "/billing/products|",
      "/billing/subscriptions|",
      "/billing/payments|",
      "/organizations/organization|",
      "/organizations/members|",
      "/organizations/sub_organizations|",
      "/network|",
    ]);

    const invalidCalls = [
      client.callTool({
        name: "controld_get_profile_config",
        arguments: { profile_id: "..", section: "filters" },
      }),
      client.callTool({ name: "controld_list_catalog", arguments: { catalog: "services" } }),
      client.callTool({
        name: "controld_list_catalog",
        arguments: { catalog: "profile_options", category: "tools" },
      }),
      client.callTool({ name: "controld_get_billing", arguments: { view: "invalid" } }),
    ];
    for (const result of await Promise.all(invalidCalls)) assert.equal(result.isError, true);
    assert.equal(requests.length, 24);
  } finally {
    await client.close();
    await server.close();
  }
});
