// payments.test_charge: the $1 test was paid (webhook) — refund it through the
// provider and record the result in app.payment_processor_tests. It is never a
// gift. A refusal from the provider is recorded as a failed test with its reason.

import { PermanentError, messageOf } from "../errors";
import { dbValue, loadCheckout, paypalRefund, stripeRefund } from "../payments/core";
import type { Job, JobContext } from "../types";

export const kind = "payments.test_charge";

export async function run(job: Job, ctx: JobContext) {
  const p = job.payload ?? {};
  if (typeof p.checkout_id !== "string") throw new PermanentError("payments.test_charge: checkout_id is required.");
  const checkout = await loadCheckout(ctx, p.checkout_id);
  if (!checkout || checkout.context !== "processor_test") throw new PermanentError("That $1 test was not found.");
  const charge = String(p.provider_payment_ref ?? checkout.provider_payment_ref ?? "");
  if (!charge) throw new PermanentError("The $1 test has no provider payment to refund.");
  let refund: string;
  try {
    refund =
      checkout.processor === "stripe"
        ? await stripeRefund(ctx, checkout.mode, checkout.account_id, charge, checkout.amount_cents, `test-refund-${checkout.id}`)
        : await paypalRefund(ctx, checkout.mode, checkout.connect_method, checkout.account_id, charge, checkout.amount_cents, `test-refund-${checkout.id}`, checkout.currency);
  } catch (err) {
    if (!(err instanceof PermanentError)) throw err;
    const id = await dbValue<string>(ctx, "select app.worker_record_processor_test($1, false, $2, null, $3) as v", [
      checkout.id, charge, `Charged $1.00 but the refund was refused: ${messageOf(err)}`,
    ]);
    return { ok: false, test_id: id, charge_ref: charge };
  }
  const id = await dbValue<string>(ctx, "select app.worker_record_processor_test($1, true, $2, $3, $4) as v", [
    checkout.id, charge, refund, `Charged $1.00 (${checkout.mode} mode) and refunded it.`,
  ]);
  return { ok: true, test_id: id, charge_ref: charge, refund_ref: refund };
}
