const BASE_URL = "https://api.controld.com";

type FormScalar = string | number | boolean;

export type RequestBody =
  | {
      encoding: "form";
      value: Record<string, FormScalar | readonly FormScalar[] | undefined>;
    }
  | { encoding: "json"; value: unknown };

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
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
  token?: string;
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

function safeError(error: unknown, token: string): ErrorWithCode {
  const originalMessage = error instanceof Error ? error.message : "Control D API request failed.";
  const message = originalMessage
    .replace(/authorization\s*:\s*(?:Bearer\s+)?[^\s,;}\]]+/gi, "authorization: [REDACTED]")
    .split(token)
    .join("[REDACTED]");
  const safe = new Error(message) as ErrorWithCode;

  if (isRecord(error) && (typeof error.code === "string" || typeof error.code === "number")) {
    safe.code = error.code;
  }

  return safe;
}

export function createControlDClient({
  token = process.env.CONTROLD_API_TOKEN,
  fetch: fetchImpl = globalThis.fetch,
}: CreateClientOptions = {}): ControlDClient {
  if (!token) throw new Error("CONTROLD_API_TOKEN is required.");

  return {
    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
      try {
        const headers = new Headers({
          accept: "application/json",
          authorization: `Bearer ${token}`,
        });
        let body: BodyInit | undefined;

        if (options.subOrgId) headers.set("X-Force-Org-Id", options.subOrgId);
        if (options.body?.encoding === "form") {
          headers.set("content-type", "application/x-www-form-urlencoded");
          body = formBody(options.body.value);
        } else if (options.body?.encoding === "json") {
          headers.set("content-type", "application/json");
          body = JSON.stringify(options.body.value);
        }

        const response = await fetchImpl(new URL(path, BASE_URL), {
          method: options.method ?? "GET",
          headers,
          body,
        });
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
        throw safeError(error, token);
      }
    },

    async rawGet(
      url: URL,
      options: { subOrgId?: string; maxBytes?: number } = {},
    ): Promise<{ text: string; truncated: boolean }> {
      try {
        const headers = new Headers({ authorization: `Bearer ${token}` });
        if (options.subOrgId) headers.set("X-Force-Org-Id", options.subOrgId);

        const response = await fetchImpl(url, { method: "GET", headers });
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
        const text = new TextDecoder().decode(bytes).replace(/\uFFFD$/, "");
        return { text, truncated };
      } catch (error) {
        throw safeError(error, token);
      }
    },
  };
}
