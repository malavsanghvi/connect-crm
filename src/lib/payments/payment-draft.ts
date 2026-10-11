// "Record a payment", prepared but not recorded: what a payment would close, the questions a person should answer first, and the
// check list a reviewer would want. Pure (no database, no Next imports) so it is cheap to test; giving.draft_payment (and later
// the confirm-level giving.record_payment) read the data and call these.
//
// The allocation rule is the one the system applies (src/lib/allocation.ts mirrors app.allocate_payment): earliest open pledge
// first, an overpayment rolls to the next pledge, a partial payment leaves the pledge open, and whatever cannot be placed stays
// on the payment unapplied as a general gift (docs/DECISIONS.md "Payment allocation", "Allocation transparency"). Partial
// payments and overpayments are shown as QUESTIONS, never decided for the person.

import { daysBetween } from "@/lib/dates";
import { monthYear } from "@/lib/giving";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { previewAllocation, openCents, type AllocatablePledge } from "@/lib/allocation";

import type { AllocationMode } from "./offline-payment";

/** Pledges that are not gifts: the plan (docs/PAYMENT_ALLOCATION_PLAN.md D3) keeps the default order away from them. */
export const NON_GIFT_SOURCES: readonly string[] = ["pathshala_fee", "boli", "labh", "store"];

const SOURCE_LABEL: Record<string, string> = {
  pathshala_fee: "Pathshala fee",
  boli: "Boli pledge",
  labh: "Labh pledge",
  store: "Store order",
  membership_fee: "Membership fee",
  general: "General pledge",
  rsvp_commitment: "Event commitment",
  sponsorship: "Sponsorship",
  pujan: "Pujan",
  construction: "Construction pledge",
  recurring: "Recurring gift pledge",
  other: "Pledge",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? "Pledge";
}

export type DraftPledge = AllocatablePledge & {
  pledge_number: string | null;
  source: string;
  due_on: string | null;
  fund: string | null;
  campaign: string | null;
};

export type DraftLine = {
  pledge_id: string;
  pledge_number: string | null;
  /** "Paryushan 2026" (the campaign) or the kind of pledge. */
  name: string;
  fund: string | null;
  due_on: string | null;
  applied_cents: number;
  applied: string;
  open_before_cents: number;
  open_before: string;
  open_after_cents: number;
  open_after: string;
  closes: boolean;
};

export type QuestionKind = "partial" | "overpayment" | "no_open_pledge" | "not_a_gift" | "named_not_open" | "cannot_apply";

export type AllocationQuestion = { kind: QuestionKind; question: string };

export type DraftPlan = {
  mode: AllocationMode;
  lines: DraftLine[];
  applied_cents: number;
  applied: string;
  unallocated_cents: number;
  unallocated: string;
  open_pledge_count: number;
  questions: AllocationQuestion[];
  /** Plain sentences: what the household's pledges look like after this payment. */
  after: string[];
};

function pledgeName(p: Pick<DraftPledge, "campaign" | "source" | "pledge_number">): string {
  return p.campaign ?? sourceLabel(p.source);
}

function pledgeRef(p: Pick<DraftPledge, "campaign" | "source" | "pledge_number">): string {
  const name = pledgeName(p);
  return p.pledge_number ? `${name} (${p.pledge_number})` : name;
}

/**
 * What the payment would close. `canAllocate` is false for a person who may record payments but not apply them (only
 * giving.manage applies): the payment would be saved and left unapplied, and the plan says so instead of showing an
 * application that will not happen.
 */
