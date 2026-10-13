// The Record payment sheet's words and starting values (docs/GIVING_REDESIGN.md sections 4 and 5). Pure: the sheet, the box's
// Giving lane, the dev preview and the tests use the same sentences. Money is integer cents in the community's currency; a family is
// always named with its number ("the Patel household 0127"), never by a name alone, and nothing here names a child.

import type { CardLabels } from "@/components/household-card";
import { previewAllocation } from "@/lib/allocation";
import type { Family } from "@/lib/giving-today/queue";
import { listWords, type OfflineMethodKey } from "@/lib/giving-workspace/ask";
import { OFFLINE_METHODS } from "@/lib/labels";
import { formatCents, parseAmountToCents } from "@/lib/money";
import type { AllocationMode } from "@/lib/payments/offline-payment";

/** What the box (or a button) already knows. The person checks every field before pressing the button. */
export type RecordSheetPrefill = {
  /** Plain digits with a dot for the decimals ("200", "1250.50"); the sheet shows it for checking. */
  amount?: string | null;
  method?: OfflineMethodKey | null;
  /** YYYY-MM-DD */
  receivedOn?: string | null;
  reference?: string | null;
  /** What the person said it was for ("the building fund"): shown, never used to pick a pledge. */
  about?: string | null;
};

/**
 * How the sheet is opened. With `household` its card is shown at once; with `householdId` alone (a Family page button) the sheet
 * reads the card itself; with `candidates` (two or more families matched what was typed) it shows their cards to choose from. With
 * none of them it opens on the household search. A family is never chosen by name alone.
 */
export type RecordPaymentRequest = {
  household?: Family | null;
  householdId?: string | null;
  candidates?: Family[];
  prefill?: RecordSheetPrefill;
};

/** What every Giving sheet needs from the signed-in person and the community, worked out on the server once per page. */
export type GivingSheetContext = {
  currency: string;
  locale: string;
  timeZone: string;
  /** Today in the community's time zone (YYYY-MM-DD). */
  today: string;
  labels: CardLabels;
  /** giving.record_offline or giving.manage. */
  canRecord: boolean;
  /** giving.manage: the payment is applied to pledges when it is recorded. */
  canAllocate: boolean;
  /** Bank reconciliation is on (Zelle and ACH usually arrive through it). */
  bankOn: boolean;
  /** The person may open the Family page (People). */
  canOpenFamily: boolean;
};

export type SheetPledge = { id: string; pledge_number: string | null; amount_cents: number; paid_cents: number; pledged_at: string; status?: string };

const TRAILING_WORD = /\s(?:household|family|home|residence)$/i;

/** "the Patel household 0127": the family's name with its number, for a button. A name that already ends in "household" keeps it. */
export function householdRef(f: Pick<Family, "name" | "number">): string {
  const name = f.name.trim() || "Unnamed household";
  const base = TRAILING_WORD.test(name) ? name : `${name} household`;
  return `the ${base}${f.number ? ` ${f.number}` : ""}`;
}

const METHOD_WORD: Record<OfflineMethodKey, string> = { check: "check", cash: "cash", ach: "ACH payment", zelle: "Zelle payment", stock: "stock gift" };

export function isOfflineMethod(v: unknown): v is OfflineMethodKey {
  return typeof v === "string" && (OFFLINE_METHODS as readonly string[]).includes(v);
}

/** "check", "cash", "Zelle payment": the method in a sentence. */
export function methodWord(method: string): string {
  return isOfflineMethod(method) ? METHOD_WORD[method] : "payment";
}

/** The button: it names the amount, the method and the family ("Record $200.00 check for the Patel household 0127"). */
export function recordButtonLabel(i: { amount: string; method: string; family: Family | null; currency: string; locale?: string }): string {
  if (!i.family) return "Choose the family first";
  const cents = parseAmountToCents(i.amount);
  if (!cents || cents <= 0) return "Enter the amount";
  return `Record ${formatCents(cents, i.currency, i.locale)} ${methodWord(i.method)} for ${householdRef(i.family)}`;
}

/**
 * What happens, said before the click (section 5.3): which pledges close, what is paid toward which, and what stays open. Someone
 * who may not apply payments is told it is recorded but not applied, and that a treasurer can apply it.
 */
