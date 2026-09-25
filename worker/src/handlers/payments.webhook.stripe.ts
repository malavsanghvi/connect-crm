// payments.webhook.stripe: one verified Stripe event (the portal route checked
// its signature and stored it through app.ingest_webhook). Payments are
// recorded through app.worker_record_online_payment (existing allocation and
// posting rules); refunds made outside Community Connect (the Stripe dashboard)
// are recorded as FLAGGED refunds that change nothing until two people approve
// them (app.worker_flag_provider_refund, owner decision 2026-09-25 #6).

import { providerStatus, type Env, type Readiness } from "../config";
import { closeCheckout, dbValue, flagProviderRefund, loadCheckout, recordStripeSession, syncStripePayout } from "../payments/core";
import { asMode } from "../payments/providers";
import { runWebhook, type EventOutcome, type StoredEvent } from "../payments/webhook";
import type { Job, JobContext } from "../types";

export const kind = "payments.webhook.stripe";

export function configured(env: Env): Readiness {
  if ((env.STRIPE_SECRET_KEY ?? "").trim() || (env.STRIPE_TEST_SECRET_KEY ?? "").trim()) return { configured: true };
  const s = providerStatus(env, "stripe");
  return s.configured ? s : { configured: false, reason: "Stripe isn't configured on the Community Connect server yet (STRIPE_SECRET_KEY / STRIPE_TEST_SECRET_KEY not set)" };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

export async function handle(ev: StoredEvent, ctx: JobContext): Promise<EventOutcome> {
  const event = ev.payload;
  const o = obj(obj(event.data).object);
  const account = typeof event.account === "string" ? event.account : null;
  switch (ev.event_type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const checkout = await loadCheckout(ctx, String(obj(o.metadata).checkout_id ?? o.client_reference_id ?? ""), "stripe", String(o.id ?? ""));
      if (!checkout) return { outcome: "ignored: not a Community Connect checkout", session: o.id };
      if (o.payment_status !== "paid") return { outcome: "waiting: the bank payment has not cleared yet", center: checkout.center_id };
      const rec = await recordStripeSession(ctx, checkout, o, account);
      return { outcome: rec.test ? "test charge paid; refund queued" : rec.duplicate ? "already recorded" : "payment recorded", center: checkout.center_id, ...rec };
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const checkout = await loadCheckout(ctx, String(obj(o.metadata).checkout_id ?? ""), "stripe", String(o.id ?? ""));
      if (!checkout) return { outcome: "ignored: not a Community Connect checkout" };
      const expired = ev.event_type === "checkout.session.expired";
      await closeCheckout(ctx, checkout.id, expired ? "expired" : "failed", expired ? "The checkout expired before it was paid." : "The bank payment failed.");
      return { outcome: expired ? "checkout expired" : "checkout failed", center: checkout.center_id };
    }
    case "payment_intent.payment_failed": {
      const checkout = await loadCheckout(ctx, String(obj(o.metadata).checkout_id ?? ""), "stripe", null);
      if (!checkout) return { outcome: "ignored: not a Community Connect checkout" };
      const why = String(obj(o.last_payment_error).message ?? "The payment was declined.");
      await closeCheckout(ctx, checkout.id, "failed", why);
      return { outcome: "checkout failed", center: checkout.center_id };
    }
    case "charge.refunded": {
      // A refund made in the Stripe dashboard (owner decision 2026-09-25 #6): recorded as a FLAGGED
      // refund that changes nothing until two people approve it; ours are already recorded.
      const pi = typeof o.payment_intent === "string" ? o.payment_intent : null;
      if (!pi) return { outcome: "ignored: the charge names no payment" };
      const refunds = (obj(o.refunds).data as Obj[] | undefined) ?? [];
      const latest = refunds.reduce<Obj | null>((a, r) => (!a || Number(r.created ?? 0) > Number(a.created ?? 0) ? r : a), null);
      const created = Number(latest?.created ?? event.created ?? 0);
      const on = created > 0 ? new Date(created * 1000).toISOString().slice(0, 10) : null;
      const res = await flagProviderRefund(ctx, "stripe", pi, Number(o.amount_refunded ?? 0), latest ? String(latest.id ?? "") : null, on, ev.event_type);
      if (!res) return { outcome: "ignored: not a Community Connect payment" };
      if (res.outcome === "flagged") {
        ctx.log.warn("a refund made in the Stripe dashboard was flagged for two approvals", { payment: res.payment_id, amount_cents: res.amount_cents });
        return { outcome: `refund made in Stripe flagged for approval (${dollars(Number(res.amount_cents))})`, center: res.center_id, refund_id: res.refund_id, payment_id: res.payment_id, amount_cents: res.amount_cents };
      }
      return { outcome: res.outcome === "already_flagged" ? "refund already flagged" : "refund already recorded", payment_id: res.payment_id };
    }
    case "payout.paid":
    case "payout.updated":
    case "payout.created": {
      const center = ev.center_id;
      if (!center) return { outcome: "ignored: payout for an account no community has connected" };
      const conn = await dbValue<{ mode: string; account_id: string | null }>(ctx, "select app.worker_payment_connection($1, 'stripe') as v", [center]);
      const out = await syncStripePayout(ctx, center, asMode(event.livemode === true ? "live" : event.livemode === false ? "test" : conn?.mode), account ?? conn?.account_id ?? null, o);
      return { outcome: "payout synced", center, ...out };
    }
    case "account.updated": {
      const n = await dbValue<number>(ctx, "select app.worker_connection_settings('stripe', $1, $2) as v", [
        String(o.id ?? account ?? ""),
        JSON.stringify({ charges_enabled: o.charges_enabled === true, payouts_enabled: o.payouts_enabled === true, details_submitted: o.details_submitted === true }),
      ]);
      return { outcome: `account updated on ${n ?? 0} connection(s)`, center: ev.center_id };
    }
    case "account.application.deauthorized": {
      await ctx.db.query("select app.worker_connection_settings('stripe', $1, $2)", [account ?? "", JSON.stringify({ charges_enabled: false, deauthorized_at: new Date().toISOString() })]);
      return { outcome: "the organization disconnected Community Connect in Stripe", center: ev.center_id };
    }
    default:
      return { outcome: `ignored: ${ev.event_type} is not used`, center: ev.center_id };
  }
}

export function run(job: Job, ctx: JobContext) {
  return runWebhook(job, ctx, (ev) => handle(ev, ctx));
}
