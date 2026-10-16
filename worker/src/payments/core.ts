// What the payment handlers share: the worker's database calls (connect_worker
// functions from 0210/0212 only) and the provider steps used by more than one
// handler (record a paid Stripe checkout, capture a PayPal order, refund, sync
// a payout). Money rules stay in the database: these steps only tell it what
// the provider reported.

import { PermanentError, messageOf } from "../errors";
import type { JobContext } from "../types";
import { asMode, decimalToCents, paypalMethod, paypalRequest, stripeMethod, stripeRequest, centsToDecimal, type Mode } from "./providers";

export type Checkout = {
  id: string;
  center_id: string;
  household_id: string | null;
  processor: "stripe" | "paypal";
  mode: Mode;
  context: string;
  /** The ORGANIZATION's charge: gift + the card fee the payer covered. The Chip In is not in it. */
  amount_cents: number;
  currency: string;
  status: string;
  provider_ref: string | null;
  provider_payment_ref: string | null;
  payment_id: string | null;
  account_id: string | null;
  connect_method: string | null;
  payee_email: string | null;
  // 0862: what the payer was asked to pay. Absent on an older database (a gift only).
  gift_cents?: number | null;
  covered_fee_cents?: number | null;
  chip_in_cents?: number | null;
  /** What Weaver takes of the charge as Stripe's application fee. */
  application_fee_cents?: number | null;
  /** What the card is charged: gift + covered fee + Chip In. */
  total_cents?: number | null;
  pay_method?: string | null;
};

export async function dbValue<T>(ctx: JobContext, sql: string, params: unknown[]): Promise<T | null> {
  const rows = await ctx.db.query<{ v: T }>(sql, params);
  return (rows[0]?.v ?? null) as T | null;
}

export async function loadCheckout(ctx: JobContext, id: string | null, processor?: string, providerRef?: string | null): Promise<Checkout | null> {
  if (!id && !providerRef) return null;
  const uuid = id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  const v = await dbValue<Checkout>(ctx, "select app.worker_checkout($1, $2, $3) as v", [uuid, processor ?? null, providerRef ?? null]);
  if (!v && uuid && providerRef) return dbValue<Checkout>(ctx, "select app.worker_checkout(null, $1, $2) as v", [processor ?? null, providerRef]);
  return v ? { ...v, mode: asMode(v.mode) } : null;
}

export type Recorded = {
  duplicate?: boolean;
  payment_id?: string | null;
  checkout_id?: string;
  test?: boolean;
  gift_cents?: number;
  covered_fee_cents?: number;
  chip_in_cents?: number;
  /** How Stripe's fees on the charge were told apart (a Stripe payment only): the job's result shows it. */
  fees?: { fee_cents: number; processing_fee_cents: number; application_fee_cents: number; itemised: boolean };
};

/**
 * Tell the database what the provider reported. `amountCents` is what was charged in TOTAL; `feeCents` is the provider's own
 * processing fee only (Stripe: never the application fee). `applicationFeeCents` is passed only when the payment has one (or
 * the checkout asked for one): a gift paid through PayPal or Stripe is recorded with exactly the call it always had.
 */
export function recordPayment(
  ctx: JobContext,
  checkout: Checkout,
  ref: string,
  amountCents: number,
  feeCents: number,
  method: string,
  detail: string | null,
  applicationFeeCents?: number,
) {
  const args: unknown[] = [checkout.id, ref, amountCents, feeCents, method, detail];
  if (applicationFeeCents !== undefined) args.push(applicationFeeCents);
  const slots = args.map((_, i) => `$${i + 1}`).join(", ");
  return dbValue<Recorded>(ctx, `select app.worker_record_online_payment(${slots}) as v`, args).then((v) => v ?? {});
}

export type FlaggedRefund = {
  outcome: "flagged" | "already_recorded" | "already_flagged" | "not_ours";
  refund_id?: string;
  payment_id?: string;
  amount_cents?: number;
  center_id?: string;
};

/**
 * The provider says a charge was refunded (running total). Anything Weaver did not record
 * becomes ONE flagged refund needing two approvals (app.worker_flag_provider_refund). Null when the
 * charge is not a Weaver payment. While a refund we sent is still being recorded the
 * database refuses, and the webhook job is retried.
 */
