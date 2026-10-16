// Giving › Payments in the New look (docs/GIVING_REDESIGN.md section 4, slice 3; owner decision 1: Recurring is a view here).
// Pure: no React, no database. Every payment, searchable, with chips for the method and the source, and four views:
//   All payments · Refunds (requests and refunds made in a card provider's dashboard) · Grants to match (fund grants and matching
//   gifts the bank shows, with the Bank add-on) · Recurring (read-only, with the Recurring gifts add-on).
// The offering counts have their own tab since slice 5 (/giving/counts); ?view=counts here sends there.
//
// A row acts in place through the same sheets as Today: Refund… (a reason the second approver reads), Approve as second person
// (never one's own request; the database refuses it and the row says so), Record the refund (by hand, or through Stripe or PayPal
// with a fresh code), Apply to pledges, Open family. A finance volunteer sees only what they recorded (the database decides).

import { formatDate } from "@/lib/dates";
import { frequencyText, monthDay } from "@/lib/giving";
import { familyRef, recordRefundAct, type Act, type Family } from "@/lib/giving-today/queue";
import { checkWord } from "@/lib/kind-samples";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";

import { familyHref } from "./links";
import type { Chip, ListContext, ListRow, Tone } from "./types";

// ---------------------------------------------------------------------------- Views and chips

