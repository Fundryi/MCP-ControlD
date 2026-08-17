import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createControlDClient } from "../src/client.js";
import { registerTools } from "../src/tools.js";

interface CapturedRequest {
  method: string;
  path: string;
  body: string;
  contentType: string | null;
  subOrgId: string | null;
}

const writeToolNames = [
  "controld_create_profile",
  "controld_update_profile",
  "controld_delete_profile",
  "controld_set_profile_option",
  "controld_set_filters",
  "controld_set_service_rule",
  "controld_set_default_rule",
  "controld_create_custom_rules",
  "controld_update_custom_rules",
  "controld_delete_custom_rule",
  "controld_create_rule_folder",
  "controld_update_rule_folder",
  "controld_delete_rule_folder",
  "controld_create_device",
  "controld_update_device",
  "controld_delete_device",
  "controld_authorize_ips",
  "controld_deauthorize_ips",
  "controld_create_suborg",
  "controld_update_organization",
  "controld_request_write",
] as const;

async function connect(
  fetch: typeof globalThis.fetch,
  writesEnabled = false,
) {
  const server = new McpServer({ name: "test-server", version: "0.1.0" });
  registerTools(server, createControlDClient({ token: "YOUR_API_TOKEN", fetch }), writesEnabled);
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

test("does not register write tools when writes are disabled", async () => {
  const previous = process.env.CONTROLD_ENABLE_WRITES;
  delete process.env.CONTROLD_ENABLE_WRITES;
  const fetch = async () => new Response(JSON.stringify({ body: {}, success: true }));
  const session = await connect(fetch as typeof globalThis.fetch);

  try {
    const tools = await session.client.listTools();
    assert(writeToolNames.every((name) => !tools.tools.some((tool) => tool.name === name)));
  } finally {
    await session.close();
    if (previous === undefined) delete process.env.CONTROLD_ENABLE_WRITES;
    else process.env.CONTROLD_ENABLE_WRITES = previous;
  }
});

test("write tools send the documented methods, paths, and body encodings", async () => {
  const requests: CapturedRequest[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
      body: String(init?.body ?? ""),
      contentType: headers.get("content-type"),
      subOrgId: headers.get("x-force-org-id"),
    });
    return new Response(JSON.stringify({ body: {}, success: true }));
  };
  const session = await connect(fetch as typeof globalThis.fetch, true);
  const sub_org_id = "1234567890";
  const call = (name: string, args: Record<string, unknown>) => session.client.callTool({
    name,
    arguments: { ...args, sub_org_id },
  });

  try {
    const tools = await session.client.listTools();
    const registeredWrites = tools.tools.filter(({ name }) => writeToolNames.includes(
      name as typeof writeToolNames[number],
    ));
    assert.deepEqual(registeredWrites.map(({ name }) => name), writeToolNames);
    assert(registeredWrites.every(({ annotations }) => annotations?.readOnlyHint === false));
    assert.deepEqual(
      registeredWrites.filter(({ annotations }) => annotations?.destructiveHint).map(({ name }) => name),
      [
        "controld_delete_profile",
        "controld_delete_custom_rule",
        "controld_delete_rule_folder",
        "controld_delete_device",
        "controld_deauthorize_ips",
        "controld_request_write",
      ],
    );

    await call("controld_create_profile", {
      name: "Example Profile",
      clone_profile_id: "1234567890",
    });
    await call("controld_update_profile", {
      profile_id: "1234567890",
      name: "Updated Profile",
      disable_ttl: 0,
    });
    await call("controld_delete_profile", { profile_id: "1234567890" });
    await call("controld_set_profile_option", {
      profile_id: "1234567890",
      name: "option/name",
      status: 1,
      value: "example",
    });
    await call("controld_set_filters", {
      profile_id: "1234567890",
      filters: [{ filter: "example-filter", status: 1 }],
    });
    await call("controld_set_service_rule", {
      profile_id: "1234567890",
      service: "video/service",
      do: 2,
      status: 1,
      via: "203.0.113.10",
    });
    await call("controld_set_default_rule", {
      profile_id: "1234567890",
      do: 0,
      status: 1,
    });
    await call("controld_create_custom_rules", {
      profile_id: "1234567890",
      hostnames: ["example.com", "www.example.com"],
      do: 0,
      status: 1,
      folder_id: "abcdefghij",
    });
    await call("controld_update_custom_rules", {
      profile_id: "1234567890",
      hostnames: ["example.com"],
      do: 1,
      status: 1,
      folder_id: 0,
    });
    await call("controld_delete_custom_rule", {
      profile_id: "1234567890",
      hostname: "example.com/path?",
    });
    await call("controld_create_rule_folder", {
      profile_id: "1234567890",
      name: "Example Folder",
      do: 1,
      status: 1,
    });
    await call("controld_update_rule_folder", {
      profile_id: "1234567890",
      folder: "folder/name",
      name: "Updated Folder",
      do: 1,
      status: 1,
    });
    await call("controld_delete_rule_folder", {
      profile_id: "1234567890",
      folder: 42,
    });
    await call("controld_create_device", {
      name: "Example Device",
      client_count: "1",
      profile_id: "1234567890",
      icon: "desktop",
      profile_id2: "1234567890",
      stats: 2,
      legacy_ipv4_status: 1,
      learn_ip: 1,
      restricted: 0,
      desc: "Example device",
      ddns_status: 1,
      ddns_subdomain: "example-device",
      ddns_ext_status: 1,
      ddns_ext_host: "example.com",
      remap_device_id: "abcdefghij",
      remap_client_id: "example-client",
    });
    await call("controld_update_device", {
      device_id: "abcdefghij",
      name: "Updated Device",
      client_count: "2",
      profile_id: "1234567890",
      profile_id2: "-1",
      stats: 1,
      legacy_ipv4_status: 0,
      learn_ip: 0,
      restricted: 1,
      bump_tls: 1,
      desc: "Updated example device",
      ddns_status: 0,
      ddns_subdomain: "updated-example-device",
      ddns_ext_host: "example.com",
      ddns_ext_status: 0,
      status: 1,
      ctrld_custom_config: "example",
    });
    await call("controld_delete_device", { device_id: "abcdefghij" });
    await call("controld_authorize_ips", {
      device_id: "abcdefghij",
      ips: ["203.0.113.10", "2001:db8::1"],
    });
    await call("controld_deauthorize_ips", {
      device_id: "abcdefghij",
      ips: ["203.0.113.10", "2001:db8::1"],
    });

    assert.deepEqual(requests.map(({ method, path }) => [method, path]), [
      ["POST", "/profiles"],
      ["PUT", "/profiles/1234567890"],
      ["DELETE", "/profiles/1234567890"],
      ["PUT", "/profiles/1234567890/options/option%2Fname"],
      ["PUT", "/profiles/1234567890/filters"],
      ["PUT", "/profiles/1234567890/services/video%2Fservice"],
      ["PUT", "/profiles/1234567890/default"],
      ["POST", "/profiles/1234567890/rules"],
      ["PUT", "/profiles/1234567890/rules"],
      ["DELETE", "/profiles/1234567890/rules/example.com%2Fpath%3F"],
      ["POST", "/profiles/1234567890/groups"],
      ["PUT", "/profiles/1234567890/groups/folder%2Fname"],
      ["DELETE", "/profiles/1234567890/groups/42"],
      ["POST", "/devices"],
      ["PUT", "/devices/abcdefghij"],
      ["DELETE", "/devices/abcdefghij"],
      ["POST", "/access"],
      ["DELETE", "/access"],
    ]);
    assert(requests.every(({ subOrgId }) => subOrgId === sub_org_id));

    const filters = requests[4];
    assert.equal(filters.contentType, "application/json");
    assert.deepEqual(JSON.parse(filters.body), {
      filters: [{ filter: "example-filter", status: 1 }],
    });

    const rulesBody = new URLSearchParams(requests[7].body);
    assert.deepEqual(rulesBody.getAll("hostnames[]"), ["example.com", "www.example.com"]);
    assert.equal(rulesBody.get("group"), "abcdefghij");

    for (const index of [16, 17]) {
      assert.equal(requests[index].contentType, "application/x-www-form-urlencoded");
      assert.deepEqual(
        new URLSearchParams(requests[index].body).getAll("ips[]"),
        ["203.0.113.10", "2001:db8::1"],
      );
    }
  } finally {
    await session.close();
  }
});

