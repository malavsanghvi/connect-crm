// One place for how the background service talks to Anthropic: which model, how the client is
// built, and what a failed call means for the job that made it.
//
// niva.answer, import.suggest_mapping and qbo.match_suggest_ai all build their client here and
// read a failure with classifyAnthropicError. What each call by a client built here finally gets
// is also recorded in the service's AI status (worker/src/ai-status.ts), which the heartbeat
// reports.

import Anthropic from "@anthropic-ai/sdk";

import { anthropicErrorKind, regainAccessAt, type AnthropicErrorKind } from "../../src/lib/anthropic-errors";
import { aiStatus, recordAnthropicNoAnswer, recordAnthropicResponse, type AiStatus } from "./ai-status";
import type { Env } from "./config";

export { regainAccessAt, type AnthropicErrorKind };

/**
 * The current Opus. The CLAUDE_MODEL repository variable overrides it (for example when the
 * account cannot use this model): deploy.yml writes it into the background service's env, so it
 * takes effect on the next deploy and survives the ones after. A value typed into
 * /srv/connect/worker.env by hand is overwritten by the next deploy.
 */
export const CLAUDE_MODEL = "claude-opus-5-5";

export function claudeModel(env: Env): string {
  return env.CLAUDE_MODEL?.trim() || CLAUDE_MODEL;
}

/**
 * Niva's model (owner decision 2026-10-02). Niva answers from each community's own content in the database first, at
 * no AI cost (migration 0579); only a community that turned AI answers on (rules.niva.ai = 'haiku') ever reaches the
 * AI, and then this small model writes the answer. CLAUDE_MODEL does not change it: it is for the staff-side
 * suggestions, which still use the current Opus.
 */
export const NIVA_MODEL = "claude-haiku-4-5-20251001";

/** A policy decline is re-run on Anthropic's recommended fallback model (fallbacks: "default"). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The SDK's fetch signature (@anthropic-ai/sdk internal/builtin-types Fetch). */
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Which try of one SDK call this fetch is (0 = the first), from the X-Stainless-Retry-Count header
 * the SDK sends with every try; null when the header is not there.
 */
export function attemptOf(input: string | URL | Request, init?: RequestInit): number | null {
  let raw: string | null;
  try {
    raw = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("x-stainless-retry-count");
  } catch {
    return null;
  }
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Whether the SDK tries this answer again by itself (its shouldRetry for a call made with an API
 * key): what Anthropic's x-should-retry says when it is sent, else a 408, 409, 429 or any 5xx.
 */
export function sdkRetries(res: Response): boolean {
  const said = res.headers.get("x-should-retry");
  if (said === "true") return true;
  if (said === "false") return false;
  return res.status === 408 || res.status === 409 || res.status === 429 || res.status >= 500;
}

/**
 * A fetch that records in `status` what each call to Anthropic finally got, before the SDK sees
 * it: a 2xx as working, an error status by what its body says (the body is read from a clone, so
 * the SDK still gets it whole), and no answer at all (no connection, the client's timeout) as
 * unreachable.
 *
 * A try the SDK makes again by itself (a 529 or 429, a 5xx, no connection or its own timeout,
 * while it has retries left of `maxRetries`, the client's own) is not recorded: the next try's
 * answer is. So a busy moment the SDK's retry gets past leaves the status, and with it the
 * audited heartbeat, as it was, and a call that fails on every try is recorded once, by its last
 * try. A fetch the SDK does not number counts as a last try.
 */
export function recordingFetch(status: AiStatus, inner: Fetch = (input, init) => globalThis.fetch(input, init), maxRetries = 0): Fetch {
  return async (input, init) => {
    const attempt = attemptOf(input, init);
    const triesLeft = attempt !== null && attempt < maxRetries;
    let res: Response;
    try {
      res = await inner(input, init);
    } catch (err) {
      if (!triesLeft) recordAnthropicNoAnswer(status, err);
      throw err;
    }
    if (res.ok) recordAnthropicResponse(status, res.status, "");
    else if (!(triesLeft && sdkRetries(res))) recordAnthropicResponse(status, res.status, await res.clone().text().catch(() => ""));
    return res;
  };
}

/**
 * A client for one job. The job queue does the real retrying (with backoff, and a record of each
 * attempt), so by default the SDK retries once at most and gives up after 30 seconds: the member
 * app stops waiting for Niva after 90. Longer staff-side jobs pass their own limits.
 * ANTHROPIC_BASE_URL only points tests at a local mock server.
 */
export function anthropicClient(
  env: Env,
  opts: { timeoutMs?: number; maxRetries?: number; status?: AiStatus; fetch?: Fetch } = {},
): Anthropic {
  const maxRetries = opts.maxRetries ?? 1;
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined,
    timeout: opts.timeoutMs ?? 30_000,
    maxRetries,
    fetch: recordingFetch(opts.status ?? aiStatus, opts.fetch, maxRetries),
  });
}

