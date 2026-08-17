import assert from "node:assert/strict";
import test from "node:test";

import { createControlDClient, decodeTruncated, redact, resolveBaseUrl, resolveConfig } from "../src/client.js";

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
    await client.rawGet(new URL("https://abcdefghij.analytics.controld.com/log.csv"), { maxBytes: 5 }),
    { text: "abcd", truncated: true },
  );
});

test("resolveConfig splits read and write credentials", () => {
  assert.deepEqual(
    resolveConfig({ CONTROLD_API_TOKEN_READ: "YOUR_API_TOKEN_READ", CONTROLD_API_TOKEN_WRITE: "YOUR_API_TOKEN_WRITE" }),
    {
      readToken: "YOUR_API_TOKEN_READ",
      writeToken: "YOUR_API_TOKEN_WRITE",
      baseUrl: "https://api.controld.com",
      orgId: undefined,
    },
  );
});

test("resolveConfig keeps a lone CONTROLD_API_TOKEN read-only unless writes are opted in", () => {
  assert.equal(resolveConfig({ CONTROLD_API_TOKEN: token }).writeToken, undefined);
  assert.equal(
    resolveConfig({ CONTROLD_API_TOKEN: token, CONTROLD_ENABLE_WRITES: "1" }).writeToken,
    token,
  );
  assert.throws(() => resolveConfig({}), /CONTROLD_API_TOKEN_READ/);
});

test("resolveConfig reads the org default and rejects unsafe base URLs", () => {
  assert.equal(resolveConfig({ CONTROLD_API_TOKEN: token, CONTROLD_ORG_ID: "1234567890" }).orgId, "1234567890");
  assert.equal(resolveBaseUrl("https://proxy.example.com/api/"), "https://proxy.example.com/api");
  assert.equal(resolveBaseUrl("http://localhost:8080"), "http://localhost:8080");
  assert.throws(() => resolveBaseUrl("http://example.com"), /https/);
  assert.throws(() => resolveBaseUrl("https://example.com/?a=1"), /query string/);
  assert.throws(() => resolveBaseUrl("not-a-url"), /absolute URL/);
});

test("reads use the read token and writes use the write token", async () => {
  const seen: string[] = [];
  const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    seen.push(String(new Headers(init?.headers).get("authorization")));
    return ok({});
  };
  const client = createControlDClient({
    readToken: "YOUR_API_TOKEN_READ",
    writeToken: "YOUR_API_TOKEN_WRITE",
    fetch: fetch as typeof globalThis.fetch,
  });

  await client.request("/profiles");
  await client.request("/profiles", { method: "POST", body: { encoding: "form", value: {} } });
  await client.rawGet(new URL("https://abcdefghij.analytics.controld.com/log.csv"));
  assert.deepEqual(seen, ["Bearer YOUR_API_TOKEN_READ", "Bearer YOUR_API_TOKEN_WRITE", "Bearer YOUR_API_TOKEN_READ"]);
});

test("refuses a write when only a read token is configured", async () => {
  const client = createControlDClient({
    readToken: "YOUR_API_TOKEN_READ",
    fetch: (async () => ok({})) as typeof globalThis.fetch,
  });

  await assert.rejects(
    client.request("/profiles", { method: "POST" }),
    /CONTROLD_API_TOKEN_WRITE/,
  );
});

test("applies CONTROLD_ORG_ID unless a call overrides it", async () => {
  const seen: (string | null)[] = [];
  const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get("x-force-org-id"));
    return ok({});
  };
  const client = createControlDClient({
    token,
    orgId: "DEFAULT_ORG",
    fetch: fetch as typeof globalThis.fetch,
  });

  await client.request("/profiles");
  await client.request("/profiles", { subOrgId: "OTHER_ORG" });
  assert.deepEqual(seen, ["DEFAULT_ORG", "OTHER_ORG"]);
});

