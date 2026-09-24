// payments.webhook.paypal: one verified PayPal event (the portal route had
// PayPal verify its signature). An approved order is captured here and the
// capture recorded; PAYMENT.CAPTURE.COMPLETED records it too (idempotently),
// so whichever arrives first wins and the other is a duplicate.

import { providerStatus, type Env, type Readiness } from "../config";
import { PermanentError } from "../errors";
import { capturePaypalOrder, closeCheckout, dbValue, loadCheckout, recordPaypalCapture } from "../payments/core";
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
      const up = ((r.links as Obj[] | undefined) ?? []).find((l) => l.rel === "up");
      const captureId = typeof up?.href === "string" ? up.href.split("/").pop() ?? "" : "";
      const pay = captureId ? await dbValue<{ center_id: string; refunded_cents: number }>(ctx, "select app.worker_payment_by_ref('paypal', $1) as v", [captureId]) : null;
      if (!pay) return { outcome: "ignored: not a Community Connect payment" };
      const total = decimalToCents(obj(obj(r.seller_payable_breakdown).total_refunded_amount).value) ?? decimalToCents(obj(r.amount).value) ?? 0;
      if (total > pay.refunded_cents) {
        throw new PermanentError(
          `PayPal reports a refund on capture ${captureId} that Community Connect did not record. A refund made in PayPal is not recorded automatically (it skips the two-person approval); it needs an owner decision.`,
        );
      }
      return { outcome: "refund already recorded", center: pay.center_id };
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