/**
 * What a failed Anthropic call means (the kinds are described in src/lib/anthropic-errors.ts):
 * auth (key refused), quota (spending limit or credit), config (model or beta not available to the
 * account), transient (busy, rate limited, timed out, no connection), bad_request (anything else).
 */
export type ClassifiedError = {
  kind: AnthropicErrorKind;
  /** HTTP status, or null when the call never got a response. */
  status: number | null;
  /** The API's error.type (for example "rate_limit_error"), when it sent one. */
  type: string | null;
  /** The API's own message (not the SDK's "400 {json}" rendering). */
  message: string;
  /** quota only: when the API said access comes back ("You will regain access on …"), else null. */
  regainAt: Date | null;
  /** The call got no answer within the client's timeout (rather than no connection at all). */
  timedOut?: boolean;
};

/** The message inside the API's error body ({type:"error", error:{type, message}}), else the error's own. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const body = err.error as { error?: { message?: unknown }; message?: unknown } | undefined;
    const inner = body?.error?.message ?? body?.message;
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  }
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

export function classifyAnthropicError(err: unknown): ClassifiedError {
  const message = apiErrorMessage(err);
  // No response at all (DNS, refused connection, the 30 s timeout): APIConnectionError extends APIError,
  // and APIConnectionTimeoutError extends APIConnectionError.
  if (err instanceof Anthropic.APIConnectionError) {
    const timedOut = err instanceof Anthropic.APIConnectionTimeoutError;
    return { kind: "transient", status: null, type: null, message, regainAt: null, timedOut };
  }
  if (!(err instanceof Anthropic.APIError)) return { kind: "bad_request", status: null, type: null, message, regainAt: null };

  const status = typeof err.status === "number" ? err.status : null;
  const type = err.type ?? null;
  const kind = anthropicErrorKind(status, type, message);
  return { kind, status, type, message, regainAt: kind === "quota" ? regainAccessAt(message) : null };
}

/** A short label for logs and job errors: "429 rate_limit_error", "timed out", "no connection". */
export function errorLabel(c: ClassifiedError): string {
  if (c.status === null) return c.timedOut ? "timed out" : "no connection";
  return c.type ? `${c.status} ${c.type}` : String(c.status);
}

/**
 * The plain sentence a staff-side job (mapping or matching suggestions) fails with, and whether the
 * queue should try again. Niva has its own handling (niva.answer.ts: it waits out a spending limit
 * and writes the outcome on the question).
 */
export function staffJobFailure(c: ClassifiedError, model: string, what: string): { message: string; retry: boolean; notConfigured: boolean } {
  const detail = `${errorLabel(c)}${c.message ? `: ${c.message}` : ""}`;
  switch (c.kind) {
    case "auth":
      return { message: `The Anthropic key on the background service was refused (ANTHROPIC_API_KEY; ${errorLabel(c)}).`, retry: false, notConfigured: true };
    case "quota":
      return {
        message: `The AI service's spending limit was reached, so ${what} could not be made (${detail}). Try again once the limit resets or is raised.`,
        retry: false,
        notConfigured: false,
      };
    case "config":
      return {
        message:
          c.status === 404
            ? `The AI model (${model}) is not available to this Anthropic account (${detail}).`
            : `The Anthropic account is not set up for a feature the request for ${what} uses (the server-side fallback; ${detail}).`,
        retry: false,
        notConfigured: false,
      };
    case "transient":
      return {
        message: `${c.timedOut ? "The AI service did not answer in time" : "The AI service was busy or could not be reached"} (${detail}).`,
        retry: true,
        notConfigured: false,
      };
    case "bad_request":
      return { message: `The AI service did not accept the request for ${what} (${detail}).`, retry: false, notConfigured: false };
  }
}
