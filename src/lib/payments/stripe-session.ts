// The Stripe Checkout Session's parameters, built from the numbers app.create_checkout returned and from nothing else
// (docs/PAYMENT_ADDONS.md §8). Pure, so it is tested without a network and without the server-only modules.
//
// Money rule: this file never works out a fee, a Chip In, a limit or a total. It lays the database's lines out for Stripe
// and refuses to send anything when they do not add up to what the database said was to be charged. Integer cents only.

import { stripePaymentMethodTypes, type Processor } from "./view";

export type CheckoutLine = { key?: string; label?: string; cents?: number };

/** What app.create_checkout (and app.create_processor_test_checkout) answered. The 0862 fields are absent on the $1 test: a gift only. */
export type CheckoutInfo = {
  checkout_id: string;
  processor: Processor;
  mode: "test" | "live";
  /** The ORGANIZATION's charge: gift + covered card fee (the Chip In is not in it). */
  amount_cents: number;
  currency: string;
  account_id: string | null;
  payee_email: string | null;
  statement_descriptor: string | null;
  methods: string[];
  center_name: string;
  for_label: string;
  gift_cents?: number | null;
  covered_fee_cents?: number | null;
  chip_in_cents?: number | null;
  /** What Weaver takes of the charge as Stripe's application fee (the Chip In less the extra card fee Weaver absorbs). */
  application_fee_cents?: number | null;
  /** What the payer's card is charged: gift + covered fee + Chip In. */
  total_cents?: number | null;
  pay_method?: "card" | "ach" | null;
  restrict_to_method?: boolean | null;
  fee_rate_id?: string | null;
  session_minutes?: number | null;
  lines?: CheckoutLine[] | null;
};

export type SessionPlan = { ok: true; params: Record<string, unknown> } | { ok: false; error: string };

/** Stripe allows a Checkout Session to live from 30 minutes to 24 hours. */
const MIN_SESSION_MINUTES = 30;
const MAX_SESSION_MINUTES = 24 * 60;
/** A checkout with a Chip In expires after an hour (spec §6.4), so an abandoned one does not block a member near the limit. */
const CHIP_IN_SESSION_MINUTES = 60;

const isCents = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim() ? v.trim().slice(0, 250) : fallback);

/**
 * The form fields of POST /v1/checkout/sessions: one line item per part of the total, in this order: the gift, the card fee the
 * payer chose to cover (only when above zero), the Chip In (only when above zero). With a Chip In the application fee rides on
 * the PaymentIntent (a DIRECT charge on the organization's connected account, exactly as before) and the session expires.
 * With nothing but a gift the result is byte for byte what it was before the add-ons (tests/payments/stripe-session.test.ts).
 */
export function planStripeSession(c: CheckoutInfo, successUrl: string, cancelUrl: string, nowSeconds: number): SessionPlan {
  const gift = c.gift_cents ?? c.amount_cents;
  const fee = c.covered_fee_cents ?? 0;
  const chip = c.chip_in_cents ?? 0;
  const appFee = c.application_fee_cents ?? 0;
  const bad = (why: string): SessionPlan => ({ ok: false, error: `The payment amounts did not add up (${why}), so nothing was sent to Stripe. Nothing was charged; please try again.` });

  if (![gift, fee, chip, appFee, c.amount_cents].every(isCents)) return bad("an amount is missing or not in whole cents");
  if (gift + fee !== c.amount_cents) return bad("gift and card fee differ from the organization's charge");
  if (c.total_cents !== undefined && c.total_cents !== null && gift + fee + chip !== c.total_cents) return bad("the lines differ from the total");
  if (chip === 0 && appFee !== 0) return bad("an application fee without a Chip In");
  if (chip > 0 && appFee >= gift + fee + chip) return bad("the application fee is not below the charge");

  const label = (key: string, fallback: string) => text((c.lines ?? []).find((l) => l?.key === key)?.label, fallback);
  const currency = c.currency || "usd";
  const line = (name: string, cents: number, description?: string) => ({
    quantity: 1,
    price_data: { currency, unit_amount: cents, product_data: { name: name.slice(0, 250), ...(description ? { description } : {}) } },
  });
  const lineItems = [line(`${c.for_label} · ${c.center_name}`, gift)];
  if (fee > 0) {
    lineItems.push(
      line(
        label("covered_fee", c.pay_method === "ach" ? "Bank debit fee you chose to cover" : "Card fee you chose to cover"),
        fee,
        `Added so ${c.center_name} receives your full gift. About what Stripe charges.`,
      ),
    );
  }
  if (chip > 0) {
    lineItems.push(line(label("chip_in", "Chip In to Weaver (optional)"), chip, `A contribution to Weaver, not a gift to ${c.center_name}.`));
  }

  // The database computed the fee and the application fee for ONE payment method, so the session offers only that one
  // whenever a fee is covered or a Chip In is added (a payer who switched method on Stripe's page would invalidate the numbers).
  const only = c.pay_method === "card" ? ["card"] : c.pay_method === "ach" ? ["us_bank_account"] : null;
  const restrict = c.restrict_to_method === true || chip > 0;
  if (restrict && !only) return bad("the payment method the amounts were worked out for is missing");
  const methods = restrict && only ? only : stripePaymentMethodTypes(c.methods);

  const minutes = isCents(c.session_minutes) && c.session_minutes > 0 ? c.session_minutes : chip > 0 ? CHIP_IN_SESSION_MINUTES : null;
  const suffix = (c.statement_descriptor ?? "").trim().slice(0, 22);
  const extras = fee > 0 || chip > 0;
  const metadata = { checkout_id: c.checkout_id };
  const detail = extras ? { gift_cents: gift, covered_fee_cents: fee, chip_in_cents: chip } : {};

  return {
    ok: true,
    params: {
      mode: "payment",
      client_reference_id: c.checkout_id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_method_types: methods,
      line_items: lineItems,
      metadata: { ...metadata, ...detail },
      payment_intent_data: {
        metadata: { ...metadata, ...detail },
        ...(suffix.length >= 2 ? { statement_descriptor_suffix: suffix } : {}),
        ...(chip > 0 && appFee > 0 ? { application_fee_amount: appFee } : {}),
      },
      ...(minutes !== null ? { expires_at: nowSeconds + Math.min(Math.max(minutes, MIN_SESSION_MINUTES), MAX_SESSION_MINUTES) * 60 } : {}),
    },
  };
}
