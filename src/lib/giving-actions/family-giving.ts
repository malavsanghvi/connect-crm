// One family's giving, as the slide-over in Giving shows it (docs/GIVING_REDESIGN.md section 4: "a slide-over for a family's
// giving"): what the family owes, its open pledges and its last gifts, with the household card at the top. Pure: the server action
// reads the rows under the person's own access and hands them here. A child is never named: only the household and its adults.

import { formatDate } from "@/lib/dates";
import type { Family } from "@/lib/giving-today/queue";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { softCreditWaitingCents, stillToPayCents } from "@/lib/pledge-balance";

/** The family with its household card line ("No. 0127 · RCC-H-1102 · Asha & Ravi Patel · Riverside"): never a name alone. */
export type GivingHousehold = Family & { cardLine: string };

/** The payment or pledge the box found, shown first and marked. */
export type FamilyFocus = { kind: "payment" | "pledge"; id: string };

export type FamilyPledge = {
  id: string;
  number: string | null;
  campaign: string | null;
  amountCents: number;
  paidCents: number;
  /** Still to pay: amount - paid - soft credit (the Open balance rule). */
  openCents: number;
  /** Soft credit waiting to be verified on this pledge, shown beside the open figure and never inside it. */
  softCreditCents: number;
  pledgedAt: string;
  dueOn: string | null;
  status: string;
};

export type FamilyPayment = {
  id: string;
  receipt: string | null;
  amountCents: number;
  refundedCents: number;
  method: string;
  status: string;
  receivedOn: string | null;
};

export type FamilyGiving = {
  household: GivingHousehold;
  owesCents: number;
  pledges: FamilyPledge[];
  payments: FamilyPayment[];
  focus: FamilyFocus | null;
  /** Parts that could not be read, in plain words; the rest is still shown. */
  problems: string[];
};

/** How many gifts the slide-over lists (the found one is added when it is older). */
export const LAST_GIFTS = 5;

const OPEN = new Set(["open", "partially_paid"]);

export type PledgeRowIn = { id: string; pledge_number: string | null; campaign: string | null; amount_cents: number; paid_cents: number; soft_credit_cents?: number | null; pledged_at: string; due_on: string | null; status: string };
export type PaymentRowIn = { id: string; receipt_number: string | null; amount_cents: number; refunded_cents: number | null; method: string; status: string; received_on: string | null };

function toPledge(p: PledgeRowIn): FamilyPledge {
  return {
    id: p.id,
    number: p.pledge_number,
    campaign: p.campaign,
    amountCents: p.amount_cents,
    paidCents: p.paid_cents,
    openCents: stillToPayCents(p),
    softCreditCents: softCreditWaitingCents(p),
    pledgedAt: p.pledged_at,
    dueOn: p.due_on,
    status: p.status,
  };
}

function toPayment(p: PaymentRowIn): FamilyPayment {
  return { id: p.id, receipt: p.receipt_number, amountCents: p.amount_cents, refundedCents: p.refunded_cents ?? 0, method: p.method, status: p.status, receivedOn: p.received_on };
}

/**
 * Put one family's giving together. Open pledges oldest first (the order a payment is applied in), the last gifts newest first, and
 * the found payment or pledge first of its list even when it is older or closed.
 */