export async function flagProviderRefund(
  ctx: JobContext,
  provider: "stripe" | "paypal",
  paymentRef: string,
  totalRefundedCents: number,
  refundRef: string | null,
  refundedOn: string | null,
  eventType: string,
): Promise<FlaggedRefund | null> {
  const v = await dbValue<FlaggedRefund>(ctx, "select app.worker_flag_provider_refund($1, $2, $3, $4, $5::date, $6) as v", [
    provider,
    paymentRef,
    Math.max(0, Math.round(totalRefundedCents)),
    refundRef || null,
    refundedOn && /^\d{4}-\d{2}-\d{2}$/.test(refundedOn) ? refundedOn : null,
    eventType,
  ]);
  if (!v || v.outcome === "not_ours") return null;
  return v;
}

export function closeCheckout(ctx: JobContext, checkoutId: string, status: "failed" | "cancelled" | "expired", error: string) {
  return ctx.db.query("select app.worker_checkout_closed($1, $2, $3)", [checkoutId, status, error]);
}

// ── Stripe ──────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

export type StripeFees = {
  /** balance_transaction.fee, whatever it includes. */
  feeCents: number;
  /** What Stripe charges the organization for processing: every fee_details entry except the application fee. */
  processingCents: number;
  /** What Weaver takes: the fee_details entries of type application_fee. */
  applicationCents: number;
  /** False when Stripe sent no fee_details, so the two cannot be told apart. */
  itemised: boolean;
  /** Each fee_details type and its cents (for the log and the job result). */
  byType: Record<string, number>;
};

/**
 * Split a charge's balance transaction into Stripe's processing fee and Weaver's application fee (docs/PAYMENT_ADDONS.md §7.5).
 * A charge with an application fee has a fee breakdown of BOTH, and `fee` may total them; only the processing part is the
 * organization's card fee (payments.fee_cents, what posts to QuickBooks as merchant fees). The application fee is Weaver's and
 * is passed on separately. Entries of every other type (stripe_fee, tax on it, a payment-method pass-through fee) are costs
 * Stripe takes from the organization's balance, so they belong with the processing fee: leaving them out would leave the books
 * short of the deposit. A plain gift's balance transaction has no application fee entry and the result is `fee`, as before.
 */
export function splitStripeFees(bt: Obj): StripeFees {
  const feeCents = typeof bt.fee === "number" ? bt.fee : 0;
  if (!Array.isArray(bt.fee_details)) return { feeCents, processingCents: feeCents, applicationCents: 0, itemised: false, byType: {} };
  const byType: Record<string, number> = {};
  let processingCents = 0;
  let applicationCents = 0;
  for (const entry of bt.fee_details) {
    const d = obj(entry);
    const cents = typeof d.amount === "number" ? d.amount : 0;
    const type = typeof d.type === "string" && d.type ? d.type : "unknown";
    byType[type] = (byType[type] ?? 0) + cents;
    if (type === "application_fee") applicationCents += cents;
    else processingCents += cents;
  }
  return { feeCents, processingCents, applicationCents, itemised: true, byType };
}

const dollars = (c: number) => `$${centsToDecimal(c)}`;

/**
 * The database refused to record a payment because Stripe's numbers are not the checkout's (worker_record_online_payment, 0862:
 * "... Not recorded."). Retrying cannot change them, so it becomes a permanent failure whose message says in plain words what
 * differs and what to do. The job fails at once and the webhook event keeps the sentence: never a silent success.
 */
export function recordingProblem(err: unknown, checkout: Checkout, paymentRef: string, chargedCents: number, applicationFeeCents: number): unknown {
  if (!/Not recorded\.?\s*$/i.test(messageOf(err))) return err;
  const expected = checkout.total_cents ?? checkout.amount_cents;
  const expectedFee = checkout.application_fee_cents ?? 0;
  const what =
    chargedCents !== expected
      ? `Stripe charged ${dollars(chargedCents)} for payment ${paymentRef}, but Weaver's checkout asked for ${dollars(expected)}`
      : `Stripe took an application fee of ${dollars(applicationFeeCents)} on payment ${paymentRef}, but Weaver's checkout asked for ${dollars(expectedFee)}`;
  return new PermanentError(
    `${what}. The payment was NOT recorded in Weaver. Look at it in the Stripe dashboard and in Giving › Payments, then record or refund it by hand.`,
  );
}

/**
 * A paid Checkout Session: read its PaymentIntent (fees, method) on the connected account and record it.
 * The database checks the numbers (the charge must equal the checkout's total, and a Chip In's application fee must be the one
 * the checkout asked for); this step only reports what Stripe says, with the processing fee and the application fee kept apart.
 */
