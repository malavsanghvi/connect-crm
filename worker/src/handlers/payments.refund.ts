// payments.refund: a refund two people approved (app.request_provider_refund)
// goes to the provider; once the provider accepts it, it is recorded exactly
// as a hand-recorded refund is (app.worker_record_provider_refund). The
// idempotency key is the payment and what was refunded before, so a retried
// job never refunds twice.

import { PermanentError } from "../errors";
import { dbValue, paypalRefund, stripeRefund } from "../payments/core";
import { asMode } from "../payments/providers";
import type { Job, JobContext } from "../types";

export const kind = "payments.refund";

type Payment = {
  id: string;
  provider: string;
  provider_ref: string;
  amount_cents: number;
  refunded_cents: number;
  approved: boolean;
  mode: string;
  connection: { account_id: string | null; connect_method: string | null } | null;
};

export async function run(job: Job, ctx: JobContext) {
  const p = job.payload ?? {};
  const amount = Number(p.amount_cents);
  const before = Number(p.refunded_before);
  if (typeof p.payment_id !== "string" || !Number.isInteger(amount) || amount <= 0 || !Number.isInteger(before)) {
    throw new PermanentError("payments.refund: payment_id, amount_cents and refunded_before are required.");
  }
  const pay = await dbValue<Payment>(ctx, "select app.worker_payment_json($1) as v", [p.payment_id]);
  if (!pay) throw new PermanentError("The payment to refund was not found.");
  if (!pay.approved) throw new PermanentError("This refund does not have two different approvers, so it was not sent.");
  if (pay.refunded_cents !== before) return { duplicate: true, refunded_cents: pay.refunded_cents };
  const mode = asMode(pay.mode);
  const key = `refund-${pay.id}-${before}`;
  let ref: string;
  if (pay.provider === "stripe") ref = await stripeRefund(ctx, mode, pay.connection?.account_id ?? null, pay.provider_ref, amount, key);
  else if (pay.provider === "paypal") ref = await paypalRefund(ctx, mode, pay.connection?.connect_method ?? null, pay.connection?.account_id ?? null, pay.provider_ref, amount, key);
  else throw new PermanentError(`A ${pay.provider} payment is not refunded through a provider.`);
  const rec = await dbValue<{ duplicate: boolean; refunded_cents: number }>(ctx, "select app.worker_record_provider_refund($1, $2, $3, $4) as v", [pay.id, amount, before, ref]);
  return { provider: pay.provider, refund_ref: ref, ...rec };
}
