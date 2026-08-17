const DEFAULT_BASE_URL = "https://api.controld.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const REQUEST_TIMEOUT_MS = 30_000;
const RAW_GET_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1500];
const MAX_RETRY_AFTER_MS = 10_000;

type FormScalar = string | number | boolean;

export interface ResolvedConfig {
  readToken: string;
  /** Absent when no write credential is configured; write tools stay unregistered. */
  writeToken?: string;
  baseUrl: string;
  orgId?: string;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text === "" ? undefined : text;
}

/**
 * Only https is accepted, apart from loopback hosts for local testing. The base
 * URL decides where the bearer token is sent, so a plaintext or arbitrary
 * override would be a credential leak.
 */
export function resolveBaseUrl(raw: string | undefined): string {
  const value = trimmed(raw);
  if (value === undefined) return DEFAULT_BASE_URL;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CONTROLD_API_BASE_URL must be an absolute URL.");
  }
  if (url.protocol !== "https:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      "CONTROLD_API_BASE_URL must use https, unless it points at a loopback host for testing.",
    );
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error("CONTROLD_API_BASE_URL must not contain a query string or fragment.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Read and write credentials are separate so that read tools keep using a
 * read-scoped token even on a server that can write. `CONTROLD_API_TOKEN` stays
 * supported: on its own it grants reads only, and it grants writes only when
 * `CONTROLD_ENABLE_WRITES=1`, so an existing setup never gains write tools by
 * upgrading.
 */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const shared = trimmed(env.CONTROLD_API_TOKEN);
  const readToken = trimmed(env.CONTROLD_API_TOKEN_READ) ?? shared;
  if (!readToken) {
    throw new Error("CONTROLD_API_TOKEN_READ (or CONTROLD_API_TOKEN) is required.");
  }

  const writeToken = trimmed(env.CONTROLD_API_TOKEN_WRITE)
    ?? (env.CONTROLD_ENABLE_WRITES === "1" ? shared : undefined);

  return {
    readToken,
    writeToken,
    baseUrl: resolveBaseUrl(env.CONTROLD_API_BASE_URL),
    orgId: trimmed(env.CONTROLD_ORG_ID),
  };
}

export type RequestBody =
  | {
      encoding: "form";
      value: Record<string, FormScalar | readonly FormScalar[] | undefined>;
    }
  | { encoding: "json"; value: unknown };

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: RequestBody;
  subOrgId?: string;
}

export interface ControlDClient {
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  /** Authenticated GET against an absolute Control D URL returning raw text (e.g. CSV log export). */
  rawGet(
    url: URL,
    options?: { subOrgId?: string; maxBytes?: number },
  ): Promise<{ text: string; truncated: boolean }>;
}

export interface CreateClientOptions {
  /** Convenience for tests and single-token setups: used for reads and writes. */
  token?: string;
  readToken?: string;
  writeToken?: string;
  baseUrl?: string;
  orgId?: string;
  fetch?: typeof globalThis.fetch;
}

type ErrorWithCode = Error & { code?: string | number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formBody(values: Extract<RequestBody, { encoding: "form" }>["value"]): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(`${key}[]`, String(item));
    } else {
      params.append(key, String(value));
    }
  }

  return params;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Only GET is ever retried. A write may already have taken effect before the
 * failure reached us, and 429 does not promise the request was rejected before
 * it ran (RFC 6585 section 4 defines no such guarantee), so a replayed write
 * could duplicate a profile or a rule.
 */
function shouldRetry(status: number, method: string): boolean {
  if (method !== "GET") return false;
  return status === 429 || (status >= 500 && status <= 599);
}

/** Retry-After is either a delay in seconds or an HTTP date (RFC 9110 10.2.3). */
function retryDelay(response: Response, attempt: number, now: number): number {
  const header = response.headers.get("retry-after");
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
    const at = Date.parse(header);
    if (Number.isFinite(at)) {
      return Math.min(Math.max(at - now, 0), MAX_RETRY_AFTER_MS);
    }
  }
  return BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
}

/** Frees the connection held by a response we are about to throw away. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A body that cannot be cancelled is already finished with.
  }
}

const REPLACEMENT_BYTES = [0xef, 0xbf, 0xbd] as const;

/**
 * Decodes bytes that may end mid-character. A trailing U+FFFD is dropped only
 * when it came from a split character, never when the source really ended with
 * one.
 */
export function decodeTruncated(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  if (!text.endsWith("�")) return text;
  const tail = bytes.subarray(Math.max(0, bytes.length - REPLACEMENT_BYTES.length));
  const wasEncoded = tail.length === REPLACEMENT_BYTES.length
    && REPLACEMENT_BYTES.every((byte, index) => tail[index] === byte);
  return wasEncoded ? text : text.slice(0, -1);
}

const API_DOMAIN = "controld.com";

/**
 * The bearer token must never leave Control D. `rawGet` takes a whole URL, so
 * the host is checked here rather than trusted from the caller: a future tool
 * that builds a URL carelessly must not be able to post the token elsewhere.
 * The configured base URL is allowed too, so a test or proxy host still works.
 */
export function assertAllowedHost(url: URL, baseUrl: string): void {
  const { hostname } = url;
  const allowed = hostname === API_DOMAIN
    || hostname.endsWith(`.${API_DOMAIN}`)
    || hostname === new URL(baseUrl).hostname;
  if (!allowed) {
    throw new Error(`Refusing to send credentials to ${hostname}.`);
  }
  if (url.protocol !== "https:" && !LOOPBACK_HOSTS.has(hostname)) {
    throw new Error("Refusing to send credentials over an insecure connection.");
  }
}

