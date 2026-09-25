// Outbound HTTP for handlers: a timeout on every request, retries with
// backoff for network errors, 429 and 5xx, and errors that never carry a
// request's headers or query string.

import { scrubText } from "./log";

export type HttpResponse = { status: number; ok: boolean; headers: Headers; text: string; json<T = unknown>(): T };
export type HttpOptions = {
  method?: string;
  headers?: Record<string, string>;
  /** A string is sent as is; anything else as JSON. */
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  /** Base delay between retries (doubles each time). */
  backoffMs?: number;
  /** "manual" hands a 3xx back instead of following it (calendar feeds re-check each hop). */
  redirect?: "follow" | "manual" | "error";
};
export type Http = { request(url: string, opts?: HttpOptions): Promise<HttpResponse> };

export class HttpError extends Error {
  override name = "HttpError";
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function backoffDelay(attempt: number, baseMs: number): number {
  return Math.min(30000, baseMs * 2 ** attempt);
}

export function createHttp(fetchImpl: typeof fetch = fetch, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Http {
  return {
    async request(url, opts = {}) {
      const { method = "GET", headers = {}, body, timeoutMs = 10000, retries = 2, backoffMs = 500, redirect } = opts;
      const where = `${method} ${scrubText(url.split("?")[0] ?? url)}`;
      const init: RequestInit = { method, headers: { ...headers }, ...(redirect ? { redirect } : {}) };
      if (body !== undefined) {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
        if (typeof body !== "string" && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
          (init.headers as Record<string, string>)["content-type"] = "application/json";
        }
      }
      let lastError: HttpError | null = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await sleep(backoffDelay(attempt - 1, backoffMs));
        let res: Response;
        try {
          res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        } catch (err) {
          const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          lastError = new HttpError(
            timedOut ? `${where} timed out after ${timeoutMs} ms` : `${where} could not connect (${scrubText(err instanceof Error ? err.message : String(err))})`,
            null,
          );
          continue;
        }
        const text = await res.text();
        const response: HttpResponse = {
          status: res.status,
          ok: res.ok,
          headers: res.headers,
          text,
          json<T>() {
            try {
              return JSON.parse(text) as T;
            } catch {
              throw new HttpError(`${where} answered ${res.status} with a body that is not JSON`, res.status);
            }
          },
        };
        if (RETRY_STATUS.has(res.status) && attempt < retries) {
          lastError = new HttpError(`${where} answered ${res.status}`, res.status);
          continue;
        }
        return response;
      }
      throw lastError ?? new HttpError(`${where} failed`, null);
    },
  };
}
