import "server-only";

import { workerQuery } from "@/lib/messaging/server-db";
import { loadPlatformConfig, platformValue } from "@/lib/platform-setup/server-config";

// Talking to Stripe and PayPal from the portal server: the checkout the payer
// is sent to, the connect links, and PayPal's webhook check. Community
// Connect's own platform keys come from the server's environment only (never
// NEXT_PUBLIC_*, never a browser); an organization is addressed by its
// connected account id / merchant id. Base URLs can point at local mocks.
//
//   STRIPE_SECRET_KEY, STRIPE_TEST_SECRET_KEY, STRIPE_CLIENT_ID, STRIPE_WEBHOOK_SECRET,
//   STRIPE_API_BASE, STRIPE_CONNECT_BASE
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_SANDBOX_CLIENT_ID, PAYPAL_SANDBOX_CLIENT_SECRET,
//   PAYPAL_PARTNER_ID, PAYPAL_BN_CODE, PAYPAL_WEBHOOK_ID, PAYPAL_SANDBOX_WEBHOOK_ID,
//   PAYPAL_API_BASE, PAYPAL_SANDBOX_API_BASE
//   Each is read from the platform setup wizard first (app.platform_secrets / platform_settings,
//   src/lib/platform-setup/server-config.ts), then the environment: callers await loadPlatformConfig().
//   PORTAL_DATABASE_URL         (webhook routes: app.ingest_webhook as connect_worker; falls back to WORKER_DATABASE_URL)

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { newRequestId } from "@/lib/supabase/trace";
import type { AppSupabase } from "@/lib/supabase/server";

import { centsToDecimal, stripePaymentMethodTypes, type Processor } from "./view";

export type Mode = "test" | "live";

/** A platform setting is missing: the plain sentence names the variables, never a value. */
export class NotConfigured extends Error {
  override name = "NotConfigured";
}
/** The provider refused or failed; the message is safe to show. */
export class ProviderError extends Error {
  override name = "ProviderError";
}

const val = (name: string) => platformValue(name);

// ── Clients ──────────────────────────────────────────────────────────────────

/** A client acting as the caller of a route (the member app sends its own access token). */
export function tokenClient(token: string, clientApp: "member" | "portal", screen: string): AppSupabase | null {
  const env = readPublicEnv();
  if (!env.ok) return null;
  return createClient<Database, "app">(env.env.supabaseUrl, env.env.supabaseAnonKey, {
    db: { schema: "app" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { authorization: `Bearer ${token}`, "x-client-app": clientApp, "x-request-id": newRequestId(), "x-client-screen": screen } },
  });
}

// ── Stripe ───────────────────────────────────────────────────────────────────

export function stripeKey(mode: Mode): string {
  if (mode === "live") {
    const k = val("STRIPE_SECRET_KEY");
    if (!k) throw new NotConfigured("Stripe isn't configured on the Community Connect server yet (STRIPE_SECRET_KEY is not set).");
    if (/^(sk|rk)_test_/.test(k)) throw new NotConfigured("Stripe live mode needs a live STRIPE_SECRET_KEY on the Community Connect server; the one set is a test key.");
    return k;
  }
  const t = val("STRIPE_TEST_SECRET_KEY") || val("STRIPE_SECRET_KEY");
  if (!t) throw new NotConfigured("Stripe isn't configured on the Community Connect server yet (STRIPE_TEST_SECRET_KEY is not set).");
  if (/^(sk|rk)_live_/.test(t)) throw new NotConfigured("Stripe test mode needs STRIPE_TEST_SECRET_KEY on the Community Connect server; only a live key is set.");
  return t;
}
const stripeBase = () => (val("STRIPE_API_BASE") || "https://api.stripe.com").replace(/\/+$/, "");
const stripeConnectBase = () => (val("STRIPE_CONNECT_BASE") || "https://connect.stripe.com").replace(/\/+$/, "");

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
    } else if (typeof v === "object") parts.push(formEncode(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join("&");
}

async function providerJson(provider: string, res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  if (res.ok) return body;
  const err = body.error;
  const msg =
    (err && typeof err === "object" ? String((err as Record<string, unknown>).message ?? "") : typeof err === "string" ? String(body.error_description ?? err) : "") ||
    String(body.message ?? body.name ?? "") ||
    `HTTP ${res.status}`;
  console.error(`[payments] ${provider} answered ${res.status}: ${msg}`);
  throw new ProviderError(`${provider} refused the request: ${msg}`);
}

async function send(url: string, init: RequestInit, provider: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    console.error(`[payments] could not reach ${provider} (${url.split("?")[0]}):`, err);
    throw new ProviderError(`${provider} could not be reached. Try again in a minute.`);
  }
  return providerJson(provider, res);
}

