// Webhook signature checks for the public routes (no server-only imports, so
// they are unit-tested directly). Stripe signs "<t>.<raw body>" with HMAC-SHA256
// and the endpoint secret; several secrets may be configured (the platform
// endpoint and the Connect endpoint), comma-separated. PayPal is verified by
// PayPal itself (see paypalVerifyBody), with the webhook id.

import { createHmac, timingSafeEqual } from "node:crypto";

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/** Parse "t=…,v1=…,v1=…" into its timestamp and v1 signatures. */
export function parseStripeSignature(header: string | null | undefined): { t: number | null; v1: string[] } {
  const out = { t: null as number | null, v1: [] as string[] };
  for (const part of (header ?? "").split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "t" && v && /^\d+$/.test(v)) out.t = Number(v);
    if (k === "v1" && v && /^[0-9a-f]{64}$/i.test(v)) out.v1.push(v.toLowerCase());
  }
  return out;
}

export function stripeSignatureFor(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/** Checks a Stripe-Signature header against every configured secret, within the tolerance (default 5 minutes). */
export function verifyStripeSignature(rawBody: string, header: string | null | undefined, secrets: string[], nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): SignatureCheck {
  const { t, v1 } = parseStripeSignature(header);
  if (t === null || v1.length === 0) return { ok: false, reason: "the Stripe-Signature header is missing or malformed" };
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return { ok: false, reason: "the signature timestamp is too old or in the future" };
  for (const secret of secrets) {
    const want = Buffer.from(stripeSignatureFor(secret, t, rawBody), "hex");
    if (v1.some((s) => { const got = Buffer.from(s, "hex"); return got.length === want.length && timingSafeEqual(got, want); })) return { ok: true };
  }
  return { ok: false, reason: "the signature does not match" };
}

export function secretsFrom(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** The body PayPal's verify-webhook-signature API expects, from the request headers and the parsed event. */
export function paypalVerifyBody(headers: Headers, webhookId: string, event: unknown): Record<string, unknown> | null {
  const h = (n: string) => headers.get(n);
  const need = ["paypal-transmission-id", "paypal-transmission-time", "paypal-transmission-sig", "paypal-cert-url", "paypal-auth-algo"];
  if (need.some((n) => !h(n))) return null;
  return {
    transmission_id: h("paypal-transmission-id"),
    transmission_time: h("paypal-transmission-time"),
    transmission_sig: h("paypal-transmission-sig"),
    cert_url: h("paypal-cert-url"),
    auth_algo: h("paypal-auth-algo"),
    webhook_id: webhookId,
    webhook_event: event,
  };
}