test("organization write tools post the documented form fields", async () => {
  const requests: CapturedRequest[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
      body: String(init?.body ?? ""),
      contentType: headers.get("content-type"),
      subOrgId: headers.get("x-force-org-id"),
    });
    return new Response(JSON.stringify({ body: {}, success: true }));
  };
  const session = await connect(fetch as typeof globalThis.fetch, true);

  try {
    await session.client.callTool({
      name: "controld_create_suborg",
      arguments: {
        name: "Example Org",
        contact_email: "contact@example.com",
        twofa_req: 1,
        stats_endpoint: "abcdefghij",
      },
    });
    await session.client.callTool({
      name: "controld_update_organization",
      arguments: { name: "Renamed Org", sub_org_id: "1234567890" },
    });

    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].path, "/organizations/suborg");
    assert.equal(requests[0].contentType, "application/x-www-form-urlencoded");
    assert.deepEqual(
      Object.fromEntries(new URLSearchParams(requests[0].body)),
      {
        name: "Example Org",
        contact_email: "contact@example.com",
        twofa_req: "1",
        stats_endpoint: "abcdefghij",
      },
    );

    assert.equal(requests[1].method, "PUT");
    assert.equal(requests[1].path, "/organizations");
    assert.equal(requests[1].subOrgId, "1234567890");
    assert.equal(new URLSearchParams(requests[1].body).get("name"), "Renamed Org");
  } finally {
    await session.close();
  }
});

