// Settings › Payments and the checkout: labels, the offline methods' fields,
// and the few rules the screen checks before the database does. Pure; tested.

export type Processor = "stripe" | "paypal";
export const PROCESSORS: Processor[] = ["stripe", "paypal"];
export const PROCESSOR_LABEL: Record<Processor, string> = { stripe: "Stripe", paypal: "PayPal" };

export const ONLINE_METHODS: Record<Processor, { key: string; label: string }[]> = {
  stripe: [
    { key: "card", label: "Card" },
    { key: "ach", label: "ACH bank debit" },
    { key: "apple_pay", label: "Apple Pay" },
    { key: "google_pay", label: "Google Pay" },
  ],
  paypal: [
    { key: "paypal", label: "PayPal" },
    { key: "venmo", label: "Venmo" },
    { key: "card", label: "Cards through PayPal" },
  ],
};

export type OfflineField = { key: string; label: string; placeholder?: string; multiline?: boolean };
export type OfflineMethod = { method: string; label: string; fields: OfflineField[] };

/** Offline methods and the instructions members see (ONBOARDING_PLAN §1.2). Required fields come from the database. */
export const OFFLINE_METHODS: OfflineMethod[] = [
  { method: "check", label: "Check", fields: [
    { key: "payee", label: "Make checks payable to", placeholder: "Jain Society of Houston" },
    { key: "address", label: "Mailing address", multiline: true },
    { key: "memo_hint", label: "What to write in the memo", placeholder: "Your member number" },
  ] },
  { method: "cash", label: "Cash (bhandar)", fields: [
    { key: "where", label: "Where to give cash", placeholder: "Bhandar at the temple office" },
    { key: "note", label: "Anything else", multiline: true },
  ] },
  { method: "zelle", label: "Zelle", fields: [
    { key: "recipient", label: "Zelle email or phone" },
    { key: "name", label: "Name shown in Zelle" },
    { key: "memo_hint", label: "What to write in the memo", placeholder: "Your member number" },
  ] },
  { method: "ach", label: "ACH and wire", fields: [
    { key: "details", label: "Bank, routing and account details", multiline: true },
    { key: "note", label: "Anything else", multiline: true },
  ] },
  { method: "stock", label: "Stock", fields: [
    { key: "details", label: "Broker, DTC number and account", multiline: true },
    { key: "contact", label: "Who to tell when you transfer" },
  ] },
  { method: "daf", label: "Donor-advised fund", fields: [
    { key: "legal_name", label: "Legal name" },
    { key: "ein", label: "EIN", placeholder: "12-3456789" },
    { key: "address", label: "Mailing address", multiline: true },
  ] },
  { method: "matching_gift", label: "Matching gift", fields: [
    { key: "legal_name", label: "Legal name" },
    { key: "ein", label: "EIN", placeholder: "12-3456789" },
    { key: "note", label: "Anything else", multiline: true },
  ] },
];

export function offlineMethodLabel(method: string): string {
  return OFFLINE_METHODS.find((m) => m.method === method)?.label ?? method.replace(/_/g, " ");
}

export type Tone = "ok" | "warn" | "bad";

export function processorStatusView(status: string | null | undefined, apiMode?: string | null): { label: string; tone: Tone } {
  switch (status) {
    case "live":
      return { label: "Live", tone: "ok" };
    case "test":
      return { label: apiMode === "live" ? "Connected · not open to members yet" : "Test mode", tone: "warn" };
    case "pending_verification":
      return { label: "Waiting for the provider", tone: "warn" };
    case "disabled":
      return { label: "Disabled", tone: "bad" };
    default:
      return { label: "Not connected", tone: "warn" };
  }
}