export type CheckoutInfo = {
  checkout_id: string;
  processor: Processor;
  mode: Mode;
  amount_cents: number;
  currency: string;
  account_id: string | null;
  payee_email: string | null;
  statement_descriptor: string | null;
  methods: string[];
  center_name: string;
  for_label: string;
};

export type ProviderCheckout = { providerRef: string; url: string };

async function stripeCheckout(c: CheckoutInfo, successUrl: string, cancelUrl: string): Promise<ProviderCheckout> {
  await loadPlatformConfig();
  if (!c.account_id) throw new ProviderError("The organization's Stripe account is not connected.");
  const suffix = (c.statement_descriptor ?? "").trim().slice(0, 22);
  const body = formEncode({
    mode: "payment",
    client_reference_id: c.checkout_id,
    success_url: successUrl,
    cancel_url: cancelUrl,
    payment_method_types: stripePaymentMethodTypes(c.methods),
    line_items: [{ quantity: 1, price_data: { currency: c.currency || "usd", unit_amount: c.amount_cents, product_data: { name: `${c.for_label} · ${c.center_name}`.slice(0, 250) } } }],
    metadata: { checkout_id: c.checkout_id },
    payment_intent_data: { metadata: { checkout_id: c.checkout_id }, ...(suffix.length >= 2 ? { statement_descriptor_suffix: suffix } : {}) },
  });
  const s = await send(`${stripeBase()}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${stripeKey(c.mode)}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-account": c.account_id,
      "idempotency-key": `checkout-${c.checkout_id}`,
    },
    body,
  }, "Stripe");
  if (typeof s.id !== "string" || typeof s.url !== "string") throw new ProviderError("Stripe did not return a checkout page.");
  return { providerRef: s.id, url: s.url };
}

/** Stripe Connect (Standard) sign-in link for the organization (await loadPlatformConfig() first). */
export function stripeAuthorizeUrl(state: string, redirectUri: string): string {
  const client = val("STRIPE_CLIENT_ID");
  if (!client) throw new NotConfigured("Stripe Connect isn't configured on the Community Connect server yet (STRIPE_CLIENT_ID is not set).");
  const q = new URLSearchParams({ response_type: "code", client_id: client, scope: "read_write", state, redirect_uri: redirectUri });
  return `${stripeConnectBase()}/oauth/authorize?${q.toString()}`;
}

// ── PayPal ───────────────────────────────────────────────────────────────────

export function paypalCreds(mode: Mode): { base: string; clientId: string; secret: string } {
  const live = mode === "live";
  const idName = live ? "PAYPAL_CLIENT_ID" : "PAYPAL_SANDBOX_CLIENT_ID";
  const secretName = live ? "PAYPAL_CLIENT_SECRET" : "PAYPAL_SANDBOX_CLIENT_SECRET";
  const missing = [idName, secretName].filter((n) => !val(n));
  if (missing.length) throw new NotConfigured(`PayPal isn't configured on the Community Connect server yet (${missing.join(", ")} not set).`);
  const base = live ? val("PAYPAL_API_BASE") || "https://api-m.paypal.com" : val("PAYPAL_SANDBOX_API_BASE") || "https://api-m.sandbox.paypal.com";
  return { base: base.replace(/\/+$/, ""), clientId: val(idName), secret: val(secretName) };
}

export async function paypalToken(mode: Mode): Promise<{ base: string; token: string; clientId: string }> {
  await loadPlatformConfig();
  const c = paypalCreds(mode);
  const t = await send(`${c.base}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${c.clientId}:${c.secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }, "PayPal");
  if (typeof t.access_token !== "string") throw new ProviderError("PayPal did not return an access token.");
  return { base: c.base, token: t.access_token, clientId: c.clientId };
}

async function paypalCheckout(c: CheckoutInfo, returnUrl: string, cancelUrl: string): Promise<ProviderCheckout> {
  const { base, token } = await paypalToken(c.mode);
  const payee = c.account_id ? { merchant_id: c.account_id } : c.payee_email ? { email_address: c.payee_email } : null;
  if (!payee) throw new ProviderError("The organization's PayPal account is not connected.");
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": "application/json", "paypal-request-id": `checkout-${c.checkout_id}` };
  if (c.account_id && val("PAYPAL_BN_CODE")) headers["paypal-partner-attribution-id"] = val("PAYPAL_BN_CODE");
  const o = await send(`${base}/v2/checkout/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: c.checkout_id,
        custom_id: c.checkout_id,
        description: c.for_label.slice(0, 127),
        amount: { currency_code: (c.currency || "usd").toUpperCase(), value: centsToDecimal(c.amount_cents) },
        payee,
        ...(c.statement_descriptor ? { soft_descriptor: c.statement_descriptor.slice(0, 22) } : {}),
      }],
      payment_source: { paypal: { experience_context: { return_url: returnUrl, cancel_url: cancelUrl, brand_name: c.center_name.slice(0, 127), user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING" } } },
    }),
  }, "PayPal");
  const link = ((o.links as { rel?: string; href?: string }[] | undefined) ?? []).find((l) => l.rel === "payer-action" || l.rel === "approve");
  if (typeof o.id !== "string" || !link?.href) throw new ProviderError("PayPal did not return an approval page.");
  return { providerRef: o.id, url: link.href };
}