function capital(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

export type PaymentViewKey = "all" | "refunds" | "grants" | "recurring";

/** on: shown; off: its module is switched off; no_access: the person cannot see it. */
export type ViewState = "on" | "off" | "no_access";

export function paymentViewFromParam(value: string | undefined): PaymentViewKey {
  return value === "refunds" || value === "grants" || value === "recurring" ? value : "all";
}

export function paymentViewChips(
  states: Record<Exclude<PaymentViewKey, "all">, ViewState>,
  counts: Partial<Record<PaymentViewKey, number | null>>,
  active: PaymentViewKey,
  hrefFor: (view: PaymentViewKey) => string,
): Chip[] {
  const views: { key: PaymentViewKey; label: string }[] = [
    { key: "all", label: "All payments" },
    { key: "refunds", label: "Refunds" },
    { key: "grants", label: "Grants to match" },
    { key: "recurring", label: "Recurring" },
  ];
  return views
    .filter((v) => v.key === "all" || states[v.key] === "on")
    .map((v) => ({ key: v.key, label: v.label, href: hrefFor(v.key), count: counts[v.key] ?? null, on: v.key === active }));
}

/** Method chips: one chip can stand for several methods (a card includes Apple Pay and Google Pay). */
export const METHOD_CHIPS: readonly { key: string; methods: readonly string[]; label: (locale: string) => string; plugin?: string }[] = [
  { key: "check", methods: ["check"], label: (l) => capital(checkWord(l)) },
  { key: "cash", methods: ["cash"], label: () => "Cash" },
  { key: "card", methods: ["card", "apple_pay", "google_pay"], label: () => "Card" },
  { key: "ach", methods: ["ach"], label: () => "Bank transfer" },
  { key: "zelle", methods: ["zelle"], label: () => "Zelle", plugin: "zelle" },
  { key: "stock", methods: ["stock"], label: () => "Stock" },
  { key: "grant", methods: ["daf", "matching_gift"], label: () => "Fund grants and matching gifts" },
  { key: "paypal", methods: ["paypal", "venmo"], label: () => "PayPal or Venmo" },
  { key: "other", methods: ["other"], label: () => "Other" },
];

export const SOURCE_CHIPS: readonly { key: string; label: string }[] = [
  { key: "offline", label: "Recorded by hand" },
  { key: "bank", label: "From the bank" },
  { key: "online", label: "Online" },
];

export function methodChip(value: string | undefined) {
  return METHOD_CHIPS.find((m) => m.key === value) ?? null;
}

export function sourceChip(value: string | undefined) {
  return SOURCE_CHIPS.find((s) => s.key === value) ?? null;
}

/** The method chips this community sees: Zelle only where its plugin is on. */
export function methodChips(active: string | null, locale: string, plugins: readonly string[], hrefFor: (key: string | null) => string): Chip[] {
  return [
    { key: "", label: "All methods", href: hrefFor(null), count: null, on: !active },
    ...METHOD_CHIPS.filter((m) => !m.plugin || plugins.includes(m.plugin)).map((m) => ({ key: m.key, label: m.label(locale), href: hrefFor(m.key), count: null, on: active === m.key })),
  ];
}

export function sourceChips(active: string | null, bankOn: boolean, hrefFor: (key: string | null) => string): Chip[] {
  return [
    { key: "", label: "All sources", href: hrefFor(null), count: null, on: !active },
    ...SOURCE_CHIPS.filter((s) => s.key !== "bank" || bankOn).map((s) => ({ key: s.key, label: s.label, href: hrefFor(s.key), count: null, on: active === s.key })),
  ];
}

// ---------------------------------------------------------------------------- The year, and the query a list and its export share

/** ?year=2026: payments received in that calendar year (1990 to next year); anything else means every year. */
export function yearFromParam(value: string | undefined, today: string): number | null {
  if (!value || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= 1990 && year <= Number(today.slice(0, 4)) + 1 ? year : null;
}

/** All years, this year and the two before it (and a year the address asks for that is older). */
export function yearChips(active: number | null, today: string, hrefFor: (key: string | null) => string): Chip[] {
  const now = Number(today.slice(0, 4));
  const years = [now, now - 1, now - 2];
  if (active !== null && !years.includes(active)) years.push(active);
  return [
    { key: "", label: "All years", href: hrefFor(null), count: null, on: active === null },
    ...years.map((y) => ({ key: String(y), label: String(y), href: hrefFor(String(y)), count: null, on: active === y })),
  ];
}

/** What All payments and Refund requests read. The list and its export build their query from this, so the file is the list. */
export type PaymentQuery = {
  view: "all" | "refunds";
  method: (typeof METHOD_CHIPS)[number] | null;
  source: (typeof SOURCE_CHIPS)[number] | null;
  year: number | null;
};

/** The chips apply to All payments only (Refund requests has none), as the list shows them. */
export function paymentQuery(view: "all" | "refunds", get: (key: string) => string | undefined, today: string): PaymentQuery {
  if (view === "refunds") return { view, method: null, source: null, year: null };
  return { view, method: methodChip(get("method")), source: sourceChip(get("source")), year: yearFromParam(get("year"), today) };
}

// ---------------------------------------------------------------------------- Payment rows

export type PaymentIn = {
  id: string;
  receipt: string | null;
  householdId: string;
  receivedOn: string;
  method: string;
  amountCents: number;
  status: string;
  provider: string | null;
  checkNumber: string | null;
  envelopeNumber: string | null;
  recordedBy: string | null;
  recordedByName: string | null;
  refundedCents: number;
  /** The refund request (two-person rule, 0016): one per payment. */
  refundBy: string | null;
  refundByName: string | null;
  refundSecond: string | null;
  refundReason: string | null;
  refundRequestedCents: number | null;
  refundSince: string | null;
  /** A check or cash payment recorded by hand: has it been matched to a bank deposit? null for other payments. */
  deposited: boolean | null;
  openingBalance: boolean;
  /** How much of it is applied to pledges; null when the person may not read allocations. */
  appliedCents: number | null;
};

const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  authorized: { label: "Authorized", tone: "info" },
  captured: { label: "Received", tone: "ok" },
  pending_clearing: { label: "Clearing", tone: "info" },
  settled: { label: "Received", tone: "ok" },
  refunded: { label: "Refunded", tone: "muted" },
  partially_refunded: { label: "Part refunded", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  voided: { label: "Voided", tone: "bad" },
};

const ONLINE_NAME: Record<string, string> = { stripe: "Stripe", paypal: "PayPal" };

export function sourceText(provider: string | null): string {
  if (provider === "offline") return "recorded by hand";
  if (provider === "bank") return "from the bank";
  if (provider && ONLINE_NAME[provider]) return `online (${ONLINE_NAME[provider]})`;
  return provider ? `online (${provider})` : "recorded by hand";
}

export function methodText(method: string, locale: string): string {
  if (method === "check") return capital(checkWord(locale));
  return PAYMENT_METHOD_LABEL[method] ?? method;
}

export function refundable(p: Pick<PaymentIn, "refundedCents" | "amountCents" | "status">): boolean {
  return p.refundedCents < p.amountCents && !["failed", "voided", "authorized"].includes(p.status);
}

export function paymentRow(p: PaymentIn, family: Family | null, ctx: ListContext, found: string | null = null): ListRow {
  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  const ref = p.receipt ?? "the payment";
  const fam = familyRef(family);
  const requested = p.refundRequestedCents ?? p.amountCents - p.refundedCents;
  const ask = money(requested);
  const asked = p.refundBy === ctx.me ? "you" : (p.refundByName ?? "a colleague");

  const how = [methodText(p.method, ctx.locale), p.checkNumber ? `no. ${p.checkNumber}` : null, p.envelopeNumber ? `envelope ${p.envelopeNumber}` : null, sourceText(p.provider)]
    .filter(Boolean)
    .join(" · ");
  const lines: string[] = [how];
  if (p.appliedCents !== null) {
    lines.push(
      p.appliedCents >= p.amountCents
        ? "Fully applied to pledges"
        : p.appliedCents > 0
          ? `${money(p.appliedCents)} applied · ${money(p.amountCents - p.appliedCents)} not applied`
          : "Not applied to a pledge",
    );
  }
  lines.push(`Recorded by ${p.recordedBy === ctx.me ? "you" : (p.recordedByName ?? (p.recordedBy ? "a colleague" : "the system"))}`);
  if (p.deposited !== null) lines.push(p.deposited ? "Deposited at the bank" : "Waiting for the bank deposit");
  if (p.openingBalance) lines.push("Opening balance brought in from the old system");

  const primary: Act[] = [];
  const menu: Act[] = [];
  let note: string | null = null;
  let status = PAYMENT_STATUS[p.status] ?? { label: p.status.replace(/_/g, " "), tone: "info" as Tone };

  if (p.refundBy) {
    lines.push(`Refund of ${ask} asked by ${asked}${p.refundSince ? ` on ${formatDate(p.refundSince, ctx.timeZone)}` : ""}`);
    lines.push(p.refundReason ? `Reason: “${p.refundReason}”` : "No reason was written down. Ask the person who requested it.");
    if (p.refundedCents > 0 && p.refundSecond) {
      note = `Refund of ${money(p.refundedCents)} recorded. One refund request per payment for now.`;
    } else if (!p.refundSecond) {
      status = { label: "Refund asked", tone: "warn" };
      if (p.refundBy !== ctx.me && ctx.can.approve) {
        primary.push({
          kind: "approve",
          table: "payments",
          id: p.id,
          label: `Approve ${ask} refund for ${fam}`,
          what: `You are the second approver. A treasurer then records the refund on ${ref}. This cannot be undone here.`,
          done: `Done: second approval recorded for the ${ask} refund on ${ref} (${fam}).`,
        });
      } else {
        note =
          p.refundBy === ctx.me
            ? "You asked for this refund, so a different person with approval rights approves it."
            : "Waiting for a second approver with approval rights.";
      }
    } else {
      status = { label: "Refund approved", tone: "ok" };
      const act = ctx.can.manage ? recordRefundAct({ id: p.id, provider: p.provider, amountCents: requested, reference: ref, reason: p.refundReason }, fam, ask, ctx.paypalEmailOnly) : null;
      if (act) primary.push(act);
      else note = ctx.can.manage ? "Approved. This provider's refunds are made on its own screen." : "Approved by two people. A treasurer records the refund.";
    }
  } else if (ctx.can.manage && refundable(p)) {
    menu.push({ kind: "request_refund", id: p.id, refundableCents: p.amountCents - p.refundedCents, reference: ref, label: "Refund…" });
  }

  if (ctx.can.allocate && p.appliedCents !== null && p.appliedCents < p.amountCents && !p.refundBy && ["captured", "settled", "pending_clearing"].includes(p.status)) {
    const rest = money(p.amountCents - p.appliedCents);
    primary.push({
      kind: "apply",
      paymentId: p.id,
      householdId: p.householdId,
      label: `Apply ${rest} to ${fam}'s pledges`,
      what: `Applies ${rest} of ${ref} to the family's earliest open pledges. Anything left stays a general gift. This cannot be undone here.`,
    });
  }
  menu.push({ kind: "link", href: familyHref(p.householdId, "payments"), label: "Open family" });

  return {
    id: p.id,
    reference: p.receipt ?? "—",
    family,
    title: `Receipt ${ref} · ${money(p.amountCents)}`,
    lines,
    amount: money(p.amountCents),
    amountNote: p.refundedCents > 0 ? `−${money(p.refundedCents)} refunded` : null,
    date: formatDate(p.receivedOn, ctx.timeZone),
    status,
    note,
    found,
    primary,
    menu,
    history: { table: "payments", title: `Payment ${p.receipt ?? ""}`.trim() },
    ...(ctx.evidence ? { evidence: { paymentId: p.id, reference: ref, canAttach: ctx.evidence.canAttach, canRemove: ctx.evidence.canRemove } } : {}),
  };
}

// ---------------------------------------------------------------------------- Refunds made in a provider's dashboard

export type FlaggedIn = {
  id: string;
  provider: string;
  amountCents: number;
  refundedOn: string | null;
  providerRef: string;
  firstApprover: string | null;
  firstApproverName: string | null;
  receipt: string | null;
  householdId: string;
  paymentAmountCents: number;
};

export function flaggedRow(f: FlaggedIn, family: Family | null, ctx: ListContext): ListRow {
  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  const amt = money(f.amountCents);
  const fam = familyRef(family);
  const provider = ONLINE_NAME[f.provider] ?? "the card provider";
  const ref = f.receipt ?? "the payment";
  const first = !f.firstApprover;
  const primary: Act[] = [];
  let note: string | null = null;
  if (first && ctx.can.manage) {
    primary.push({
      kind: "flagged",
      id: f.id,
      stage: "first",
      label: `Approve ${amt} card refund for ${fam} (first approval)`,
      what: "Your approval and reason are kept in the audit log. A different person with approval rights approves it second; only then is the refund recorded on the payment.",
    });
  } else if (!first && ctx.can.approve && f.firstApprover !== ctx.me) {
    primary.push({
      kind: "flagged",
      id: f.id,
      stage: "second",
      label: `Approve ${amt} card refund for ${fam} as second person`,
      what: "The refund is recorded on the payment from now on. This cannot be undone here.",
    });
  } else if (!first && f.firstApprover === ctx.me) {
    note = "You approved it first, so a different person with approval rights approves it second.";
  } else {
    note = first ? "Waiting for a treasurer's first approval." : "Waiting for a second approver with approval rights.";
  }
  return {
    id: f.id,
    reference: f.receipt ?? "—",
    family,
    title: `Refund of ${amt} made in ${provider} on receipt ${ref}`,
    lines: [
      `Made in the ${provider} dashboard${f.refundedOn ? ` on ${formatDate(f.refundedOn, ctx.timeZone)}` : ""} · ${f.providerRef}`,
      `The payment was ${money(f.paymentAmountCents)}`,
      first
        ? "Weaver did not record it. Nothing changes on the payment until two different people approve it."
        : `Approved first by ${f.firstApprover === ctx.me ? "you" : (f.firstApproverName ?? "a colleague")}. A second, different person approves it.`,
    ],
    amount: amt,
    amountNote: `of ${money(f.paymentAmountCents)}`,
    date: f.refundedOn ? formatDate(f.refundedOn, ctx.timeZone) : "—",
    status: { label: first ? "Flagged · needs two approvals" : "Flagged · needs a second approval", tone: "warn" },
    note,
    found: null,
    primary,
    menu: [{ kind: "link", href: familyHref(f.householdId, "payments"), label: "Open family" }],
    history: null,
  };
}

// ---------------------------------------------------------------------------- Grants to match (the Bank add-on)

export const GRANT_KINDS = ["daf", "matching_gift", "payroll_giving"] as const;
export type GrantKind = (typeof GRANT_KINDS)[number];

const GRANT_WORD: Record<GrantKind, string> = { daf: "Donor-advised fund grant", matching_gift: "Matching gift", payroll_giving: "Payroll giving" };

export function isGrantKind(v: string | null | undefined): v is GrantKind {
  return (GRANT_KINDS as readonly string[]).includes(v ?? "");
}

export type GrantIn = {
  id: string;
  postedOn: string;
  amountCents: number;
  description: string;
  payerName: string | null;
  reference: string | null;
  checkOrSlip: string | null;
  kind: string | null;
  status: string;
  matchedFamily: Family | null;
};

export function grantRef(g: Pick<GrantIn, "id" | "reference" | "checkOrSlip">): string {
  return g.reference ?? g.checkOrSlip ?? `DEP-${g.id.slice(0, 6).toUpperCase()}`;
}

export function grantRow(g: GrantIn, ctx: ListContext): ListRow {
  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  const kind: GrantKind = isGrantKind(g.kind) ? g.kind : "daf";
  const word = GRANT_WORD[kind];
  const ref = grantRef(g);
  const source = g.payerName ?? "Unknown sender";
  const matched = g.status === "matched";
  const primary: Act[] =
    !matched && ctx.can.bankConfirm
      ? [{ kind: "grant_match", txnId: g.id, amountCents: g.amountCents, reference: ref, source, grant: kind, postedOn: g.postedOn, memo: g.description, label: `Match ${money(g.amountCents)}…` }]
      : [];
  return {
    id: g.id,
    reference: ref,
    family: g.matchedFamily,
    title: `${word} of ${money(g.amountCents)}`,
    lines: [
      `From ${source}`,
      g.description,
      kind === "matching_gift" ? "No tax receipt: the matching platform receipts its donor." : "No tax receipt: the fund's sponsor receipts the donor.",
    ].filter(Boolean),
    amount: money(g.amountCents),
    amountNote: null,
    date: monthDay(g.postedOn),
    status: matched ? { label: "Matched", tone: "ok" } : { label: "To match", tone: "warn" },
    note: !matched && !ctx.can.bankConfirm ? "A treasurer matches it to the family." : null,
    found: null,
    primary,
    menu: g.matchedFamily ? [{ kind: "link", href: familyHref(g.matchedFamily.id, "payments"), label: "Open family" }] : [],
    history: null,
  };
}

// ---------------------------------------------------------------------------- Recurring (read-only; the Recurring gifts add-on)

export const RECURRING_CHIPS: readonly { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "failed", label: "Failed" },
  { key: "paused", label: "Paused" },
  { key: "pending_payment_method", label: "Waiting for a payment method" },
  { key: "cancelled", label: "Cancelled" },
];

export function recurringChipFromParam(value: string | undefined): string {
  return RECURRING_CHIPS.find((c) => c.key === value)?.key ?? "all";
}

export type RecurringIn = {
  id: string;
  householdId: string;
  amountCents: number;
  frequency: string;
  method: string;
  nextChargeOn: string | null;
  status: string;
  /** A campaign or fund name, "A special day" or "General fund". */
  cause: string;
  linksToPledges: boolean;
};

const RECURRING_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "ok" },
  failed: { label: "Payment failed", tone: "bad" },
  paused: { label: "Paused by the giver", tone: "warn" },
  pending_payment_method: { label: "Waiting for a payment method", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export function recurringRow(r: RecurringIn, family: Family | null, ctx: ListContext): ListRow {
  const money = formatCents(r.amountCents, ctx.currency, ctx.locale);
  return {
    id: r.id,
    reference: frequencyText(r.frequency),
    family,
    title: `${money} · ${frequencyText(r.frequency).toLowerCase()}`,
    lines: [r.cause, methodText(r.method, ctx.locale), r.linksToPledges ? "Closes the family's pledges" : "Does not close pledges"],
    amount: money,
    amountNote: frequencyText(r.frequency),
    date: r.nextChargeOn ? `Next ${monthDay(r.nextChargeOn)}` : "No next date",
    status: RECURRING_STATUS[r.status] ?? { label: r.status.replace(/_/g, " "), tone: "info" },
    note: null,
    found: null,
    primary: [],
    menu: [{ kind: "link", href: familyHref(r.householdId, "payments"), label: "Open family" }],
    history: { table: "recurring_gifts", title: "Recurring gift" },
  };
}
