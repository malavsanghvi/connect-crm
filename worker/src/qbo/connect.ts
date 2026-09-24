// The Intuit part of oauth.exchange: swap the authorization code for tokens,
// then (after they are in the vault) read the company's name, mark the
// connection connected and queue the first pull (app.qbo_worker_connected).

import type { AfterExchange, Exchanger } from "../handlers/oauth.exchange";
import { messageOf } from "../errors";
import { loadConnection, QboClient } from "./client";
import { tokenRequest, type IntuitApp } from "./intuit";

export const intuitExchanger: Exchanger = async ({ code, redirectUri, env, http, payload }) => {
  const app: IntuitApp = payload?.intuit_app === "sandbox" ? "sandbox" : "production";
  const t = await tokenRequest(http, env, app, { grant_type: "authorization_code", code, redirect_uri: redirectUri ?? "" });
  return {
    secrets: { access_token: t.accessToken, refresh_token: t.refreshToken },
    expiresAt: t.accessExpiresAt,
    meta: { refreshExpiresAt: t.refreshExpiresAt },
  };
};

export const intuitAfterExchange: AfterExchange = async (tokens, ctx, connectionId) => {
  let company: string | null = null;
  try {
    // Still "disconnected" until app.qbo_worker_connected below; the fresh access token is in the vault.
    const conn = await loadConnection(ctx, connectionId);
    company = await new QboClient(ctx, { ...conn, settings: { ...conn.settings, access_expires_at: tokens.expiresAt } }).companyName();
  } catch (err) {
    // Connected all the same; the name shows as the company id until the next pull.
    ctx.log.error("could not read the QuickBooks company name after connecting", { error: messageOf(err) });
  }
  const r = await ctx.db.query<{ r: { status: string; pull_job: string | null } }>("select app.qbo_worker_connected($1, $2, $3, $4) as r", [
    connectionId, tokens.expiresAt ?? null, (tokens.meta?.refreshExpiresAt as string | undefined) ?? null, company,
  ]);
  return { company, status: r[0]?.r?.status ?? null, pull_job: r[0]?.r?.pull_job ?? null };
};
