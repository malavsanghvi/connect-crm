// Stripe and PayPal for the payment handlers: which platform keys a mode
// needs, how requests are made, and the small parsing both need. Base URLs
// can be pointed at local mock servers (STRIPE_API_BASE, STRIPE_CONNECT_BASE,
// PAYPAL_API_BASE, PAYPAL_SANDBOX_API_BASE) — tests never reach the network.
//
// Platform keys (Community Connect's own apps; the organization's account is
// addressed by its connected account id / merchant id, never by its keys):
//   Stripe   STRIPE_SECRET_KEY (live), STRIPE_TEST_SECRET_KEY (test), STRIPE_CLIENT_ID (Connect OAuth)
//   PayPal   PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET (live),
//            PAYPAL_SANDBOX_CLIENT_ID + PAYPAL_SANDBOX_CLIENT_SECRET (test), PAYPAL_PARTNER_ID

import type { Env } from "../config";
import { NotConfiguredError, PermanentError } from "../errors";
import { HttpError, type Http, type HttpResponse } from "../http";

export type Mode = "test" | "live";

export function asMode(v: unknown): Mode {
  return v === "live" ? "live" : "test";
}

const val = (env: Env, name: string) => (env[name] ?? "").trim();

// ── Stripe ──────────────────────────────────────────────────────────────────

export function stripeKey(env: Env, mode: Mode): string {
  if (mode === "live") {
    const k = val(env, "STRIPE_SECRET_KEY");
    if (!k) throw new NotConfiguredError("Stripe isn't configured on the Community Connect server yet (STRIPE_SECRET_KEY not set)");
    if (/^(sk|rk)_test_/.test(k)) throw new NotConfiguredError("Stripe live mode needs a live STRIPE_SECRET_KEY; the one set is a test key");
    return k;
  }
  const t = val(env, "STRIPE_TEST_SECRET_KEY") || val(env, "STRIPE_SECRET_KEY");
  if (!t) throw new NotConfiguredError("Stripe isn't configured on the Community Connect server yet (STRIPE_TEST_SECRET_KEY not set)");
  if (/^(sk|rk)_live_/.test(t)) throw new NotConfiguredError("Stripe test mode needs STRIPE_TEST_SECRET_KEY; only a live key is set");
  return t;
}

export const stripeBase = (env: Env) => (val(env, "STRIPE_API_BASE") || "https://api.stripe.com").replace(/\/+$/, "");
export const stripeConnectBase = (env: Env) => (val(env, "STRIPE_CONNECT_BASE") || "https://connect.stripe.com").replace(/\/+$/, "");

