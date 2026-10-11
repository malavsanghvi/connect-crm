// What the Giving page shows, worked out from what the existing Giving read and draft commands return. Pure: no database, no
// React, so every sentence and every link is tested (tests/giving-workspace-view.test.ts).
//
// MONEY RULE: nothing here records money. The confirmation card is built from giving.draft_payment (which saves nothing); its
// main button opens the EXISTING Record payment screen with the details filled in (recordPaymentHref), and that screen's own
// button records it exactly as before.

import type { UnmatchedBankData } from "@/lib/commands/catalog/giving-bank-lines";
import type { PaymentDraftData } from "@/lib/commands/catalog/giving-draft-payment";
import type { SecondApproverData } from "@/lib/commands/catalog/giving-second-approver";
import type { ZelleWaitingData } from "@/lib/commands/catalog/giving-zelle-waiting";
import type { CloseBlockersData } from "@/lib/commands/catalog/month-close-blockers";
import { OFFLINE_METHODS } from "@/lib/labels";
import { parseAmountToCents } from "@/lib/money";
import { param, isUuid, type RawSearchParams } from "@/lib/search-params";

import type { OfflineMethodKey, PaymentAsk } from "./ask";

// ---------------------------------------------------------------------------- The draft request and the prefilled link

/** What giving.draft_payment is asked for. The household is always one the person chose from its card. */
export type DraftRequest = {
  household_id: string;
  amount: string;
  method: OfflineMethodKey;
  received_on?: string;
  reference?: string;
  allocation: "auto" | "none";
};

/** The request for a household the person picked, from what they asked. Null while the amount is missing. Check is the form's own default method. */
export function draftRequest(ask: PaymentAsk, householdId: string, allocation: "auto" | "none" = "auto"): DraftRequest | null {
  if (!ask.amount) return null;
  return {
    household_id: householdId,
    amount: ask.amount,
    method: ask.method ?? "check",
    ...(ask.receivedOn ? { received_on: ask.receivedOn } : {}),
    ...(ask.reference ? { reference: ask.reference } : {}),
    allocation,
  };
}

/** The Record payment screen, filled in. Its own button records the payment; this link writes nothing. */
export const RECORD_PAYMENT_PATH = "/giving/payments";

/** The names of the prefill parameters. `paid_with`, not `method`: the payments list already filters on `method`. */
const P = { household: "household", amount: "amount", method: "paid_with", received: "received", reference: "ref", apply: "apply" } as const;

export function recordPaymentHref(req: DraftRequest): string {
  const q = new URLSearchParams();
  q.set(P.household, req.household_id);
  q.set(P.amount, req.amount);
  q.set(P.method, req.method);
  if (req.received_on) q.set(P.received, req.received_on);
  if (req.reference) q.set(P.reference, req.reference);
  if (req.allocation === "none") q.set(P.apply, "none");
  return `${RECORD_PAYMENT_PATH}?${q.toString()}`;
}

/** What the Record payment form starts with when it was opened from the Giving page (each value checked; anything odd is ignored). */
export type RecordPrefill = {
  amount?: string;
  method?: OfflineMethodKey;
  receivedOn?: string;
  reference?: string;
  allocation?: "none";
};

/** Read the prefill from the address. Returns null when there is none, so the form renders exactly as it always has. */
export function readRecordPrefill(sp: RawSearchParams, today: string): RecordPrefill | null {
  const out: RecordPrefill = {};
  const amount = param(sp, P.amount)?.trim();
  if (amount && amount.length <= 24) {
    const cents = parseAmountToCents(amount);
    if (cents !== null && cents > 0) out.amount = amount;
  }
  const method = param(sp, P.method);
  if (method && (OFFLINE_METHODS as readonly string[]).includes(method)) out.method = method as OfflineMethodKey;
  const received = param(sp, P.received);
  if (received && /^\d{4}-\d{2}-\d{2}$/.test(received) && received <= today) out.receivedOn = received;
  const reference = param(sp, P.reference)?.trim();
  if (reference && reference.length <= 120) out.reference = reference;
  if (param(sp, P.apply) === "none") out.allocation = "none";
  return Object.keys(out).length > 0 ? out : null;
}