export function composeFamilyGiving(i: {
  household: GivingHousehold;
  pledges: readonly PledgeRowIn[];
  payments: readonly PaymentRowIn[];
  focus: FamilyFocus | null;
  focusPledge?: PledgeRowIn | null;
  focusPayment?: PaymentRowIn | null;
  problems?: string[];
}): FamilyGiving {
  const open = i.pledges.filter((p) => OPEN.has(p.status)).map(toPledge);
  open.sort((a, b) => a.pledgedAt.localeCompare(b.pledgedAt) || a.id.localeCompare(b.id));
  const owesCents = open.reduce((s, p) => s + p.openCents, 0);
  let pledges = open;
  if (i.focus?.kind === "pledge") {
    const found = open.find((p) => p.id === i.focus?.id) ?? (i.focusPledge ? toPledge(i.focusPledge) : null);
    if (found) pledges = [found, ...open.filter((p) => p.id !== found.id)];
  }
  const recent = [...i.payments]
    .map(toPayment)
    .sort((a, b) => (b.receivedOn ?? "").localeCompare(a.receivedOn ?? "") || (b.receipt ?? "").localeCompare(a.receipt ?? ""));
  let payments = recent.slice(0, LAST_GIFTS);
  if (i.focus?.kind === "payment") {
    const found = recent.find((p) => p.id === i.focus?.id) ?? (i.focusPayment ? toPayment(i.focusPayment) : null);
    if (found) payments = [found, ...payments.filter((p) => p.id !== found.id)].slice(0, LAST_GIFTS + 1);
  }
  const focusFound = i.focus ? (i.focus.kind === "payment" ? payments : pledges).some((x) => x.id === i.focus?.id) : false;
  return { household: i.household, owesCents, pledges, payments, focus: focusFound ? i.focus : null, problems: i.problems ?? [] };
}

const STATUS_WORD: Record<string, string> = {
  captured: "Received",
  pending_clearing: "Clearing",
  settled: "Settled",
  partially_refunded: "Partly refunded",
  refunded: "Refunded",
  failed: "Failed",
  pending: "Pending",
  open: "Open",
  partially_paid: "Partly paid",
  soft_credit: "Soft credit",
  paid: "Paid",
  written_off: "Written off",
  cancelled: "Cancelled",
};

/** A payment or pledge status in words ("Partly refunded"). */
export function statusWord(status: string): string {
  return STATUS_WORD[status] ?? (status ? status[0].toUpperCase() + status.slice(1).replace(/_/g, " ") : "");
}

/** "R-2026-0388 · $200.00 Check": a payment's first line. */
export function paymentTitle(p: Pick<FamilyPayment, "receipt" | "amountCents" | "method">, currency: string, locale?: string): string {
  return `${p.receipt ?? "No receipt number"} · ${formatCents(p.amountCents, currency, locale)} ${PAYMENT_METHOD_LABEL[p.method] ?? p.method}`;
}

/** "3 Oct 2026 · Received" (and what was refunded). */
export function paymentDetail(p: Pick<FamilyPayment, "receivedOn" | "status" | "refundedCents">, currency: string, timeZone: string, locale?: string): string {
  const parts = [p.receivedOn ? formatDate(p.receivedOn, timeZone) : "No date", statusWord(p.status)];
  if (p.refundedCents > 0) parts.push(`${formatCents(p.refundedCents, currency, locale)} refunded`);
  return parts.join(" · ");
}

/** "PL-20455 · Building fund": a pledge's first line. */
export function pledgeTitle(p: Pick<FamilyPledge, "number" | "campaign">): string {
  return `${p.number ?? "Pledge"} · ${p.campaign ?? "General"}`;
}

/** "$500.00 pledged · $120.00 open · Partly paid". */
export function pledgeDetail(p: Pick<FamilyPledge, "amountCents" | "openCents" | "status"> & { softCreditCents?: number }, currency: string, locale?: string): string {
  const soft = p.softCreditCents && p.softCreditCents > 0 ? ` · ${formatCents(p.softCreditCents, currency, locale)} soft credit waiting` : "";
  return `${formatCents(p.amountCents, currency, locale)} pledged · ${formatCents(p.openCents, currency, locale)} open · ${statusWord(p.status)}${soft}`;
}

/** "Owes $120.00 on 2 open pledges", or that nothing is owed. */
export function owesLine(g: Pick<FamilyGiving, "owesCents" | "pledges">, currency: string, locale?: string): string {
  const open = g.pledges.filter((p) => p.openCents > 0).length;
  if (g.owesCents <= 0 || open === 0) return "Owes nothing: no open pledge.";
  return `Owes ${formatCents(g.owesCents, currency, locale)} on ${open} open pledge${open === 1 ? "" : "s"}.`;
}