/** Stripe's form encoding: nested objects and arrays as a[b][0]=v. */
export function formEncode(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") parts.push(formEncode(item as Record<string, unknown>, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      const inner = formEncode(v as Record<string, unknown>, key);
      if (inner) parts.push(inner);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

type StripeOpts = { method?: string; account?: string | null; body?: Record<string, unknown>; idempotencyKey?: string; base?: string };

export async function stripeRequest<T = Record<string, unknown>>(http: Http, env: Env, mode: Mode, path: string, opts: StripeOpts = {}): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${stripeKey(env, mode)}`, "stripe-version": "2024-06-20" };
  if (opts.account) headers["stripe-account"] = opts.account;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  let body: string | undefined;
  if (opts.body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = formEncode(opts.body);
  }
  const res = await http.request(`${opts.base ?? stripeBase(env)}${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  return parseProvider<T>("Stripe", res);
}

// ── PayPal ──────────────────────────────────────────────────────────────────

export function paypalCreds(env: Env, mode: Mode): { base: string; clientId: string; secret: string } {
  const live = mode === "live";
  const idName = live ? "PAYPAL_CLIENT_ID" : "PAYPAL_SANDBOX_CLIENT_ID";
  const secretName = live ? "PAYPAL_CLIENT_SECRET" : "PAYPAL_SANDBOX_CLIENT_SECRET";
  const missing = [idName, secretName].filter((n) => !val(env, n));
  if (missing.length > 0) {
    throw new NotConfiguredError(`PayPal isn't configured on the Community Connect server yet (${missing.join(", ")} not set)`);
  }
  const base = live ? val(env, "PAYPAL_API_BASE") || "https://api-m.paypal.com" : val(env, "PAYPAL_SANDBOX_API_BASE") || "https://api-m.sandbox.paypal.com";
  return { base: base.replace(/\/+$/, ""), clientId: val(env, idName), secret: val(env, secretName) };
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");

/** PayPal-Auth-Assertion: act for a merchant who granted the platform permission (unsigned, as PayPal documents). */
export function paypalAuthAssertion(clientId: string, merchantId: string): string {
  return `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify({ iss: clientId, payer_id: merchantId }))}.`;
}

const tokens = new Map<string, { token: string; until: number }>();

export async function paypalToken(http: Http, env: Env, mode: Mode, now = Date.now()): Promise<string> {
  const c = paypalCreds(env, mode);
  const key = `${c.base}|${c.clientId}`;
  const hit = tokens.get(key);
  if (hit && hit.until > now) return hit.token;
  const res = await http.request(`${c.base}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${c.clientId}:${c.secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const out = await parseProvider<{ access_token?: string; expires_in?: number }>("PayPal", res);
  if (!out.access_token) throw new HttpError("PayPal did not return an access token", res.status);
  tokens.set(key, { token: out.access_token, until: now + Math.max(60, (out.expires_in ?? 300) - 60) * 1000 });
  return out.access_token;
}

export function clearPaypalTokens() {
  tokens.clear();
}

type PaypalOpts = { method?: string; body?: unknown; requestId?: string; merchantId?: string | null };

export async function paypalRequest<T = Record<string, unknown>>(http: Http, env: Env, mode: Mode, path: string, opts: PaypalOpts = {}): Promise<T> {
  const c = paypalCreds(env, mode);
  const headers: Record<string, string> = { authorization: `Bearer ${await paypalToken(http, env, mode)}`, "content-type": "application/json" };
  if (opts.requestId) headers["paypal-request-id"] = opts.requestId;
  if (opts.merchantId) headers["paypal-auth-assertion"] = paypalAuthAssertion(c.clientId, opts.merchantId);
  const res = await http.request(`${c.base}${path}`, { method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers, body: opts.body ?? undefined });
  return parseProvider<T>("PayPal", res);
}

// ── Shared ──────────────────────────────────────────────────────────────────

/** A provider answer: JSON on 2xx; a plain error otherwise (4xx will not get better by retrying). */
export function parseProvider<T>(provider: string, res: HttpResponse): T {
  let body: Record<string, unknown> = {};
  try {
    body = res.text ? (JSON.parse(res.text) as Record<string, unknown>) : {};
  } catch {
    if (res.ok) throw new HttpError(`${provider} answered ${res.status} with a body that is not JSON`, res.status);
  }
  if (res.ok) return body as T;
  const err = body.error as Record<string, unknown> | string | undefined;
  const msg =
    (typeof err === "object" && err ? String(err.message ?? err.code ?? "") : typeof err === "string" ? String(body.error_description ?? err) : "") ||
    String(body.message ?? body.name ?? "") ||
    `HTTP ${res.status}`;
  const text = `${provider} refused the request: ${msg}`;
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    const e = new PermanentError(text);
    (e as PermanentError & { status?: number; body?: unknown }).status = res.status;
    (e as PermanentError & { status?: number; body?: unknown }).body = body;
    throw e;
  }
  throw new HttpError(text, res.status);
}

/** "12.34" → 1234 (integer cents; never floating arithmetic). */
export function decimalToCents(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(v).trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

export function centsToDecimal(c: number): string {
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** Stripe charge → our method: card, apple_pay, google_pay or ach. */
export function stripeMethod(charge: Record<string, unknown> | null | undefined): { method: string; detail: string | null } {
  const pmd = (charge?.payment_method_details ?? {}) as Record<string, Record<string, unknown> | string | undefined>;
  const type = String(pmd.type ?? "card");
  if (type === "us_bank_account" || type === "ach_debit" || type === "ach_credit_transfer") {
    const b = (pmd[type] ?? {}) as Record<string, unknown>;
    return { method: "ach", detail: b.last4 ? `Bank ••${String(b.last4)}` : "Bank account" };
  }
  const card = (pmd.card ?? {}) as Record<string, unknown>;
  const wallet = ((card.wallet ?? {}) as Record<string, unknown>).type;
  const detail = card.brand ? `${String(card.brand)} ••${String(card.last4 ?? "")}` : null;
  if (wallet === "apple_pay") return { method: "apple_pay", detail };
  if (wallet === "google_pay") return { method: "google_pay", detail };
  return { method: "card", detail };
}

/** PayPal order/capture payment_source → our method: paypal, venmo or card. */
export function paypalMethod(source: Record<string, unknown> | null | undefined): string {
  if (!source) return "paypal";
  if ("venmo" in source) return "venmo";
  if ("card" in source) return "card";
  return "paypal";
}
