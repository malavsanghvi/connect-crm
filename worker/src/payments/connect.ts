// The two payment entries of oauth.exchange's EXCHANGERS.
//   Stripe  Connect (Standard) OAuth: the code → tokens and the connected
//           account id (stripe_user_id), then the account's verification state.
//   PayPal  partner sign-up ("Connect with PayPal"): the "code" is the merchant
//           id PayPal handed back on the return page; the platform asks PayPal
//           whether that merchant granted it permission and can take payments.

import { NotConfiguredError, PermanentError } from "../errors";
import type { ExchangeInput, TokenSet } from "../handlers/oauth.exchange";
import { paypalRequest, stripeConnectBase, stripeKey, stripeRequest, parseProvider } from "./providers";

export async function stripeExchange({ code, env, http, mode }: ExchangeInput): Promise<TokenSet> {
  if (!(env.STRIPE_CLIENT_ID ?? "").trim()) throw new NotConfiguredError("Stripe Connect isn't configured on the Community Connect server yet (STRIPE_CLIENT_ID not set)");
  const res = await http.request(`${stripeConnectBase(env)}/oauth/token`, {
    method: "POST",
    headers: { authorization: `Bearer ${stripeKey(env, mode)}`, "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=authorization_code&code=${encodeURIComponent(code)}`,
  });
  const t = parseProvider<Record<string, unknown>>("Stripe", res);
  const account = typeof t.stripe_user_id === "string" ? t.stripe_user_id : "";
  if (!account) throw new PermanentError("Stripe did not say which account was connected. Start connecting again.");
  const acct = await stripeRequest<Record<string, unknown>>(http, env, mode, `/v1/accounts/${encodeURIComponent(account)}`);
  const profile = (acct.business_profile ?? {}) as Record<string, unknown>;
  const secrets: Record<string, string> = {};
  if (typeof t.access_token === "string" && t.access_token.length >= 8) secrets.access_token = t.access_token;
  if (typeof t.refresh_token === "string" && t.refresh_token.length >= 8) secrets.refresh_token = t.refresh_token;
  return {
    secrets,
    externalAccountId: account,
    displayName: typeof profile.name === "string" && profile.name ? `Stripe · ${profile.name}` : "Stripe",
    settings: {
      charges_enabled: acct.charges_enabled === true,
      payouts_enabled: acct.payouts_enabled === true,
      details_submitted: acct.details_submitted === true,
      livemode: t.livemode === true,
    },
  };
}

export async function paypalExchange({ code, env, http, mode }: ExchangeInput): Promise<TokenSet> {
  const partner = (env.PAYPAL_PARTNER_ID ?? "").trim();
  if (!partner) throw new NotConfiguredError("Connect with PayPal isn't configured on the Community Connect server yet (PAYPAL_PARTNER_ID not set)");
  const merchant = code.trim();
  if (!/^[A-Z0-9]{8,20}$/.test(merchant)) throw new PermanentError("PayPal did not send back a merchant id. Start connecting again.");
  const m = await paypalRequest<Record<string, unknown>>(http, env, mode, `/v1/customer/partners/${encodeURIComponent(partner)}/merchant-integrations/${encodeURIComponent(merchant)}`);
  const receivable = m.payments_receivable === true;
  const confirmed = m.primary_email_confirmed === true;
  return {
    secrets: {},
    externalAccountId: String(m.merchant_id ?? merchant),
    displayName: typeof m.primary_email === "string" ? `PayPal · ${m.primary_email}` : "PayPal",
    settings: {
      charges_enabled: receivable && confirmed,
      payments_receivable: receivable,
      primary_email_confirmed: confirmed,
      paypal_email: typeof m.primary_email === "string" ? m.primary_email : null,
      provider_env: mode === "live" ? "live" : "sandbox",
    },
  };
}