export function redact(text: string, tokens: readonly (string | undefined)[]): string {
  let result = text.replace(
    /authorization\s*:\s*(?:Bearer\s+)?[^\s,;}\]]+/gi,
    "authorization: [REDACTED]",
  );
  for (const token of tokens) {
    if (token) result = result.split(token).join("[REDACTED]");
  }
  return result;
}

function safeError(error: unknown, tokens: readonly (string | undefined)[]): ErrorWithCode {
  if (isRecord(error) && error.name === "TimeoutError") {
    return new Error("Control D API request timed out.") as ErrorWithCode;
  }
  const originalMessage = error instanceof Error ? error.message : "Control D API request failed.";
  const safe = new Error(redact(originalMessage, tokens)) as ErrorWithCode;

  if (isRecord(error)) {
    if (typeof error.code === "string") safe.code = redact(error.code, tokens);
    else if (typeof error.code === "number") safe.code = error.code;
  }

  return safe;
}

export function createControlDClient(options: CreateClientOptions = {}): ControlDClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const explicit = options.token ?? options.readToken ?? options.writeToken;
  const config: ResolvedConfig = explicit === undefined
    ? resolveConfig()
    : {
        readToken: options.readToken ?? options.token ?? "",
        writeToken: options.writeToken ?? options.token,
        baseUrl: resolveBaseUrl(options.baseUrl),
        orgId: options.orgId,
      };
  if (!config.readToken) throw new Error("A read token is required.");

  const tokens = [config.readToken, config.writeToken] as const;
  const tokenFor = (method: string): string => {
    if (method === "GET") return config.readToken;
    if (!config.writeToken) {
      throw new Error(
        "This operation needs a write token. Set CONTROLD_API_TOKEN_WRITE to enable writes.",
      );
    }
    return config.writeToken;
  };

  return {
    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
      try {
        const method = options.method ?? "GET";
        const headers = new Headers({
          accept: "application/json",
          authorization: `Bearer ${tokenFor(method)}`,
        });
        let body: BodyInit | undefined;

        const orgId = options.subOrgId ?? config.orgId;
        if (orgId) headers.set("X-Force-Org-Id", orgId);
        if (options.body?.encoding === "form") {
          headers.set("content-type", "application/x-www-form-urlencoded");
          body = formBody(options.body.value);
        } else if (options.body?.encoding === "json") {
          headers.set("content-type", "application/json");
          body = JSON.stringify(options.body.value);
        }

        // Concatenated, not resolved against a base: `new URL(path, base)` would
        // let a protocol-relative path such as "//example.com/x" retarget the
        // request at another host and send the token there.
        const url = new URL(`${config.baseUrl}${path}`);
        let response!: Response;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
          response = await fetchImpl(url, {
            method,
            headers,
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (attempt === MAX_ATTEMPTS - 1 || !shouldRetry(response.status, method)) break;
          const delay = retryDelay(response, attempt, Date.now());
          await discard(response);
          await sleep(delay);
        }
        const responseText = await response.text();
        let envelope: unknown;
        try {
          envelope = JSON.parse(responseText);
        } catch {
          throw new Error(`Control D API request failed (HTTP ${response.status}).`);
        }

        if (!isRecord(envelope) || typeof envelope.success !== "boolean") {
          throw new Error("Control D API returned an invalid response.");
        }
        if (!envelope.success) {
          const apiError = isRecord(envelope.error) ? envelope.error : undefined;
          const message = typeof apiError?.message === "string"
            ? apiError.message
            : "Control D API request failed.";
          const error = new Error(message) as ErrorWithCode;
          if (typeof apiError?.code === "string" || typeof apiError?.code === "number") {
            error.code = apiError.code;
          }
          throw error;
        }
        if (!response.ok) throw new Error(`Control D API request failed (HTTP ${response.status}).`);

        return envelope.body as T;
      } catch (error) {
        throw safeError(error, tokens);
      }
    },

    async rawGet(
      url: URL,
      options: { subOrgId?: string; maxBytes?: number } = {},
    ): Promise<{ text: string; truncated: boolean }> {
      try {
        const headers = new Headers({ authorization: `Bearer ${config.readToken}` });
        const orgId = options.subOrgId ?? config.orgId;
        if (orgId) headers.set("X-Force-Org-Id", orgId);

        assertAllowedHost(url, config.baseUrl);

        let response!: Response;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
          response = await fetchImpl(url, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(RAW_GET_TIMEOUT_MS),
          });
          if (attempt === MAX_ATTEMPTS - 1 || !shouldRetry(response.status, "GET")) break;
          const delay = retryDelay(response, attempt, Date.now());
          await discard(response);
          await sleep(delay);
        }
        if (!response.ok) {
          throw new Error(`Control D request failed (HTTP ${response.status}).`);
        }
        if (options.maxBytes === undefined) {
          return { text: await response.text(), truncated: false };
        }

        const reader = response.body?.getReader();
        if (!reader) return { text: "", truncated: false };

        const chunks: Uint8Array[] = [];
        let length = 0;
        let truncated = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const remaining = options.maxBytes - length;
          if (value.byteLength > remaining) {
            if (remaining > 0) chunks.push(value.subarray(0, remaining));
            length += Math.max(remaining, 0);
            truncated = true;
            await reader.cancel();
            break;
          }
          chunks.push(value);
          length += value.byteLength;
        }

        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const text = decodeTruncated(bytes);
        return { text, truncated };
      } catch (error) {
        throw safeError(error, tokens);
      }
    },
  };
}