test("the raw write tool honours method, encoding, and path safety", async () => {
  const requests: CapturedRequest[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
      body: String(init?.body ?? ""),
      contentType: headers.get("content-type"),
      subOrgId: headers.get("x-force-org-id"),
    });
    return new Response(JSON.stringify({ body: {}, success: true }));
  };
  const session = await connect(fetch as typeof globalThis.fetch, true);

  try {
    await session.client.callTool({
      name: "controld_request_write",
      arguments: {
        method: "PUT",
        path: "/profiles/1234567890/options/example",
        body: { status: 1, value: "on" },
      },
    });
    assert.equal(requests[0].method, "PUT");
    assert.equal(requests[0].contentType, "application/x-www-form-urlencoded");
    assert.deepEqual(
      Object.fromEntries(new URLSearchParams(requests[0].body)),
      { status: "1", value: "on" },
    );

    await session.client.callTool({
      name: "controld_request_write",
      arguments: {
        method: "PUT",
        path: "/profiles/1234567890/filters",
        encoding: "json",
        body: { filters: [{ filter: "example", status: 1 }] },
      },
    });
    assert.equal(requests[1].contentType, "application/json");
    assert.deepEqual(JSON.parse(requests[1].body), {
      filters: [{ filter: "example", status: 1 }],
    });

    // A path that would retarget another host must be refused before any fetch.
    for (const path of ["//example.com/steal", "\\example.com/steal", "https://example.com/steal"]) {
      const result = await session.client.callTool({
        name: "controld_request_write",
        arguments: { method: "POST", path },
      });
      assert.equal(result.isError, true, `expected ${path} to be rejected`);
    }
    assert.equal(requests.length, 2, "rejected paths must not reach fetch");
  } finally {
    await session.close();
  }
});