export function planDraftAllocation(input: {
  amountCents: number;
  pledges: readonly DraftPledge[];
  mode: AllocationMode;
  chosen: readonly string[] | null;
  canAllocate: boolean;
  currency: string;
}): DraftPlan {
  const { amountCents, pledges, mode, chosen, canAllocate, currency } = input;
  const money = (c: number) => formatCents(c, currency);
  const eligible = pledges.filter((p) => (p.status === "open" || p.status === "partially_paid") && openCents(p) > 0);
  const byId = new Map(pledges.map((p) => [p.id, p]));
  const questions: AllocationQuestion[] = [];
  const empty = (): DraftPlan => ({
    mode,
    lines: [],
    applied_cents: 0,
    applied: money(0),
    unallocated_cents: amountCents,
    unallocated: money(amountCents),
    open_pledge_count: eligible.length,
    questions,
    after: [`${money(amountCents)} would be recorded as a general gift and not applied to any pledge.`],
  });

  if (mode === "none") return empty();
  if (!canAllocate) {
    questions.push({
      kind: "cannot_apply",
      question: `You can record this payment but not apply it to pledges (that needs the giving.manage permission). It would stay unapplied as a general gift until a treasurer applies it. Is that all right?`,
    });
    return empty();
  }

  if (mode === "choose" && chosen) {
    const eligibleIds = new Set(eligible.map((p) => p.id));
    const missing = chosen.filter((id) => !eligibleIds.has(id));
    if (missing.length > 0) {
      const names = missing.map((id) => {
        const p = byId.get(id);
        return p ? `${pledgeRef(p)} (${(p.status ?? "closed").replace(/_/g, " ")})` : "a pledge that is not this household's";
      });
      questions.push({
        kind: "named_not_open",
        question: `These cannot take a payment, so they were left out: ${names.join("; ")}. Pick from the household's open pledges instead?`,
      });
    }
  }

  if (eligible.length === 0) {
    questions.push({
      kind: "no_open_pledge",
      question: `This household has no open pledge, so the whole ${money(amountCents)} would be recorded as a general gift. Is this the right household?`,
    });
    return empty();
  }

  const plan = previewAllocation(amountCents, [...eligible], mode === "choose" ? chosen : null);
  const lines: DraftLine[] = plan.lines.map((l) => {
    const p = byId.get(l.pledge_id)!;
    return {
      pledge_id: l.pledge_id,
      pledge_number: p.pledge_number,
      name: pledgeName(p),
      fund: p.fund,
      due_on: p.due_on,
      applied_cents: l.amount_cents,
      applied: money(l.amount_cents),
      open_before_cents: l.open_before_cents,
      open_before: money(l.open_before_cents),
      open_after_cents: l.open_after_cents,
      open_after: money(l.open_after_cents),
      closes: l.closes,
    };
  });

  const after: string[] = [];
  for (const l of plan.lines) {
    const p = byId.get(l.pledge_id)!;
    const ref = pledgeRef(p);
    if (l.closes) {
      after.push(`${ref} would be paid in full (${money(p.amount_cents)} of ${money(p.amount_cents)}).`);
    } else {
      after.push(`${ref} would be ${money(p.paid_cents + l.amount_cents)} paid of ${money(p.amount_cents)}, with ${money(l.open_after_cents)} still open.`);
      questions.push({
        kind: "partial",
        question: `This pays ${money(l.amount_cents)} of the ${money(l.open_before_cents)} still open on ${ref}. The pledge would stay open with ${money(l.open_after_cents)} left. Is that what the donor meant?`,
      });
    }
  }
  if (plan.unallocated_cents > 0) {
    const inScope = mode === "choose" && chosen ? eligible.filter((p) => chosen.includes(p.id)) : eligible;
    const open = inScope.reduce((sum, p) => sum + openCents(p), 0);
    const scope = mode === "choose" ? "the pledges you named" : "all of the household's open pledges";
    after.push(`${money(plan.unallocated_cents)} would stay on the payment as a general gift, not applied to any pledge.`);
    questions.push({
      kind: "overpayment",
      question: `This is ${money(plan.unallocated_cents)} more than ${scope} need (${money(open)} open). The extra ${money(plan.unallocated_cents)} would stay on the payment as a general gift, not applied to any pledge. Is that what the donor wants?`,
    });
  }
  if (mode === "auto") {
    const nonGift = plan.lines.map((l) => byId.get(l.pledge_id)!).filter((p) => NON_GIFT_SOURCES.includes(p.source));
    if (nonGift.length > 0) {
      questions.push({
        kind: "not_a_gift",
        question: `Paying oldest first would also pay ${nonGift.map(pledgeRef).join(" and ")}, which ${nonGift.length === 1 ? "is not a gift pledge" : "are not gift pledges"}. Should it go to a gift pledge instead? (Choose the pledges to decide.)`,
      });
    }
  }
  return {
    mode,
    lines,
    applied_cents: plan.allocated_cents,
    applied: money(plan.allocated_cents),
    unallocated_cents: plan.unallocated_cents,
    unallocated: money(plan.unallocated_cents),
    open_pledge_count: eligible.length,
    questions,
    after,
  };
}

// ---------------------------------------------------------------------------
// The check list a reviewer would want
// ---------------------------------------------------------------------------
export type CheckStatus = "ok" | "look" | "unknown";

export type PaymentCheckItem = {
  key: "household" | "amount" | "date" | "month" | "duplicates" | "allocation" | "second_person";
  label: string;
  status: CheckStatus;
  detail: string;
};

export type DraftDuplicate = {
  payment_id: string;
  receipt_number: string | null;
  received_on: string;
  amount_cents: number;
  method: string;
  check_number: string | null;
  same_check_number: boolean;
};

