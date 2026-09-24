// oauth.exchange: swap an authorization code for tokens and keep them in the
// vault. The skeleton the payments (Stripe, PayPal) and QuickBooks streams
// fill in: each adds its provider to EXCHANGERS.
//
// Payload:
//   provider       "stripe" | "paypal" | "intuit"
//   connection_id  app.integration_connections.id
//   code_secret    name of the vault secret on that connection holding the
//                  authorization code (default "oauth.code"). The code itself
//                  NEVER goes in the payload: payloads are audited and shown
//                  to administrators.
//   redirect_uri   the redirect URI used in the authorization request
//
// Community Connect's own client id / secret come from the worker's env
// (STRIPE_*, PAYPAL_*, INTUIT_*). Missing ones fail the job at once with
// "not configured", naming the variables, never retried.

import { providerStatus, type Env, type Provider } from "../config";
import { NotConfiguredError, PermanentError } from "../errors";
import type { Http } from "../http";
import type { Job, JobContext } from "../types";

export const kind = "oauth.exchange";

export type TokenSet = {
  /** Secrets to store on the connection, by name (e.g. access_token, refresh_token). */
  secrets: Record<string, string>;
  expiresAt?: string;
  externalAccountId?: string;
};

export type ExchangeInput = { code: string; redirectUri: string | null; connectionId: string; env: Env; http: Http };
export type Exchanger = (input: ExchangeInput) => Promise<TokenSet>;

const OAUTH_PROVIDERS = ["stripe", "paypal", "intuit"] as const satisfies readonly Provider[];
type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Filled in by the o-payments and o-quickbooks streams. */
export const EXCHANGERS: Partial<Record<OAuthProvider, Exchanger>> = {};

export async function run(job: Job, ctx: JobContext, exchangers: Partial<Record<OAuthProvider, Exchanger>> = EXCHANGERS) {
  const p = job.payload ?? {};
  if ("code" in p) {
    throw new PermanentError("The authorization code must not be put in the job payload; store it in the vault and pass code_secret.");
  }
  const provider = p.provider;
  if (typeof provider !== "string" || !(OAUTH_PROVIDERS as readonly string[]).includes(provider)) {
    throw new PermanentError(`oauth.exchange: provider must be one of ${OAUTH_PROVIDERS.join(", ")}.`);
  }
  if (typeof p.connection_id !== "string") throw new PermanentError("oauth.exchange: connection_id is required.");
  const status = providerStatus(ctx.env, provider as OAuthProvider);
  if (!status.configured) throw new NotConfiguredError(status.reason);
  const exchange = exchangers[provider as OAuthProvider];
  if (!exchange) throw new PermanentError(`Connecting ${provider} is not built yet, so the authorization code was not used.`);

  const codeName = typeof p.code_secret === "string" ? p.code_secret : "oauth.code";
  const code = await ctx.secret(p.connection_id, codeName);
  if (!code) throw new PermanentError(`No authorization code is stored on the connection (secret "${codeName}"). Start the connection again.`);

  const tokens = await exchange({
    code,
    redirectUri: typeof p.redirect_uri === "string" ? p.redirect_uri : null,
    connectionId: p.connection_id,
    env: ctx.env,
    http: ctx.http,
  });
  const stored: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens.secrets)) {
    stored[name] = (await ctx.storeSecret(p.connection_id, name, value)).fingerprint;
  }
  return { provider, stored, expires_at: tokens.expiresAt ?? null, external_account_id: tokens.externalAccountId ?? null };
}