test("redacts both tokens and keeps a relative path on the configured host", async () => {
  assert.equal(
    redact("read=YOUR_API_TOKEN_READ write=YOUR_API_TOKEN_WRITE", ["YOUR_API_TOKEN_READ", "YOUR_API_TOKEN_WRITE"]),
    "read=[REDACTED] write=[REDACTED]",
  );

  let requested = "";
  const fetch = async (input: string | URL | Request) => {
    requested = String(input);
    return ok({});
  };
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  // A protocol-relative path must stay on api.controld.com, not become a host.
  await client.request("//example.com/steal");
  assert.equal(requested, "https://api.controld.com//example.com/steal");
});

test("retries a rate-limited request and honours Retry-After", async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return calls < 3
      ? new Response("", { status: 429, headers: { "retry-after": "0" } })
      : ok({ ok: true });
  };
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  assert.deepEqual(await client.request("/profiles"), { ok: true });
  assert.equal(calls, 3);
});

test("retries a 5xx GET but never a 5xx write", async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return new Response("", { status: 503, headers: { "retry-after": "0" } });
  };
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  await assert.rejects(client.request("/profiles"), /HTTP 503/);
  assert.equal(calls, 3, "GET should be attempted three times");

  calls = 0;
  await assert.rejects(
    client.request("/profiles", { method: "POST", body: { encoding: "form", value: {} } }),
    /HTTP 503/,
  );
  assert.equal(calls, 1, "a write must not be replayed after a server error");
});

test("reports a timeout without leaking the abort internals", async () => {
  const fetch = async () => {
    const error = new Error("aborted");
    error.name = "TimeoutError";
    throw error;
  };
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  await assert.rejects(client.request("/profiles"), /timed out/);
});

test("passes an abort signal so a hung request cannot stall the session", async () => {
  let signal: AbortSignal | null | undefined;
  const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    signal = init?.signal;
    return ok({});
  };
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  await client.request("/profiles");
  assert(signal instanceof AbortSignal);
});

test("rawGet refuses to send the token to a host outside Control D", async () => {
  let called = false;
  const fetch = async () => {
    called = true;
    return new Response("data");
  };
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  await assert.rejects(
    client.rawGet(new URL("https://example.com/log.csv")),
    /Refusing to send credentials to example\.com/,
  );
  await assert.rejects(
    client.rawGet(new URL("http://analytics.controld.com.example.com/log.csv")),
    /Refusing to send credentials/,
  );
  assert.equal(called, false, "a disallowed host must never be fetched");

  // The documented analytics host is still reachable.
  assert.deepEqual(
    await client.rawGet(new URL("https://abcdefghij.analytics.controld.com/log.csv")),
    { text: "data", truncated: false },
  );
});

test("never replays a write, including after a 429", async () => {
  for (const status of [429, 503]) {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return new Response("", { status, headers: { "retry-after": "0" } });
    };
    const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

    await assert.rejects(client.request("/profiles", {
      method: "POST",
      body: { encoding: "form", value: { name: "Example Profile" } },
    }));
    assert.equal(calls, 1, `a write must not be replayed after HTTP ${status}`);
  }
});

test("accepts an HTTP-date Retry-After", async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response("", { status: 429, headers: { "retry-after": new Date(0).toUTCString() } })
      : ok({ ok: true });
  };
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  assert.deepEqual(await client.request("/profiles"), { ok: true });
  assert.equal(calls, 2);
});

test("keeps a genuine trailing replacement character", () => {
  const encoder = new TextEncoder();
  assert.equal(decodeTruncated(encoder.encode("ok\uFFFD")), "ok\uFFFD");
  // A cut multi-byte character decodes to U+FFFD and should be dropped.
  assert.equal(decodeTruncated(encoder.encode("abcdé").subarray(0, 5)), "abcd");
});

test("redacts a token that arrives as an error code", async () => {
  const fetch = async () => new Response(JSON.stringify({
    body: [],
    success: false,
    error: { message: "denied", code: token },
  }), { status: 403 });
  const client = createControlDClient({ token, fetch: fetch as typeof globalThis.fetch });

  await assert.rejects(client.request("/profiles"), (error: unknown) => {
    assert.equal((error as Error & { code?: string }).code, "[REDACTED]");
    return true;
  });
});
