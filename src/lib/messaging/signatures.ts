// Signature checks for everything that calls in from outside:
//   • Standard Webhooks (Supabase Auth hooks, and Resend's webhooks through Svix):
//     HMAC-SHA256 over "<id>.<timestamp>.<body>" with the base64 key after "whsec_"
//     (Supabase writes the secret as "v1,whsec_…"), header "v1,<base64>" (several
//     may be listed), timestamp within 5 minutes.
//   • Twilio: HMAC-SHA1 over the full URL + the POST parameters sorted by name.
//   • Unsubscribe links: HMAC-SHA256 of the message id.
// Pure (node:crypto only); shared by the portal routes and the worker tests.

import { createHmac, timingSafeEqual } from "node:crypto";

export type Verdict = { ok: true } | { ok: false; reason: string };

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The raw key bytes of a standard-webhooks secret ("v1,whsec_<base64>" or "whsec_<base64>"). */
export function webhookKey(secret: string): Buffer {
  const s = secret.trim().replace(/^v1,/, "").replace(/^whsec_/, "");
  return Buffer.from(s, "base64");
}

export function signStandardWebhook(secret: string, id: string, timestamp: number | string, body: string): string {
  return "v1," + createHmac("sha256", webhookKey(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifyStandardWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Verdict {
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: "missing signature headers" };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSeconds - ts) > toleranceSeconds) return { ok: false, reason: "timestamp outside the 5-minute window" };
  const expected = signStandardWebhook(secret, headers.id, headers.timestamp, body).slice(3);
  const given = headers.signature
    .split(" ")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1,"))
    .map((s) => s.slice(3));
  return given.some((g) => safeEqual(g, expected)) ? { ok: true } : { ok: false, reason: "signature does not match" };
}

export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

export function verifyTwilio(authToken: string, url: string, params: Record<string, string>, signature: string | null): Verdict {
  if (!signature) return { ok: false, reason: "missing X-Twilio-Signature" };
  return safeEqual(twilioSignature(authToken, url, params), signature) ? { ok: true } : { ok: false, reason: "signature does not match" };
}

/** Postmark webhooks carry HTTP Basic credentials set in its dashboard; the password is the token. */
export function verifyBasicToken(expected: string, authorization: string | null): Verdict {
  if (!authorization?.startsWith("Basic ")) return { ok: false, reason: "missing credentials" };
  const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const password = decoded.slice(decoded.indexOf(":") + 1);
  return safeEqual(password, expected) ? { ok: true } : { ok: false, reason: "wrong credentials" };
}

export function linkSignature(secret: string, messageId: string): string {
  return createHmac("sha256", secret).update(`unsubscribe:${messageId}`).digest("base64url").slice(0, 32);
}

export function verifyLink(secret: string, messageId: string, sig: string | null): boolean {
  return !!sig && safeEqual(linkSignature(secret, messageId), sig);
}

export function unsubscribeUrl(base: string | null | undefined, secret: string | null | undefined, messageId: string): string | null {
  if (!base || !secret) return null;
  return `${base.replace(/\/+$/, "")}/api/messaging/unsubscribe?m=${encodeURIComponent(messageId)}&s=${linkSignature(secret, messageId)}`;
}