/** "Connect with PayPal": a partner-referral link; PayPal sends the merchant back to returnUrl. */
export async function paypalReferralUrl(mode: Mode, trackingId: string, returnUrl: string): Promise<string> {
  await loadPlatformConfig();
  if (!val("PAYPAL_PARTNER_ID")) throw new NotConfigured("Connect with PayPal isn't configured on the Community Connect server yet (PAYPAL_PARTNER_ID is not set). Use the PayPal Business email instead.");
  const { base, token } = await paypalToken(mode);
  const r = await send(`${base}/v2/customer/partner-referrals`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      tracking_id: trackingId,
      operations: [{ operation: "API_INTEGRATION", api_integration_preference: { rest_api_integration: { integration_method: "PAYPAL", integration_type: "THIRD_PARTY", third_party_details: { features: ["PAYMENT", "REFUND"] } } } }],
      products: ["EXPRESS_CHECKOUT"],
      legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
      partner_config_override: { return_url: returnUrl },
    }),
  }, "PayPal");
  const link = ((r.links as { rel?: string; href?: string }[] | undefined) ?? []).find((l) => l.rel === "action_url");
  if (!link?.href) throw new ProviderError("PayPal did not return a sign-up link.");
  return link.href;
}

/** PayPal webhooks are checked by PayPal: try each configured (mode, webhook id). */
export async function verifyPaypalWebhook(body: (webhookId: string) => Record<string, unknown> | null): Promise<{ ok: boolean; reason: string }> {
  await loadPlatformConfig();
  const pairs: [Mode, string][] = [];
  if (val("PAYPAL_WEBHOOK_ID") && val("PAYPAL_CLIENT_ID")) pairs.push(["live", val("PAYPAL_WEBHOOK_ID")]);
  if (val("PAYPAL_SANDBOX_WEBHOOK_ID") && val("PAYPAL_SANDBOX_CLIENT_ID")) pairs.push(["test", val("PAYPAL_SANDBOX_WEBHOOK_ID")]);
  if (pairs.length === 0) throw new NotConfigured("PayPal webhooks aren't configured on the Community Connect server yet (PAYPAL_WEBHOOK_ID or PAYPAL_SANDBOX_WEBHOOK_ID with its client id).");
  for (const [mode, id] of pairs) {
    const b = body(id);
    if (!b) return { ok: false, reason: "the PayPal transmission headers are missing" };
    const { base, token } = await paypalToken(mode);
    const r = await send(`${base}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(b),
    }, "PayPal");
    if (r.verification_status === "SUCCESS") return { ok: true, reason: mode };
  }
  return { ok: false, reason: "PayPal did not confirm the signature" };
}

// ── Either ───────────────────────────────────────────────────────────────────

export function createProviderCheckout(c: CheckoutInfo, returnUrl: string, cancelUrl: string): Promise<ProviderCheckout> {
  return c.processor === "stripe" ? stripeCheckout(c, returnUrl, cancelUrl) : paypalCheckout(c, returnUrl, cancelUrl);
}

/** This request's own origin (behind Caddy: x-forwarded-proto / host). */
export function originOf(h: Headers, fallback: string): string {
  const configured = val("PORTAL_PUBLIC_URL");
  if (configured) return configured.replace(/\/+$/, "");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return fallback;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Stores a verified provider event (app.ingest_webhook, 0210) and queues its job.
 * The webhook routes have no signed-in user, so they reach the database as the
 * connect_worker role (like the messaging hooks, src/lib/messaging/server-db.ts);
 * the portal never holds a service-role key. Returns null when the database
 * connection is not configured.
 */
export async function ingestWebhook(provider: string, eventId: string, type: string, payload: Record<string, unknown>): Promise<{ id: string } | null> {
  const rows = await workerQuery<{ id: string }>("select app.ingest_webhook($1, $2, $3, null, $4::jsonb) as id", [provider, eventId, type, JSON.stringify(payload)]);
  if (!rows) return null;
  return { id: rows[0]?.id };
}