export function whatHappens(i: {
  amountCents: number | null;
  pledges: readonly SheetPledge[] | null;
  mode: AllocationMode;
  chosen: readonly string[];
  canAllocate: boolean;
  currency: string;
  locale?: string;
}): string {
  const money = (c: number) => formatCents(c, i.currency, i.locale);
  if (!i.canAllocate) return "Recorded but not applied: a treasurer can apply it to the family's pledges.";
  if (i.mode === "none") return "Recorded as a general gift, not applied to any pledge.";
  if (i.pledges === null) return "Reading the family's open pledges…";
  const open = i.pledges.reduce((s, p) => s + Math.max(0, p.amount_cents - p.paid_cents), 0);
  const count = i.pledges.length;
  if (!i.amountCents || i.amountCents <= 0) {
    return count === 0
      ? "The family has no open pledge: the payment is recorded as a general gift."
      : `The family has ${count} open pledge${count === 1 ? "" : "s"}, ${money(open)} open in all. Enter the amount to see which it closes.`;
  }
  if (count === 0) return `No open pledge: the full ${money(i.amountCents)} is recorded as a general gift.`;
  const plan = previewAllocation(i.amountCents, [...i.pledges], i.mode === "choose" ? i.chosen : null);
  const numberOf = new Map(i.pledges.map((p) => [p.id, p.pledge_number ?? "a pledge"]));
  const closed = plan.lines.filter((l) => l.closes).map((l) => numberOf.get(l.pledge_id) ?? "a pledge");
  const partial = plan.lines.filter((l) => !l.closes);
  const parts: string[] = [];
  if (closed.length > 0) parts.push(`closes ${listWords(closed)}`);
  for (const l of partial) parts.push(`pays ${money(l.amount_cents)} toward ${numberOf.get(l.pledge_id) ?? "a pledge"}`);
  const left = open - plan.allocated_cents;
  parts.push(left > 0 ? `leaves ${money(left)} open` : "leaves nothing open");
  const said = listWords(parts);
  const sentence = `${said[0].toUpperCase()}${said.slice(1)}.`;
  return plan.unallocated_cents > 0 ? `${sentence} ${money(plan.unallocated_cents)} stays unapplied as a general gift.` : sentence;
}

export type RecordedPayment = {
  receiptNumber: string | null;
  amountCents: number;
  applied: { pledge_number: string | null; amount_cents: number; closed: boolean }[];
  unallocatedCents: number;
};

/** The button after the server said so: "Recorded as R-2026-0413". */
export function recordedLabel(r: Pick<RecordedPayment, "receiptNumber">): string {
  return r.receiptNumber ? `Recorded as ${r.receiptNumber}` : "Recorded (receipt number pending)";
}

/** What the recorded payment did, in one or two sentences. */
export function recordedLines(r: RecordedPayment, currency: string, locale?: string): string[] {
  const money = (c: number) => formatCents(c, currency, locale);
  const out: string[] = [];
  if (r.applied.length > 0) {
    const what = r.applied.map((a) => `${a.pledge_number ?? "a pledge"} (${money(a.amount_cents)}, ${a.closed ? "closed" : "stays open"})`);
    out.push(`Applied to ${listWords(what)}.`);
  }
  if (r.unallocatedCents > 0) out.push(`${money(r.unallocatedCents)} stays unapplied as a general gift.`);
  return out;
}

export type SheetStart = { amount: string; method: OfflineMethodKey; receivedOn: string; reference: string; mode: AllocationMode };

/** The fields the sheet opens with: what the box read, else check, today and nothing else. A date in the future is not taken. */
export function sheetStart(prefill: RecordSheetPrefill | null | undefined, today: string, canAllocate: boolean): SheetStart {
  const p = prefill ?? {};
  const amountCents = p.amount ? parseAmountToCents(p.amount) : null;
  const date = p.receivedOn && /^\d{4}-\d{2}-\d{2}$/.test(p.receivedOn) && p.receivedOn <= today ? p.receivedOn : today;
  return {
    amount: amountCents && amountCents > 0 ? (p.amount ?? "") : "",
    method: isOfflineMethod(p.method) ? p.method : "check",
    receivedOn: date,
    reference: (p.reference ?? "").slice(0, 200),
    mode: canAllocate ? "auto" : "none",
  };
}
