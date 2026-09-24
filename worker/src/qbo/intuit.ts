// Intuit endpoints and token calls (QuickBooks Online, OAuth 2.0).
//
// Community Connect's own Intuit app keys come from the worker's env:
//   INTUIT_CLIENT_ID, INTUIT_CLIENT_SECRET            the production app (real companies)
//   INTUIT_SANDBOX_CLIENT_ID, INTUIT_SANDBOX_CLIENT_SECRET
//                                                     optional: Intuit's development keys,
//                                                     for Intuit sandbox companies
//   INTUIT_OAUTH_BASE      overrides https://oauth.platform.intuit.com (tests: the local mock)
//   INTUIT_API_BASE        overrides https://quickbooks.api.intuit.com
//   INTUIT_SANDBOX_API_BASE overrides https://sandbox-quickbooks.api.intuit.com
//                           (falls back to INTUIT_API_BASE when only that is set)

import type { Env } from "../config";
import { NotConfiguredError, PermanentError } from "../errors";
import { HttpError, type Http } from "../http";

export type IntuitApp = "production" | "sandbox";

export const MINOR_VERSION = "75";

const clean = (v: string | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim().replace(/\/+$/, "") : null);

export function tokenUrl(env: Env): string {
  return `${clean(env.INTUIT_OAUTH_BASE) ?? "https://oauth.platform.intuit.com"}/oauth2/v1/tokens/bearer`;
}

export function apiBase(env: Env, app: IntuitApp): string {
  if (app === "sandbox") return clean(env.INTUIT_SANDBOX_API_BASE) ?? clean(env.INTUIT_API_BASE) ?? "https://sandbox-quickbooks.api.intuit.com";
  return clean(env.INTUIT_API_BASE) ?? "https://quickbooks.api.intuit.com";
}

/** The client id + secret for this kind of company; sandbox companies use the sandbox keys when they are set. */
export function appKeys(env: Env, app: IntuitApp): { id: string; secret: string } {
  if (app === "sandbox" && clean(env.INTUIT_SANDBOX_CLIENT_ID) && clean(env.INTUIT_SANDBOX_CLIENT_SECRET)) {
    return { id: clean(env.INTUIT_SANDBOX_CLIENT_ID)!, secret: clean(env.INTUIT_SANDBOX_CLIENT_SECRET)! };
  }
  const id = clean(env.INTUIT_CLIENT_ID);
  const secret = clean(env.INTUIT_CLIENT_SECRET);
  if (!id || !secret) {
    throw new NotConfiguredError("QuickBooks (Intuit) is not configured on the background service (needs INTUIT_CLIENT_ID + INTUIT_CLIENT_SECRET)");
  }
  return { id, secret };
}

export type Tokens = { accessToken: string; refreshToken: string; accessExpiresAt: string; refreshExpiresAt: string };

/** Intuit refused the grant: the person must connect again. */
export class ReconnectNeededError extends PermanentError {
  override name = "ReconnectNeededError";
}

export async function tokenRequest(http: Http, env: Env, app: IntuitApp, form: Record<string, string>, now = Date.now()): Promise<Tokens> {
  const keys = appKeys(env, app);
  const res = await http.request(tokenUrl(env), {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${keys.id}:${keys.secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
    timeoutMs: 15000,
  });
  let body: Record<string, unknown> = {};
  try {
    body = res.json<Record<string, unknown>>();
  } catch {
    body = {};
  }
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    if (code === "invalid_grant") {
      throw new ReconnectNeededError("Intuit no longer accepts Community Connect's sign-in to this QuickBooks company (invalid_grant). Connect QuickBooks again.");
    }
    if (code === "invalid_client") {
      throw new NotConfiguredError("Intuit refused Community Connect's app keys (invalid_client). Check INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET.");
    }
    throw new HttpError(`Intuit's token service answered ${res.status} (${code})`, res.status);
  }
  const access = body.access_token, refresh = body.refresh_token;
  if (typeof access !== "string" || typeof refresh !== "string") throw new HttpError("Intuit's token service answered without tokens", res.status);
  const exp = Number(body.expires_in ?? 3600), rexp = Number(body.x_refresh_token_expires_in ?? 8726400);
  return {
    accessToken: access,
    refreshToken: refresh,
    accessExpiresAt: new Date(now + exp * 1000).toISOString(),
    refreshExpiresAt: new Date(now + rexp * 1000).toISOString(),
  };
}

/** A QuickBooks "Fault" (validation, business rule, auth) in one plain sentence. */
export function faultMessage(body: unknown, status: number): string {
  const f = (body as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } } | null)?.Fault;
  const e = f?.Error?.[0];
  if (!e) return `QuickBooks answered ${status}`;
  const detail = e.Detail && e.Detail !== e.Message ? `: ${e.Detail}` : "";
  return `QuickBooks refused it — ${e.Message ?? "error"}${detail}${e.code ? ` (code ${e.code})` : ""}`;
}
