// Connecting QuickBooks: the signed, single-use OAuth state and Intuit's
// authorization address (ONBOARDING_WAVE_B "OAuth").
//
// state = <center id>.<nonce>.<signature>
//   nonce      32 random bytes (hex) from app.start_qbo_connect; the database keeps
//              only its sha-256 and accepts it once, from the same person, within
//              15 minutes (app.complete_qbo_connect)
//   signature  HMAC-SHA256(OAUTH_STATE_SECRET, "intuit|<center>|<nonce>|<user>"), base64url
//
// Portal server env (never sent to a browser):
//   INTUIT_CLIENT_ID            Community Connect's Intuit app (production keys)
//   INTUIT_SANDBOX_CLIENT_ID    optional: Intuit's development keys, for sandbox companies
//   INTUIT_REDIRECT_URI         optional: https://<portal>/api/oauth/intuit/callback
//                               (else derived from the request's host)
//   INTUIT_OAUTH_BASE           optional: overrides https://appcenter.intuit.com (tests)
//   OAUTH_STATE_SECRET          at least 32 characters; signs the state

import { createHmac, timingSafeEqual } from "node:crypto";

export const INTUIT_SCOPE = "com.intuit.quickbooks.accounting";
export const CALLBACK_PATH = "/api/oauth/intuit/callback";

type Env = Readonly<Record<string, string | undefined>>;
const val = (env: Env, k: string) => (typeof env[k] === "string" && env[k]!.trim() !== "" ? env[k]!.trim() : null);

export type IntuitPortalConfig =
  | { ok: true; clientId: string; stateSecret: string; authorizeBase: string }
  | { ok: false; missing: string[]; message: string };

/** What the portal needs to send someone to Intuit; missing names only, never values. */
export function intuitPortalConfig(env: Env, company: "real" | "sandbox"): IntuitPortalConfig {
  const clientId = (company === "sandbox" ? val(env, "INTUIT_SANDBOX_CLIENT_ID") : null) ?? val(env, "INTUIT_CLIENT_ID");
  const secret = val(env, "OAUTH_STATE_SECRET");
  const missing = [...(clientId ? [] : ["INTUIT_CLIENT_ID"]), ...(secret && secret.length >= 32 ? [] : ["OAUTH_STATE_SECRET"])];
  if (missing.length > 0 || !clientId || !secret) {
    return {
      ok: false,
      missing,
      message: `QuickBooks isn't configured on the Community Connect server yet (${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set). Ask the Community Connect team.`,
    };
  }
  return { ok: true, clientId, stateSecret: secret, authorizeBase: (val(env, "INTUIT_OAUTH_BASE") ?? "https://appcenter.intuit.com").replace(/\/+$/, "") };
}

/** The callback address: INTUIT_REDIRECT_URI, else this portal's own origin. */
export function redirectUri(env: Env, origin: string): string {
  const fixed = val(env, "INTUIT_REDIRECT_URI");
  if (fixed) return fixed;
  return `${origin.replace(/\/+$/, "")}${CALLBACK_PATH}`;
}

function sig(secret: string, center: string, nonce: string, user: string): string {
  return createHmac("sha256", secret).update(`intuit|${center}|${nonce}|${user}`).digest("base64url");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function signState(secret: string, center: string, nonce: string, user: string): string {
  if (!UUID.test(center) || !/^[0-9a-f]{64}$/.test(nonce)) throw new Error("bad state input");
  return `${center}.${nonce}.${sig(secret, center, nonce, user)}`;
}

/** The nonce, when the state was signed by this server for this person; null otherwise. */
export function verifyState(secret: string, state: string | null | undefined, user: string): { center: string; nonce: string } | null {
  const parts = String(state ?? "").split(".");
  if (parts.length !== 3) return null;
  const [center, nonce, given] = parts as [string, string, string];
  if (!UUID.test(center) || !/^[0-9a-f]{64}$/.test(nonce)) return null;
  const want = Buffer.from(sig(secret, center, nonce, user));
  const got = Buffer.from(given);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { center, nonce };
}

export function authorizeUrl(cfg: { clientId: string; authorizeBase: string }, redirect: string, state: string): string {
  const u = new URL(`${cfg.authorizeBase}/connect/oauth2`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", INTUIT_SCOPE);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("state", state);
  return u.toString();
}
