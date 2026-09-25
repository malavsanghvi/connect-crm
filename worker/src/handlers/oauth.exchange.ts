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
// Once exchanged, the code is removed from the vault (owner decision #12); a
// failed exchange removes it too unless a retry of this job could still use it
// (retryCouldUseCode). Audited as "used authorization code removed after
// exchange"; the value is never logged.
//
// Community Connect's own client id / secret come from the worker's env
// (STRIPE_*, PAYPAL_*, INTUIT_*). Missing ones fail the job at once with
// "not configured", naming the variables, never retried.

import { providerStatus, type Env, type Provider, type Readiness } from "../config";
import { isRetryable, messageOf, NotConfiguredError, PermanentError } from "../errors";
import type { Http } from "../http";
import { paypalExchange, stripeExchange } from "../payments/connect";
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
  /** Facts to merge into integration_connections.settings (never a secret). */
  settings?: Record<string, unknown>;
  displayName?: string;
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
  mode: "test" | "live";
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
export const EXCHANGERS: Partial<Record<OAuthProvider, Exchanger>> = { stripe: stripeExchange, paypal: paypalExchange, intuit: intuitExchanger };

/** Optional per provider: what happens once the tokens are in the vault. */
export const AFTER_EXCHANGE: Partial<Record<OAuthProvider, AfterExchange>> = { intuit: intuitAfterExchange };

/**
 * Whether the same job could still use the code after this failure: the
 * failure is temporary (a network blip, the provider's 5xx) and the job has
 * attempts left. Anything else (the provider refused the code, not
 * configured, a used or expired code, the last attempt) cannot.
 */
export function retryCouldUseCode(err: unknown, job: Pick<Job, "attempts" | "max_attempts">, exchanged: boolean): boolean {
  return !exchanged && isRetryable(err) && job.attempts < job.max_attempts;
}

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
  if (typeof p.connection_id !== "string") throw new PermanentError("oauth.exchange: connection_id is required.");
  const connectionId = p.connection_id;
  const codeName = typeof p.code_secret === "string" ? p.code_secret : "oauth.code";

  // Owner decision #12: a used code leaves the vault. Returns whether it did (never throws: the
  // exchange's own outcome is what the job reports; a removal that failed is logged and reported).
  const removeCode = async (outcome: "exchanged" | "unusable"): Promise<{ removed: boolean; error?: string }> => {
    try {
      return { removed: await ctx.removeOauthCode(connectionId, codeName, outcome) };
    } catch (err) {
      const error = messageOf(err);
      ctx.log.error("could not remove the authorization code from the vault", { connection: connectionId, secret: codeName, outcome, error });
      return { removed: false, error };
    }
  };

  let exchanged = false;
  let tokens: TokenSet;
  const stored: Record<string, string> = {};
  let provider: OAuthProvider;
  try {
    const raw = p.provider;
    if (typeof raw !== "string" || !(OAUTH_PROVIDERS as readonly string[]).includes(raw)) {
      throw new PermanentError(`oauth.exchange: provider must be one of ${OAUTH_PROVIDERS.join(", ")}.`);
    }
    provider = raw as OAuthProvider;
    const status = providerStatus(ctx.env, provider);
    if (!status.configured) throw new NotConfiguredError(status.reason);
    const exchange = exchangers[provider];
    if (!exchange) throw new PermanentError(`Connecting ${provider} is not built yet, so the authorization code was not used.`);

    const code = await ctx.secret(connectionId, codeName);
    if (!code) throw new PermanentError(`No authorization code is stored on the connection (secret "${codeName}"). Start the connection again.`);

    tokens = await exchange({
      code,
      redirectUri: typeof p.redirect_uri === "string" ? p.redirect_uri : null,
      connectionId,
      env: ctx.env,
      http: ctx.http,
      payload: p,
      mode: p.mode === "live" ? "live" : "test",
    });
    exchanged = true;
    for (const [name, value] of Object.entries(tokens.secrets)) {
      stored[name] = (await ctx.storeSecret(connectionId, name, value)).fingerprint;
    }
  } catch (err) {
    if (!retryCouldUseCode(err, job, exchanged)) {
      const r = await removeCode(exchanged ? "exchanged" : "unusable");
      if (r.removed) ctx.log.info("authorization code removed from the vault: a retry could not use it", { connection: connectionId, secret: codeName });
    }
    throw err;
  }

  const removal = await removeCode("exchanged");
  const codeResult = { code_removed: removal.removed, ...(removal.error ? { code_remove_error: removal.error } : {}) };
  const base = { provider, stored, expires_at: tokens.expiresAt ?? null, external_account_id: tokens.externalAccountId ?? null, ...codeResult };

  const afterStep = after[provider];
  if (afterStep) {
    // A provider with its own bookkeeping (QuickBooks marks the connection connected and queues the first pull).
    const extra = await afterStep(tokens, ctx, connectionId);
    return { ...base, ...extra };
  }
  // Otherwise the connection is connected (and a payment processor moves to test mode): app.worker_connection_connected (0212).
  await ctx.db.query("select app.worker_connection_connected($1, $2, $3, $4, $5)", [
    connectionId,
    tokens.externalAccountId ?? null,
    tokens.displayName ?? null,
    tokens.expiresAt ?? null,
    JSON.stringify(tokens.settings ?? {}),
  ]);
  return base;
}