/** Payments dated more than this many days ago are pointed out (the same window members have to report a Zelle). */
export const OLD_PAYMENT_DAYS = 60;

export function buildPaymentChecks(input: {
  currency: string;
  amountCents: number;
  method: string;
  checkNumber: string | null;
  receivedOn: string;
  today: string;
  /** null when the month-end close cannot be read by this person. */
  monthClosed: boolean | null;
  duplicates: readonly DraftDuplicate[];
  checkNumberElsewhere: number;
  /** A sentence about a Zelle that may already be recorded or reported (app.possible_duplicate_zelle), when one is. */
  zelleNote?: string | null;
  plan: DraftPlan;
  household: { number: string | null; city: string | null; adults: readonly string[] };
}): PaymentCheckItem[] {
  const { currency, plan } = input;
  const money = (c: number) => formatCents(c, currency);
  const out: PaymentCheckItem[] = [];

  const who = [input.household.number ? `household ${input.household.number}` : null, input.household.city, input.household.adults.length > 0 ? input.household.adults.join(" and ") : null]
    .filter(Boolean)
    .join(" · ");
  out.push({
    key: "household",
    label: "The right household",
    status: "ok",
    detail: `Chosen by its card, not by name: ${who || "no details on file"}. Confirm it is the family that gave.`,
  });

  const methodLabel = PAYMENT_METHOD_LABEL[input.method] ?? input.method;
  const missingCheck = input.method === "check" && !input.checkNumber;
  out.push({
    key: "amount",
    label: "Amount and method",
    status: missingCheck ? "look" : "ok",
    detail: missingCheck
      ? `${money(input.amountCents)} by ${methodLabel}. No check number was given; one makes the check easy to find later.`
      : `${money(input.amountCents)} by ${methodLabel}${input.checkNumber ? `, check ${input.checkNumber}` : ""}.`,
  });

  const age = daysBetween(input.receivedOn, input.today);
  out.push({
    key: "date",
    label: "Date received",
    status: age > OLD_PAYMENT_DAYS ? "look" : "ok",
    detail:
      age > OLD_PAYMENT_DAYS
        ? `Dated ${age} days ago (${input.receivedOn}). Is that the day it arrived?`
        : age === 0
          ? "Received today."
          : `Received ${age} day${age === 1 ? "" : "s"} ago (${input.receivedOn}).`,
  });

  const month = monthYear(input.receivedOn, "UTC");
  out.push({
    key: "month",
    label: "Month not locked",
    status: input.monthClosed === null ? "unknown" : input.monthClosed ? "look" : "ok",
    detail:
      input.monthClosed === null
        ? "Could not check whether the month is locked: that needs access to month-end close."
        : input.monthClosed
          ? `${month} is locked in Weaver. The payment can still be recorded, but QuickBooks cannot post it until the month is reopened.`
          : `${month} is open.`,
  });

  const dupLines = input.duplicates.map(
    (d) =>
      `${d.receipt_number ?? "A payment"} on ${d.received_on} for ${money(d.amount_cents)}${d.same_check_number ? ` (check ${d.check_number})` : ""} may be the same payment`,
  );
  if (input.checkNumberElsewhere > 0) {
    dupLines.push(`check ${input.checkNumber} is already on ${input.checkNumberElsewhere} payment${input.checkNumberElsewhere === 1 ? "" : "s"} of other households (check numbers repeat between banks, so confirm it is a different check)`);
  }
  if (input.zelleNote) dupLines.push(input.zelleNote.replace(/\.$/, ""));
  out.push({
    key: "duplicates",
    label: "Not recorded twice",
    status: dupLines.length > 0 ? "look" : "ok",
    detail: dupLines.length > 0 ? `${dupLines.join("; ")}.` : "No payment of this household has the same amount within three days, and no payment has this check number.",
  });

  out.push({
    key: "allocation",
    label: "Applied the way the donor meant",
    status: plan.questions.length > 0 ? "look" : "ok",
    detail:
      plan.questions.length > 0
        ? `${plan.questions.length} question${plan.questions.length === 1 ? "" : "s"} to answer first (listed above).`
        : plan.lines.length > 0
          ? `Applies to ${plan.lines.length} pledge${plan.lines.length === 1 ? "" : "s"}, oldest first, with nothing left over.`
          : "Not applied to any pledge, as chosen.",
  });

  out.push({
    key: "second_person",
    label: "Who has to agree",
    status: "ok",
    detail: "Recording a payment takes one person. A refund or write-off of it later takes two: one asks, a different person approves.",
  });
  return out;
}
