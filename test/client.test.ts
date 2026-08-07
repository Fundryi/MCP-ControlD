import assert from "node:assert/strict";
import test from "node:test";

import { createControlDClient } from "../src/client.js";

const token = "YOUR_API_TOKEN";
const ok = (body: unknown) => new Response(JSON.stringify({ body, success: true }), {
  headers: { "content-type": "application/json" },
});

test("unwraps successful response envelopes", async () => {
  const fetch = async (input: string | URL | Request) => {
    assert.equal(String(input), "https://api.controld.com/profiles");
    return ok({ profiles: [{ PK: "1234567890", name: "example.com" }] });
  };
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  assert.deepEqual(await client.request("/profiles"), {
    profiles: [{ PK: "1234567890", name: "example.com" }],
  });
});

test("maps API errors to errors carrying message and code", async () => {
  const fetch = async () => new Response(JSON.stringify({
    body: [],
    success: false,
    error: { message: "Profile not found", code: "404001" },
  }), { status: 404 });
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  await assert.rejects(client.request("/profiles/1234567890"), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal(error.message, "Profile not found");
    assert.equal((error as Error & { code?: string }).code, "404001");
    return true;
  });
});

test("preserves the HTTP status for non-JSON error responses", async () => {
  const fetch = async () => new Response("<html>Bad gateway</html>", { status: 502 });
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  await assert.rejects(client.request("/profiles"), /HTTP 502/);
});

test("rejects a successful envelope carried by an HTTP error", async () => {
  const fetch = async () => new Response(
    JSON.stringify({ body: {}, success: true }),
    { status: 502 },
  );
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  await assert.rejects(client.request("/profiles"), /HTTP 502/);
});

test("encodes form arrays as repeated key[] fields and supports org headers", async () => {
  const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const params = new URLSearchParams(String(init?.body));

    assert.equal(headers.get("authorization"), `Bearer ${token}`);
    assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
    assert.equal(headers.get("x-force-org-id"), "1234567890");
    assert.equal(params.get("status"), "true");
    assert.deepEqual(params.getAll("hostnames[]"), ["example.com", "sub.example.com"]);
    return ok({ PK: "abcdefghij", ip: "203.0.113.10" });
  };
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  await client.request("/profiles/1234567890/rules", {
    method: "POST",
    subOrgId: "1234567890",
    body: {
      encoding: "form",
      value: { status: true, hostnames: ["example.com", "sub.example.com"] },
    },
  });
});

test("supports JSON request bodies", async () => {
  const value = { filters: [{ filter: "example.com", status: 1 }] };
  const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(init?.body)), value);
    return ok({ PK: "1234567890" });
  };
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  await client.request("/profiles/1234567890/filters", {
    method: "PUT",
    body: { encoding: "json", value },
  });
});

test("redacts the token from errors thrown through the client", async () => {
  const fetch = async () => {
    throw new Error(`request failed with authorization: Bearer ${token}`);
  };
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  await assert.rejects(client.request("/ip"), (error: unknown) => {
    assert(error instanceof Error);
    assert(!String(error.stack).includes(token));
    return true;
  });
});

test("rawGet stops at its byte limit without returning a split UTF-8 character", async () => {
  const fetch = async () => new Response("abcdérest");
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  assert.deepEqual(
    await client.rawGet(new URL("https://example.com/log.csv"), { maxBytes: 5 }),
    { text: "abcd", truncated: true },
  );
});
