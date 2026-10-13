// Month-end close (Giving › Books): which checks the system can prove, and the checklist that results. Pure: no React, no database.
// The loader (src/lib/data/books-close.ts) reads the counts; the close page, the lock action, the month_close_blockers command
// (Niva and Giving › Today) all read the checklist through it, so they always agree.
//
// What exists (accounting_periods.checklist, 0009) and what the data can prove (docs/GIVING_REDESIGN.md section 4, owner decision 2):
//   exceptions_cleared    automatic since 0009: no failed QuickBooks posting up to the month.
//   refunds_reviewed      proven when nothing waits: no refund request waiting for its second approver or to be recorded, and no
//                         Stripe or PayPal refund waiting for its two approvals. Otherwise a person marks it done.
//   payouts_matched       proven when no card payout arrived in the month, or every payout that arrived is marked matched. Nothing
//                         marks a payout matched yet, so with card payouts it stays a person's check; the line shows both sides.
//   statements_generated  always a person's check: nothing records a pledge statement run.
// A check ticks itself only when the reader can see what it rests on (RLS hides the rest): "could not check" is never "nothing".
// A proven check has no Undo; a check a person marked behaves as before. Locking needs every check done, proven or marked.

import { CLOSE_ITEMS, closeChecklist, type CloseItemKey } from "@/lib/giving";
import { formatCents } from "@/lib/money";

/** A count the reader could read, or why not. */
export type Seen<T> = { ok: true; value: T } | { ok: false; why: "no_access" | "error" };

export type CloseProofs = {
  /** Failed QuickBooks postings up to the month. */
  exceptions: Seen<number>;
  /** Refund requests on payments that still wait for the second approver or to be recorded. */
  refundRequests: Seen<number>;
  /** Refunds made in the Stripe or PayPal dashboard waiting for two approvals (null: could not be counted). */
  flaggedRefunds: number | null;
  /** Card-processor payouts that arrived in the month (provider side). */
  payouts: Seen<{ arrived: number; matched: number; netCents: number }>;
  /** The bank's card-payout lines posted in the month; null when bank reconciliation is not on or not open to the reader. */
  bankPayouts: Seen<{ lines: number; cents: number }> | null;
};

export type CloseItem = {
  key: CloseItemKey;
  label: string;
  done: boolean;
  /** Ticked by the system from the data: no Mark done, no Undo. */
  proven: boolean;
  /** A person marks this one (and may undo it). */
  manual: boolean;
  /** The line under the label: what was checked, or what is left. */
  sub: string;
};

export type CloseFormat = { monthLabel: string; currency: string; locale: string };

const CHECKED = "Checked by Weaver";
const NO_ACCESS = "Weaver could not check this with your access";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function marked(done: boolean, line: string): string {
  return done ? `Marked done · ${line}` : line;
}

function payoutEvidence(p: { arrived: number; netCents: number }, bank: CloseProofs["bankPayouts"], f: CloseFormat): string {
  const money = (c: number) => formatCents(c, f.currency, f.locale);
  const provider = `${plural(p.arrived, "card payout")} arrived in ${f.monthLabel}, ${money(p.netCents)} net`;
  if (!bank || !bank.ok) return `${provider}. Compare them with the bank's card payout lines, then mark this done.`;
  const b = bank.value;
  const diff = p.netCents - b.cents;
  const bankSide = `the bank shows ${plural(b.lines, "card payout line")}, ${money(b.cents)}`;
  const gap = diff === 0 ? "the same total" : `a difference of ${money(Math.abs(diff))}`;
  return `${provider}; ${bankSide}: ${gap}. Mark this done once each payout is matched.`;
}

function refundsWaiting(requests: number | null, flagged: number | null): string {
  const parts: string[] = [];
  if (requests) parts.push(`${plural(requests, "refund request")} ${requests === 1 ? "waits" : "wait"} for approval or recording`);
  if (flagged) parts.push(`${plural(flagged, "refund")} made in Stripe or PayPal ${flagged === 1 ? "waits" : "wait"} for two approvals`);
  return parts.length ? `${parts.join("; ")} (Giving › Payments)` : "";
}

/** The checklist for one month: the person's marks from accounting_periods.checklist, with the checks the data proves ticked. */
export function closeItems(checklist: unknown, proofs: CloseProofs, f: CloseFormat): CloseItem[] {
  const exceptions = proofs.exceptions.ok ? proofs.exceptions.value : null;
  const base = closeChecklist(checklist, exceptions, proofs.flaggedRefunds ?? 0);
  return base.map((b): CloseItem => {
    const automatic = CLOSE_ITEMS.find((i) => i.key === b.key)?.automatic === true;
    if (b.key === "exceptions_cleared") {
      if (!proofs.exceptions.ok && proofs.exceptions.why === "no_access") {
        return { key: b.key, label: b.label, done: false, proven: false, manual: false, sub: `${NO_ACCESS}: someone who can see QuickBooks postings checks it` };
      }
      return { key: b.key, label: b.label, done: b.done, proven: b.done, manual: false, sub: b.done ? `${CHECKED}: no QuickBooks posting failed` : b.sub };
    }
    if (b.key === "refunds_reviewed") {
      const r = proofs.refundRequests;
      if (r.ok && r.value === 0 && proofs.flaggedRefunds === 0) {
        return { key: b.key, label: b.label, done: true, proven: true, manual: false, sub: `${CHECKED}: no refund is waiting` };
      }
      const waiting = refundsWaiting(r.ok ? r.value : null, proofs.flaggedRefunds);
      const line =
        waiting || (r.ok ? "Could not count the Stripe or PayPal refunds waiting for approval" : r.why === "no_access" ? NO_ACCESS : "Could not count the refund requests");
      return { key: b.key, label: b.label, done: b.done, proven: false, manual: true, sub: marked(b.done, line) };
    }
    if (b.key === "payouts_matched") {
      const p = proofs.payouts;
      if (p.ok && p.value.arrived === 0) {
        return { key: b.key, label: b.label, done: true, proven: true, manual: false, sub: `${CHECKED}: no card payouts arrived in ${f.monthLabel}` };
      }
      if (p.ok && p.value.matched >= p.value.arrived) {
        return { key: b.key, label: b.label, done: true, proven: true, manual: false, sub: `${CHECKED}: all ${plural(p.value.arrived, "card payout")} are matched to bank deposits` };
      }
      const line = p.ok ? payoutEvidence(p.value, proofs.bankPayouts, f) : p.why === "no_access" ? NO_ACCESS : "Could not read the card payouts";
      return { key: b.key, label: b.label, done: b.done, proven: false, manual: true, sub: marked(b.done, line) };
    }
    return { key: b.key, label: b.label, done: b.done, proven: false, manual: !automatic, sub: b.sub };
  });
}

/** Every check done, proven or marked: the month can be locked. */
export function readyToLock(items: readonly CloseItem[]): boolean {
  return items.every((i) => i.done);
}
