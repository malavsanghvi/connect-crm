// What a failed Anthropic API call means, from its HTTP status and error body alone. Pure (no
// imports), so the portal's setup wizard check (platform-setup/checks.ts) and the background
// service (worker/src/anthropic.ts, worker/src/ai-status.ts) read a response the same way.
//
// - auth: the key was refused (401/403). Retrying cannot help until someone fixes the key.
// - quota: the account's spending limit or credit ran out (402 billing_error, or a 400 that says
//   so). It comes back by itself (the limit resets, or someone raises it), so wait it out.
// - config: the account cannot use what the request asks for: a model it has no access to (404),
//   or a beta it is not enabled for (400 "Unexpected value(s) ... anthropic-beta").
// - transient: rate limited, overloaded, a 5xx, a timeout or no connection. Try again later.
// - bad_request: anything else; the same request would fail the same way.

export type AnthropicErrorKind = "auth" | "quota" | "config" | "transient" | "bad_request";

// The API has no separate error type for a spending limit: it is a 400 invalid_request_error whose
// message says so ("You have reached your specified API usage limits. You will regain access on
// 2026-10-01 at 00:00 UTC.", "Your credit balance is too low to access the Anthropic API.").
const QUOTA_MESSAGE = /usage limit|spend(ing)? limit|credit balance/i;
const BETA_MESSAGE = /anthropic-beta/i;
const TRANSIENT_TYPES = new Set(["rate_limit_error", "overloaded_error", "api_error", "timeout_error"]);

/**
 * The kind of failure, from the HTTP status and the API's error.type and message. A call that got
 * no answer at all (no connection, a timeout) is "transient"; callers know that without a status.
 */
export function anthropicErrorKind(status: number | null, type: string | null, message: string): AnthropicErrorKind {
  if (status === 401 || status === 403 || type === "authentication_error" || type === "permission_error") return "auth";
  if (status === 402 || type === "billing_error") return "quota";
  if (status === 400 && QUOTA_MESSAGE.test(message)) return "quota";
  if (status === 400 && BETA_MESSAGE.test(message)) return "config";
  if (status === 404 || type === "not_found_error") return "config";
  if (status === 408 || status === 409 || status === 429 || (status !== null && status >= 500) || (type !== null && TRANSIENT_TYPES.has(type))) {
    return "transient";
  }
  return "bad_request";
}

/** {type:"error", error:{type, message}} → its type and message; else no type and the start of the text. */
export function anthropicErrorBody(text: string): { type: string | null; message: string } {
  try {
    const body = JSON.parse(text) as { error?: { type?: unknown; message?: unknown } } | null;
    const e = body && typeof body === "object" ? body.error : undefined;
    if (e && typeof e === "object") {
      return {
        type: typeof e.type === "string" ? e.type : null,
        message: typeof e.message === "string" ? e.message.trim() : "",
      };
    }
  } catch {
    // not JSON: fall through
  }
  return { type: null, message: text.trim().slice(0, 300) };
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
