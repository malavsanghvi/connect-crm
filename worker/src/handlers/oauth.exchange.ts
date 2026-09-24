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

import { providerStatus, type Env, type Provider, type Readiness } from "../config";
import { NotConfiguredError, PermanentError } from "../errors";
import type { Http } from "../http";
import type { Job, JobContext } from "../types";
import { intuitAfterExchange, intuitExchanger } from "../qbo/connect";

export const kind = "oauth.exchange";

export type TokenSet = {
  /** Secrets to store on the connection, by name (e.g. access_token, refresh_token). */
  secrets: Record<string, string>;
  expiresAt?: string;
  externalAccountId?: string;
  /** Anything else the provider's AFTER_EXCHANGE step needs (never a secret). */
  meta?: Record<string, unknown>;
};

/** After the tokens are stored: a provider's own bookkeeping (mark connected, first sync). Its result joins the job's. */
export type AfterExchange = (tokens: TokenSet, ctx: JobContext, connectionId: string) => Promise<Record<string, unknown>>;

export type ExchangeInput = {
  code: string;
  redirectUri: string | null;
  connectionId: string;
  env: Env;
  http: Http;
  /** The job's payload (never holds a secret), for provider-specific choices. */
  payload?: Record<string, unknown>;
};
export type Exchanger = (input: ExchangeInput) => Promise<TokenSet>;

const OAUTH_PROVIDERS = ["stripe", "paypal", "intuit"] as const satisfies readonly Provider[];
type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Ready when at least one provider's platform keys are set; each job still checks its own provider. */
export function configured(env: Env): Readiness {
  const missing = OAUTH_PROVIDERS.map((p) => providerStatus(env, p));
  if (missing.some((r) => r.configured)) return { configured: true };
  return { configured: false, reason: "No payment or QuickBooks platform keys are set on the background service (STRIPE_*, PAYPAL_*, INTUIT_*)" };
}

/** Filled in by the o-payments and o-quickbooks streams. */
export const EXCHANGERS: Partial<Record<OAuthProvider, Exchanger>> = { intuit: intuitExchanger };

/** Optional per provider: what happens once the tokens are in the vault. */
export const AFTER_EXCHANGE: Partial<Record<OAuthProvider, AfterExchange>> = { intuit: intuitAfterExchange };

export async function run(
  job: Job,
  ctx: JobContext,
  exchangers: Partial<Record<OAuthProvider, Exchanger>> = EXCHANGERS,
  after: Partial<Record<OAuthProvider, AfterExchange>> = AFTER_EXCHANGE,
) {
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
    payload: p,
  });
  const stored: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens.secrets)) {
    stored[name] = (await ctx.storeSecret(p.connection_id, name, value)).fingerprint;
  }
  const afterStep = after[provider as OAuthProvider];
  const extra = afterStep ? await afterStep(tokens, ctx, p.connection_id) : {};
  return { provider, stored, expires_at: tokens.expiresAt ?? null, external_account_id: tokens.externalAccountId ?? null, ...extra };
}