/** A household id from the address, when it is one. */
export function prefillHousehold(sp: RawSearchParams): string | null {
  const id = param(sp, P.household);
  return isUuid(id) ? id : null;
}

// ---------------------------------------------------------------------------- The confirmation card

export type CardTone = "plain" | "strong" | "money" | "danger";
export type CardRow = { label: string; value: string; tone: CardTone };
export type CardNote = { text: string; tone: "warn" | "danger" };
export type CardCheck = { label: string; detail: string; status: "ok" | "look" | "unknown" };

export type DraftCardView = {
  rows: CardRow[];
  notes: CardNote[];
  /** The list a second person reviewing this payment would go through (evidence for second approvers). */
  checks: CardCheck[];
  amount: string;
  /** True when the payment closes or pays down at least one pledge. */
  applies: boolean;
  /** The label for recording it from the card (only used when the community switched that on). */
  recordLabel: string;
  needsALook: number;
};

const LOOK: readonly string[] = ["no_open_pledge", "named_not_open", "cannot_apply"];

/** "Sunday 4 October 2026", in the community's way of writing days. */
export function longDate(isoDate: string, locale: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  } catch {
    return isoDate;
  }
}

/** A household as one line on the card: its name and number. The card itself is shown beside it, never the name alone. */
export function householdLine(h: { household_name: string | null; household_number: string | null }): string {
  const name = h.household_name ?? "Unnamed household";
  return h.household_number ? `${name} (${h.household_number})` : name;
}

/**
 * The card's rows and notes. `about` is what the person said the money was for ("the building pledge"); when the household has no
 * open pledge, the card says so in the person's own words, so a wrong household is noticed before anything is recorded.
 */
export function draftCard(data: PaymentDraftData, opts: { locale: string; about?: string | null }): DraftCardView {
  const { payment, allocation: plan } = data;
  const applies = plan.lines.length > 0;
  const method = payment.check_number ? `${payment.method} · number ${payment.check_number}` : payment.method;
  let appliesTo: CardRow;
  if (applies) {
    const parts = plan.lines.map((l) => `${l.name}${l.pledge_number ? ` (${l.pledge_number})` : ""}: ${l.applied} of ${l.open_before} still open`);
    appliesTo = { label: "Applies to", value: parts.join("; "), tone: "strong" };
  } else if (plan.mode === "none") {
    appliesTo = { label: "Applies to", value: "No pledge: recorded as a general gift", tone: "strong" };
  } else {
    appliesTo = { label: "Applies to", value: plan.open_pledge_count === 0 ? "No open pledge: a general gift" : "Not applied to a pledge: a general gift", tone: "danger" };
  }
  const rows: CardRow[] = [
    { label: "Household", value: householdLine(data.household), tone: "strong" },
    { label: "Amount", value: payment.amount, tone: "money" },
    { label: "Method", value: method, tone: "plain" },
    { label: "Received", value: longDate(payment.received_on, opts.locale), tone: "plain" },
    ...(payment.memo ? [{ label: "Note", value: payment.memo, tone: "plain" as const }] : []),
    appliesTo,
    { label: "After this", value: plan.after.join(" ") || "No pledge changes.", tone: "plain" },
  ];
  const NO_PLEDGE = "This household has no open pledge";
  const notes: CardNote[] = data.questions.map((q) => {
    // In the person's own words when they named what it was for: "You mentioned “the building pledge”, but this household has no open pledge, …"
    const text = q.kind === "no_open_pledge" && opts.about && q.question.startsWith(NO_PLEDGE) ? `You mentioned “${opts.about}”, but this household has no open pledge${q.question.slice(NO_PLEDGE.length)}` : q.question;
    return { text, tone: LOOK.includes(q.kind) ? "danger" : "warn" };
  });
  return {
    rows,
    notes,
    checks: data.checks.map((c) => ({ label: c.label, detail: c.detail, status: c.status })),
    amount: payment.amount,
    applies,
    recordLabel: applies ? `Record payment · ${payment.amount}` : `Record as a general gift · ${payment.amount}`,
    needsALook: data.needs_a_look,
  };
}