/** Mirrors app.statement_descriptor_problem so the form can say it before saving. */
export function statementDescriptorProblem(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (s.length < 5) return "The statement descriptor needs at least 5 characters.";
  if (s.length > 22) return "The statement descriptor can be at most 22 characters.";
  if (!/[A-Za-z]/.test(s)) return "The statement descriptor needs at least one letter.";
  if (/[<>\\'"*]/.test(s)) return "The statement descriptor cannot contain < > \\ ' \" or *.";
  if (!/^[ -~]+$/.test(s)) return "The statement descriptor can use plain English letters, digits and punctuation only.";
  return null;
}

/** Cents → "12.34" for PayPal amounts (integer arithmetic only). */
export function centsToDecimal(c: number): string {
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** Stripe Checkout payment_method_types for the chosen methods (Apple/Google Pay come with "card"). */
export function stripePaymentMethodTypes(methods: string[]): string[] {
  const out = new Set<string>();
  for (const m of methods) {
    if (m === "card" || m === "apple_pay" || m === "google_pay") out.add("card");
    if (m === "ach") out.add("us_bank_account");
  }
  return out.size > 0 ? [...out] : ["card"];
}

/**
 * Where a payment was started from, as app.payment_checkouts.context records it (0211:87, 760). `pathshala` is a
 * Pathshala fee (PATHSHALA_REGISTRATION_PLAN F17; the database accepts it from 0590): it is labelled and reported as a
 * fee, never as a gift. A context outside this list is recorded as "other" (the route logs it, see isCheckoutContext).
 */
export const CHECKOUT_CONTEXTS = ["rsvp", "rsvp_later", "pledges", "opportunity", "labh", "store", "other", "portal", "pathshala"] as const;
export type CheckoutContext = (typeof CHECKOUT_CONTEXTS)[number];

export function isCheckoutContext(v: unknown): v is CheckoutContext {
  return typeof v === "string" && (CHECKOUT_CONTEXTS as readonly string[]).includes(v);
}

/** The line on the provider's page when the app sent none: a Pathshala fee is a fee (P20), everything else a gift. */
function defaultForLabel(context: string): string {
  return context === "pathshala" ? "Pathshala fee" : "Gift";
}

/** How the payer pays, as app.payment_addons_quote and app.create_checkout name it. Apple Pay and Google Pay are cards. */
export type PayMethod = "card" | "ach";

export type IntentRequest = {
  center_id: string;
  household_id: string;
  /** The GIFT. The covered card fee and the Chip In are added by the database on top of it. */
  amount_cents: number;
  pledge_ids: string[];
  processor: Processor | null;
  context: string;
  for_label: string;
  return_url: string | null;
  /** The payer ticked "add the card fee" (default false: an older app sends nothing and is charged exactly as before). */
  cover_fee: boolean;
  /** The Chip In the payer chose, in cents (default 0: none). */
  chip_in_cents: number;
  /** The method the payer chose first; the database defaults it. */
  pay_method: PayMethod | null;
  /** The total the payer saw (from payment_addons_quote); a different total is refused with SQLSTATE CCTOT. Null: not checked. */
  expected_total_cents: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The four refusals app.create_checkout raises for the add-ons (0862). Their messages are plain English already. */
export const CHECKOUT_REFUSAL_CODES = ["CCFEE", "CCCHP", "CCLIM", "CCTOT"] as const;
export type CheckoutRefusalCode = (typeof CHECKOUT_REFUSAL_CODES)[number];

export function isCheckoutRefusalCode(v: unknown): v is CheckoutRefusalCode {
  return typeof v === "string" && (CHECKOUT_REFUSAL_CODES as readonly string[]).includes(v);
}

/**
 * The sentence the payer sees when the database refuses the card fee, the Chip In or the total (docs/PAYMENT_ADDONS.md §4.4):
 * what could not be done, why (the database's own words), and that nothing was charged. Nothing has been sent to Stripe.
 */
export function checkoutRefusalMessage(code: CheckoutRefusalCode, reason: string): string {
  const why = reason.trim() || "It is not available for this payment.";
  const sentence = /[.!?]$/.test(why) ? why : `${why}.`;
  const what = code === "CCLIM" || code === "CCCHP" ? "Could not add a Chip In." : "Could not start the payment.";
  return `${what} ${sentence} Nothing was charged.`;
}

/** Checks the member app's JSON before anything is asked of the database or the provider. */
export function parseIntentRequest(body: unknown): { ok: true; value: IntentRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "The request body must be JSON." };
  const b = body as Record<string, unknown>;
  if (typeof b.center_id !== "string" || !UUID.test(b.center_id)) return { ok: false, error: "center_id is missing." };
  if (typeof b.household_id !== "string" || !UUID.test(b.household_id)) return { ok: false, error: "household_id is missing." };
  const amount = b.amount_cents;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 50) return { ok: false, error: "The amount must be at least $0.50, in whole cents." };
  const pledges = Array.isArray(b.pledge_ids) ? b.pledge_ids : [];
  if (pledges.some((p) => typeof p !== "string" || !UUID.test(p))) return { ok: false, error: "A pledge id is not valid." };
  const processor = b.processor === "stripe" || b.processor === "paypal" ? b.processor : null;
  const context = isCheckoutContext(b.context) ? b.context : "other";
  const forLabel = typeof b.for_label === "string" && b.for_label.trim() ? b.for_label.trim().slice(0, 200) : defaultForLabel(context);
  const ret = typeof b.return_url === "string" && /^https?:\/\//.test(b.return_url) ? b.return_url : null;
  // The add-ons (0862). Absent means "none", so an app that sends none of them is charged exactly as before; a value of the wrong
  // kind is refused rather than dropped, because dropping a payer's choice would charge them something they did not choose.
  if (b.cover_fee !== undefined && b.cover_fee !== null && typeof b.cover_fee !== "boolean") return { ok: false, error: "cover_fee must be true or false." };
  const chip = b.chip_in_cents ?? 0;
  if (typeof chip !== "number" || !Number.isSafeInteger(chip) || chip < 0) return { ok: false, error: "The Chip In must be a whole number of cents, zero or more." };
  if (b.pay_method !== undefined && b.pay_method !== null && b.pay_method !== "card" && b.pay_method !== "ach") return { ok: false, error: "pay_method must be card or ach." };
  const expected = b.expected_total_cents ?? null;
  if (expected !== null && (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0)) return { ok: false, error: "expected_total_cents must be a whole number of cents." };
  return {
    ok: true,
    value: {
      center_id: b.center_id,
      household_id: b.household_id,
      amount_cents: amount,
      pledge_ids: pledges as string[],
      processor,
      context,
      for_label: forLabel,
      return_url: ret,
      cover_fee: b.cover_fee === true,
      chip_in_cents: chip,
      pay_method: b.pay_method === "card" || b.pay_method === "ach" ? b.pay_method : null,
      expected_total_cents: expected,
    },
  };
}

// ── app.payment_settings(center) ────────────────────────────────────────────
export type ProcessorSettings = {
  processor: Processor;
  status: string;
  is_default: boolean;
  methods: string[];
  statement_descriptor: string | null;
  donor_covers_fee_allowed: boolean;
  api_mode: "test" | "live";
  connection: {
    id: string;
    status: string;
    external_account_id: string | null;
    display_name: string | null;
    connected_at: string | null;
    last_error: string | null;
    mode: string;
    connect_method: string | null;
    charges_enabled: boolean | null;
    paypal_email: string | null;
    paypal_email_verified_at: string | null;
  } | null;
  last_job: { id: number; status: string; last_error: string | null; created_at: string } | null;
  tests: { mode: string; ok: boolean; ran_at: string; detail: string | null; charge_ref: string | null; refund_ref: string | null }[];
  test_pending: { checkout_id: string; status: string; mode: string; created_at: string; checkout_url: string | null } | null;
};
export type MethodSettings = { method: string; accepted: boolean; instructions: Record<string, string>; sort: number; required: string[] };
export type PaymentSettings = {
  environment: string;
  forced_test: boolean;
  offline_only: boolean;
  processors: ProcessorSettings[];
  methods: MethodSettings[];
  paypal_email_pending: { email: string; expires_at: string; attempts: number } | null;
  payouts: { provider: string; provider_ref: string; gross_cents: number; fee_cents: number; net_cents: number; arrives_on: string | null; matched: boolean }[];
  messaging_available: boolean;
  can_configure: boolean;
  can_connect: boolean;
};

export function connectMethodLabel(m: string | null | undefined): string {
  return m === "email" ? "verified PayPal Business email" : m === "partner" ? "Connect with PayPal" : m === "oauth" ? "Stripe Connect" : "—";
}
