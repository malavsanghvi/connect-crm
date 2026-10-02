// One place for how the background service talks to Anthropic: which model, how the client is
// built, and what a failed call means for the job that made it.
//
// niva.answer uses this first. import.suggest_mapping.ts and qbo.match_suggest_ai.ts move onto it
// later (they still carry their own model id and error handling).

import Anthropic from "@anthropic-ai/sdk";

import type { Env } from "./config";

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

/** A policy decline is re-run on Anthropic's recommended fallback model (fallbacks: "default"). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * A client for one job. The job queue does the real retrying (with backoff, and a record of each
 * attempt), so the SDK retries once at most and gives up after 30 seconds: the member app stops
 * waiting after 90.
 * ANTHROPIC_BASE_URL only points tests at a local mock server.
 */
export function anthropicClient(env: Env, opts: { timeoutMs?: number; maxRetries?: number } = {}): Anthropic {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined,
    timeout: opts.timeoutMs ?? 30_000,
    maxRetries: opts.maxRetries ?? 1,
  });
}

/**
 * What a failed Anthropic call means:
 * - auth: the key was refused (401/403). Retrying cannot help until someone fixes the key.
 * - quota: the account's spending limit or credit ran out (402 billing_error, or a 400 that says so).
 *   It comes back by itself (the limit resets, or someone raises it), so wait it out.
 * - config: the account cannot use what the request asks for: a model it has no access to (404),
 *   or a beta it is not enabled for (400 "Unexpected value(s) ... anthropic-beta").
 * - transient: rate limited, overloaded, a 5xx, a timeout or no connection. Try again later.
 * - bad_request: anything else; the same request would fail the same way.
 */
export type AnthropicErrorKind = "auth" | "quota" | "config" | "transient" | "bad_request";

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

// The API has no separate error type for a spending limit: it is a 400 invalid_request_error whose
// message says so ("You have reached your specified API usage limits. You will regain access on
// 2026-10-01 at 00:00 UTC.", "Your credit balance is too low to access the Anthropic API.").
const QUOTA_MESSAGE = /usage limit|spend(ing)? limit|credit balance/i;
const BETA_MESSAGE = /anthropic-beta/i;
const TRANSIENT_TYPES = new Set(["rate_limit_error", "overloaded_error", "api_error", "timeout_error"]);

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

/** "You will regain access on 2026-10-01 at 00:00 UTC." → that moment; null when the message has no such date. */
export function regainAccessAt(message: string): Date | null {
  const m = /regain access on (\d{4})-(\d{2})-(\d{2})(?:\D{1,6}(\d{1,2}):(\d{2}))?/i.exec(message);
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0"].map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return Number.isNaN(at.getTime()) ? null : at;
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
  const out = (kind: AnthropicErrorKind, regainAt: Date | null = null): ClassifiedError => ({ kind, status, type, message, regainAt });

  if (status === 401 || status === 403 || type === "authentication_error" || type === "permission_error") return out("auth");
  if (status === 402 || type === "billing_error") return out("quota", regainAccessAt(message));
  if (status === 400 && QUOTA_MESSAGE.test(message)) return out("quota", regainAccessAt(message));
  if (status === 400 && BETA_MESSAGE.test(message)) return out("config");
  if (status === 404 || type === "not_found_error") return out("config");
  if (status === 408 || status === 409 || status === 429 || (status !== null && status >= 500) || (type !== null && TRANSIENT_TYPES.has(type))) {
    return out("transient");
  }
  return out("bad_request");
}

/** A short label for logs and job errors: "429 rate_limit_error", "timed out", "no connection". */
export function errorLabel(c: ClassifiedError): string {
  if (c.status === null) return c.timedOut ? "timed out" : "no connection";
  return c.type ? `${c.status} ${c.type}` : String(c.status);
}