/** Why the card cannot record by itself, in plain words, with the way it is done instead. */
export function recordSwitchOffNote(communityName: string): string {
  return `Recording straight from this card is switched off for ${communityName}: it moves money, so an owner has to switch it on first. Open it in Record payment, where everything is filled in. Nothing is saved until you press Record there.`;
}

// ---------------------------------------------------------------------------- The side lists

export type Part<T> = { state: "ok"; data: T } | { state: "no_access" } | { state: "off" } | { state: "error"; error: string };

export type PledgeTotals = { pledged_cents: number; paid_cents: number; open_cents: number; households: number; pledges: number; truncated: boolean };

/** Whole percent paid, 0 to 100 (rounded down, so a pledge list is never shown as done before it is). */
export function paidPercent(t: Pick<PledgeTotals, "pledged_cents" | "paid_cents">): number {
  if (t.pledged_cents <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((t.paid_cents * 100) / t.pledged_cents)));
}

export type CloseView = { title: string; items: { text: string; done: boolean; why?: string }[]; locked: boolean };

/** "October 2026 close: 3 of 4 checks", with what is done and what still blocks the lock. */
export function closeView(d: CloseBlockersData): CloseView {
  const total = d.done.length + d.blockers.length;
  const title = d.locked ? `${d.month} is locked` : `${d.month} close: ${d.done.length} of ${total} ${total === 1 ? "check" : "checks"}`;
  return {
    title,
    locked: d.locked,
    items: [...d.done.map((t) => ({ text: t, done: true })), ...d.blockers.map((b) => ({ text: b.item, done: false, why: b.why }))],
  };
}

export type WaitingRow = { key: "bank" | "zelle" | "approvals"; text: string; detail: string | null; count: number; href: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function bankRow(d: UnmatchedBankData): WaitingRow {
  const n = d.gifts + d.deposits;
  const parts: string[] = [];
  if (d.gifts > 0) parts.push(`${plural(d.gifts, "gift", "gifts")} (${d.gifts_total})`);
  if (d.deposits > 0) parts.push(`${plural(d.deposits, "deposit", "deposits")} (${d.deposits_total})`);
  if (d.oldest_days !== null && n > 0) parts.push(`oldest ${plural(d.oldest_days, "day", "days")}`);
  return {
    key: "bank",
    text: n === 0 ? "Every bank line is matched or set aside" : `${plural(n, "bank line", "bank lines")} to match`,
    detail: parts.length > 0 ? parts.join(" · ") : null,
    count: n,
    href: d.where_to_match,
  };
}

export function zelleRow(d: ZelleWaitingData, word: string): WaitingRow {
  const parts: string[] = [];
  if (d.waiting > 0) parts.push(d.total);
  if (d.past_window > 0) parts.push(`${d.past_window} past the report window`);
  if (d.exact_matches > 0) parts.push(`${d.exact_matches} with an exact bank line`);
  return {
    key: "zelle",
    text: d.waiting === 0 ? `No ${word} reports are waiting` : `${plural(d.waiting, `${word} report`, `${word} reports`)} waiting for the bank`,
    detail: parts.length > 0 ? parts.join(" · ") : null,
    count: d.waiting,
    href: "/giving/payments/bank?view=zelle",
  };
}

export function approvalsRow(d: SecondApproverData): WaitingRow {
  const parts: string[] = [];
  if (d.refunds > 0) parts.push(plural(d.refunds, "refund", "refunds"));
  if (d.write_offs > 0) parts.push(plural(d.write_offs, "write-off", "write-offs"));
  if (d.provider_refunds > 0) parts.push(plural(d.provider_refunds, "card refund", "card refunds"));
  return {
    key: "approvals",
    text: d.total === 0 ? "Nothing is waiting for a second approver" : `${plural(d.total, "request", "requests")} waiting for a second approver`,
    detail: parts.length > 0 ? parts.join(" · ") : null,
    count: d.total,
    href: "/approvals",
  };
}