export async function recordStripeSession(ctx: JobContext, checkout: Checkout, session: Obj, account: string | null): Promise<Recorded> {
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : String(obj(session.payment_intent).id ?? "");
  if (!pi) throw new PermanentError(`Stripe session ${String(session.id)} has no payment to record.`);
  const intent = await stripeRequest<Obj>(ctx.http, ctx.env, checkout.mode, `/v1/payment_intents/${encodeURIComponent(pi)}?expand[]=latest_charge.balance_transaction`, {
    account: checkout.account_id ?? account,
  });
  if (intent.status !== "succeeded") {
    throw new Error(`Stripe payment ${pi} is ${String(intent.status)}, not succeeded yet; it will be checked again.`);
  }
  const charge = obj(intent.latest_charge);
  const bt = obj(charge.balance_transaction);
  const amount = Number(intent.amount_received ?? intent.amount ?? session.amount_total);
  const fees = splitStripeFees(bt);
  const { method, detail } = stripeMethod(charge);

  // The application fee as the PaymentIntent reports it (null: none). A checkout with a Chip In, or a charge that carries an
  // application fee the checkout never asked for, is reported to the database, which compares it with the checkout.
  const intentAppFee = typeof intent.application_fee_amount === "number" ? intent.application_fee_amount : 0;
  const hasAddOns = Number(checkout.chip_in_cents ?? 0) > 0 || Number(checkout.covered_fee_cents ?? 0) > 0;
  if (hasAddOns && !fees.itemised) {
    // Without Stripe's breakdown the card fee cannot be told apart from Weaver's application fee; guessing would book the Chip In as a fee.
    throw new Error(`Stripe returned no fee breakdown for payment ${pi}, so its card fee cannot be told apart from Weaver's application fee; it will be checked again.`);
  }
  if (fees.itemised && fees.applicationCents !== intentAppFee) {
    ctx.log.warn("stripe: the fee breakdown and the PaymentIntent disagree about the application fee", {
      payment_intent: pi, application_fee_in_breakdown_cents: fees.applicationCents, application_fee_on_intent_cents: intentAppFee,
    });
  }
  ctx.log.info("stripe: fees of a charge", {
    payment_intent: pi, charged_cents: amount, balance_transaction_fee_cents: fees.feeCents, fee_details_cents: fees.byType,
    processing_fee_cents: fees.processingCents, application_fee_cents: intentAppFee,
  });

  let recorded: Recorded;
  try {
    recorded = await recordPayment(
      ctx, checkout, pi, amount, fees.processingCents, method, detail,
      Number(checkout.chip_in_cents ?? 0) > 0 || intentAppFee > 0 ? intentAppFee : undefined,
    );
  } catch (err) {
    const problem = recordingProblem(err, checkout, pi, amount, intentAppFee);
    if (problem !== err) {
      ctx.log.error("stripe: a payment was NOT recorded because Stripe's numbers are not the checkout's", {
        payment_intent: pi, checkout: checkout.id, charged_cents: amount, application_fee_cents: intentAppFee, database: messageOf(err),
      });
    }
    throw problem;
  }
  return {
    ...recorded,
    fees: { fee_cents: fees.feeCents, processing_fee_cents: fees.processingCents, application_fee_cents: intentAppFee, itemised: fees.itemised },
  };
}

export async function stripeRefund(ctx: JobContext, mode: Mode, account: string | null, paymentIntent: string, amountCents: number, idempotencyKey: string) {
  const r = await stripeRequest<Obj>(ctx.http, ctx.env, mode, "/v1/refunds", {
    account,
    idempotencyKey,
    body: { payment_intent: paymentIntent, amount: amountCents },
  });
  if (r.status === "failed" || r.status === "canceled") {
    throw new PermanentError(`Stripe could not refund ${paymentIntent}: ${String(r.failure_reason ?? r.status)}.`);
  }
  return String(r.id);
}

