// payments.sync_payouts: bring each connected Stripe account's recent payouts
// into app.payouts (gross, fees, net, arrival date) and mark the payments in
// them, so bank reconciliation can match the deposit line for line. Runs daily
// for every account and on demand for one community. PayPal has no payout
// objects (the organization moves its balance itself), so it is reported, not faked.

import { syncStripePayout } from "../payments/core";
import { asMode, stripeRequest } from "../payments/providers";
import type { Job, JobContext } from "../types";

export const kind = "payments.sync_payouts";

type Account = { center_id: string; processor: string; account_id: string; mode: string };

export async function run(job: Job, ctx: JobContext) {
  const center = typeof job.payload?.center_id === "string" ? job.payload.center_id : job.center_id;
  const accounts = (await ctx.db.query<{ v: Account }>("select v from app.worker_payout_accounts($1) v", [center ?? null])).map((r) => r.v);
  const results: unknown[] = [];
  const errors: string[] = [];
  for (const a of accounts) {
    if (a.processor !== "stripe") {
      results.push({ center_id: a.center_id, processor: a.processor, note: "PayPal does not report payouts; record the bank transfer from the bank statement." });
      continue;
    }
    const mode = asMode(a.mode);
    try {
      const list = await stripeRequest<{ data?: Record<string, unknown>[] }>(ctx.http, ctx.env, mode, "/v1/payouts?limit=20", { account: a.account_id });
      for (const po of list.data ?? []) {
        if (po.status === "failed" || po.status === "canceled") continue;
        results.push({ center_id: a.center_id, ...(await syncStripePayout(ctx, a.center_id, mode, a.account_id, po)) });
      }
    } catch (err) {
      // One community's failure must not hide the others'; the job still fails at the end.
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log.error("payout sync failed for an account", { center: a.center_id, error: msg });
      errors.push(`${a.center_id}: ${msg}`);
    }
  }
  if (errors.length > 0 && (center || errors.length === accounts.length)) throw new Error(`Payout sync failed — ${errors.join("; ")}`);
  return { accounts: accounts.length, payouts: results, errors };
}

export function configured(env: Record<string, string | undefined>) {
  return (env.STRIPE_SECRET_KEY ?? "").trim() || (env.STRIPE_TEST_SECRET_KEY ?? "").trim()
    ? ({ configured: true } as const)
    : ({ configured: false, reason: "Stripe isn't configured on the Community Connect server yet (STRIPE_SECRET_KEY / STRIPE_TEST_SECRET_KEY not set)" } as const);
}
