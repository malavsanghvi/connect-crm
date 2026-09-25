// payments.webhook.paypal: one verified PayPal event (the portal route had
// PayPal verify its signature). An approved order is captured here and the
// capture recorded; PAYMENT.CAPTURE.COMPLETED records it too (idempotently),
// so whichever arrives first wins and the other is a duplicate.

import { providerStatus, type Env, type Readiness } from "../config";
import { capturePaypalOrder, closeCheckout, flagProviderRefund, loadCheckout, recordPaypalCapture } from "../payments/core";
import { decimalToCents } from "../payments/providers";
import { runWebhook, type EventOutcome, type StoredEvent } from "../payments/webhook";
import type { Job, JobContext } from "../types";

export const kind = "payments.webhook.paypal";

export function configured(env: Env): Readiness {
  if ((env.PAYPAL_SANDBOX_CLIENT_ID ?? "").trim() && (env.PAYPAL_SANDBOX_CLIENT_SECRET ?? "").trim()) return { configured: true };
  const s = providerStatus(env, "paypal");
  return s.configured ? s : { configured: false, reason: "PayPal isn't configured on the Community Connect server yet (PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET, or the PAYPAL_SANDBOX_* pair, not set)" };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

export async function handle(ev: StoredEvent, ctx: JobContext): Promise<EventOutcome> {
  const r = obj(ev.payload.resource);
  switch (ev.event_type) {
    case "CHECKOUT.ORDER.APPROVED":
    case "CHECKOUT.ORDER.COMPLETED": {
      const unit = obj((r.purchase_units as Obj[] | undefined)?.[0]);
      const checkout = await loadCheckout(ctx, String(unit.custom_id ?? unit.reference_id ?? ""), "paypal", String(r.id ?? ""));
      if (!checkout) return { outcome: "ignored: not a Community Connect checkout" };
      const rec = await capturePaypalOrder(ctx, checkout, String(r.id));
      return { outcome: rec.test ? "test charge paid; refund queued" : rec.duplicate ? "already recorded" : "payment recorded", center: checkout.center_id, ...rec };
    }
    case "PAYMENT.CAPTURE.COMPLETED": {
      const orderId = String(obj(obj(r.supplementary_data).related_ids).order_id ?? "");
      const checkout = await loadCheckout(ctx, String(r.custom_id ?? ""), "paypal", orderId || null);
      if (!checkout) return { outcome: "ignored: not a Community Connect checkout" };
      const rec = await recordPaypalCapture(ctx, checkout, r, null);
      return { outcome: rec.test ? "test charge paid; refund queued" : rec.duplicate ? "already recorded" : "payment recorded", center: checkout.center_id, ...rec };
    }
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED":
    case "CHECKOUT.PAYMENT-APPROVAL.REVERSED": {
      const checkout = await loadCheckout(ctx, String(r.custom_id ?? ""), "paypal", null);
      if (!checkout) return { outcome: "ignored: not a Community Connect checkout" };
      await closeCheckout(ctx, checkout.id, "failed", "PayPal declined the payment.");
      return { outcome: "checkout failed", center: checkout.center_id };
    }
    case "PAYMENT.CAPTURE.REFUNDED": {
      // A refund made in PayPal (owner decision 2026-09-25 #6): flagged until two people approve it.
      const up = ((r.links as Obj[] | undefined) ?? []).find((l) => l.rel === "up");
      const captureId = typeof up?.href === "string" ? up.href.split("/").pop() ?? "" : "";
      if (!captureId) return { outcome: "ignored: the refund names no capture" };
      const total = decimalToCents(obj(obj(r.seller_payable_breakdown).total_refunded_amount).value) ?? decimalToCents(obj(r.amount).value) ?? 0;
      const on = typeof r.create_time === "string" ? r.create_time.slice(0, 10) : null;
      const res = await flagProviderRefund(ctx, "paypal", captureId, total, typeof r.id === "string" ? r.id : null, on, ev.event_type);
      if (!res) return { outcome: "ignored: not a Community Connect payment" };
      if (res.outcome === "flagged") {
        ctx.log.warn("a refund made in PayPal was flagged for two approvals", { payment: res.payment_id, amount_cents: res.amount_cents });
        return { outcome: "refund made in PayPal flagged for approval", center: res.center_id, refund_id: res.refund_id, payment_id: res.payment_id, amount_cents: res.amount_cents };
      }
      return { outcome: res.outcome === "already_flagged" ? "refund already flagged" : "refund already recorded", payment_id: res.payment_id };
    }
    case "MERCHANT.ONBOARDING.COMPLETED":
    case "MERCHANT.PARTNER-CONSENT.REVOKED": {
      const revoked = ev.event_type === "MERCHANT.PARTNER-CONSENT.REVOKED";
      await ctx.db.query("select app.worker_connection_settings('paypal', $1, $2)", [
        String(r.merchant_id ?? ""),
        JSON.stringify(revoked ? { charges_enabled: false, consent_revoked_at: new Date().toISOString() } : { charges_enabled: true }),
      ]);
      return { outcome: revoked ? "the organization revoked Community Connect's permission" : "onboarding completed", center: ev.center_id };
    }
    default:
      return { outcome: `ignored: ${ev.event_type} is not used`, center: ev.center_id };
  }
}

export function run(job: Job, ctx: JobContext) {
  return runWebhook(job, ctx, (ev) => handle(ev, ctx));
}