/** One payout: its gross, fees and net from the balance transactions in it; the payments in it are marked. */
export async function syncStripePayout(ctx: JobContext, centerId: string, mode: Mode, account: string | null, payout: Obj) {
  const id = String(payout.id);
  let gross = 0;
  let fee = 0;
  const intents: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const q: string = `/v1/balance_transactions?payout=${encodeURIComponent(id)}&limit=100&expand[]=data.source${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`;
    const list: { data?: Obj[]; has_more?: boolean } = await stripeRequest<{ data?: Obj[]; has_more?: boolean }>(ctx.http, ctx.env, mode, q, { account });
    for (const t of list.data ?? []) {
      if (t.type === "payout") continue;
      gross += Number(t.amount ?? 0);
      fee += Number(t.fee ?? 0);
      const src = obj(t.source);
      if (typeof src.payment_intent === "string") intents.push(src.payment_intent);
    }
    const data: Obj[] = list.data ?? [];
    const last = data[data.length - 1];
    if (!list.has_more || !last) break;
    after = String(last.id);
  }
  const net = Number(payout.amount ?? gross - fee);
  const arrives = typeof payout.arrival_date === "number" ? new Date(payout.arrival_date * 1000).toISOString().slice(0, 10) : null;
  await ctx.db.query("select app.worker_upsert_payout($1, 'stripe', $2, $3, $4, $5, $6)", [centerId, id, gross, fee, net, arrives]);
  const marked = intents.length > 0 ? await dbValue<number>(ctx, "select app.worker_mark_payout_payments($1, 'stripe', $2, $3) as v", [centerId, id, intents]) : 0;
  return { payout: id, gross_cents: gross, fee_cents: fee, net_cents: net, payments_marked: marked ?? 0 };
}

// ── PayPal ──────────────────────────────────────────────────────────────────

const merchantOf = (c: Checkout) => (c.connect_method === "email" ? null : c.account_id);

/** Record a completed capture (from the capture call or the PAYMENT.CAPTURE.COMPLETED webhook). */
export async function recordPaypalCapture(ctx: JobContext, checkout: Checkout, capture: Obj, source: Obj | null): Promise<Recorded> {
  if (capture.status !== "COMPLETED") {
    throw new Error(`PayPal capture ${String(capture.id)} is ${String(capture.status)}, not completed yet; it will be checked again.`);
  }
  const amount = decimalToCents(obj(capture.amount).value);
  if (amount === null) throw new PermanentError(`PayPal capture ${String(capture.id)} has no readable amount.`);
  const fee = decimalToCents(obj(obj(capture.seller_receivable_breakdown).paypal_fee).value) ?? 0;
  return recordPayment(ctx, checkout, String(capture.id), amount, fee, paypalMethod(source), null);
}

/** Capture an approved order (idempotent at PayPal by PayPal-Request-Id) and record it. */
export async function capturePaypalOrder(ctx: JobContext, checkout: Checkout, orderId: string): Promise<Recorded> {
  let order: Obj;
  try {
    order = await paypalRequest<Obj>(ctx.http, ctx.env, checkout.mode, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      body: {},
      requestId: `capture-${checkout.id}`,
      merchantId: merchantOf(checkout),
    });
  } catch (err) {
    // Already captured (a retried job, or the webhook raced the return page): read the order instead.
    if (err instanceof PermanentError && /ORDER_ALREADY_CAPTURED|already captured/i.test(err.message + JSON.stringify((err as { body?: unknown }).body ?? ""))) {
      order = await paypalRequest<Obj>(ctx.http, ctx.env, checkout.mode, `/v2/checkout/orders/${encodeURIComponent(orderId)}`, { merchantId: merchantOf(checkout) });
    } else throw err;
  }
  const unit = obj((order.purchase_units as Obj[] | undefined)?.[0]);
  const capture = obj((obj(unit.payments).captures as Obj[] | undefined)?.[0]);
  if (!capture.id) throw new PermanentError(`PayPal order ${orderId} has no capture.`);
  return recordPaypalCapture(ctx, checkout, capture, obj(order.payment_source));
}

export async function paypalRefund(ctx: JobContext, mode: Mode, connectMethod: string | null, merchantId: string | null, captureId: string, amountCents: number, requestId: string, currency = "USD") {
  if (connectMethod === "email") {
    throw new PermanentError(
      "This PayPal account is connected by its Business email only, so Weaver has no permission to refund through it. Refund it in PayPal, then record it in Giving › Payments (Record the PayPal refund).",
    );
  }
  const r = await paypalRequest<Obj>(ctx.http, ctx.env, mode, `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    body: { amount: { value: centsToDecimal(amountCents), currency_code: currency.toUpperCase() } },
    requestId,
    merchantId,
  });
  if (r.status === "CANCELLED" || r.status === "FAILED") throw new PermanentError(`PayPal could not refund ${captureId}: ${String(r.status)}.`);
  return String(r.id);
}
