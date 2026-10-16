// Month-end close (Giving › Books): which checks the system can prove, and the checklist that results. Pure: no React, no database.
// The loader (src/lib/data/books-close.ts) reads the counts; the close page, the lock action, the month_close_blockers command
// (Niva and Giving › Today) all read the checklist through it, so they always agree.
//
// What exists (accounting_periods.checklist, 0009) and what the data can prove (docs/GIVING_REDESIGN.md section 4, owner decision 2):
//   exceptions_cleared    automatic since 0009: no failed QuickBooks posting up to the month.
//   refunds_reviewed      proven when nothing waits: no refund request waiting for its second approver or to be recorded, and no
//                         Stripe or PayPal refund waiting for its two approvals. Otherwise a person marks it done.
//   payouts_matched       read from app.payouts_close_state (0747): proven when nothing is left unpaired on either side, every card
//                         payout that arrived in the month paired with its bank line (Explain and accept, Giving › Bank) and every
//                         bank card-payout line of the month paired with a payout. With Bank reconciliation off the state says null:
//                         then only a month with no card payouts is proven and the rest stays a person's check, showing both sides.
//   statements_generated  always a person's check: nothing records a pledge statement run.
// Beside the checks, up to two WARNING lines (closeWarnings): payment proofs still waiting to be verified and paid pledges not yet bank
// reconciled. A warning never blocks the lock and is not one of the four checks; it is hidden when its module is off or nothing waits.
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
  /**
   * The pairing of payouts and bank lines (app.payouts_close_state, 0747). `proven` is null when Bank reconciliation is off. Absent
   * (an older reader, a fixture): the payouts check falls back to the payouts marked matched.
   */
  pairing?: { proven: boolean | null; unpaired: number; bankUnpaired: number | null; explained: number } | null;
  /** The counts behind the warning lines. Absent (an older reader, a fixture): no warnings. */
  warnings?: CloseWarningCounts;
};

/**
 * What the warning lines count. null: the module is off or the reader cannot see it, so the line is not drawn; { ok: false }: the count
 * could not be read, which is said in words and never drawn as "nothing".
 */
export type CloseWarningCounts = {
  /** Payment proofs waiting for the treasury team or for a family's answer (payment_proof_counts: waiting + needs_info). */
  proofsWaiting: Seen<number> | null;
  /** Payments counted as paid that no bank line has banked (unbanked_counts total). */
  unbanked: Seen<number> | null;
};

export type CloseWarning = { key: "proofs_waiting" | "unbanked"; label: string; href: string };

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
  const sides = payoutSides(p, bank, f);
  return !bank || !bank.ok ? `${sides} Compare them with the bank's card payout lines, then mark this done.` : `${sides} Mark this done once each payout is matched.`;
}

/** "1 card payout arrived in October 2026, $1,200.50 net; the bank shows 1 card payout line, $1,200.00: a difference of $0.50." */
function payoutSides(p: { arrived: number; netCents: number }, bank: CloseProofs["bankPayouts"], f: CloseFormat): string {
  const money = (c: number) => formatCents(c, f.currency, f.locale);
  const provider = `${plural(p.arrived, "card payout")} arrived in ${f.monthLabel}, ${money(p.netCents)} net`;
  if (!bank || !bank.ok) return `${provider}.`;
  const diff = p.netCents - bank.value.cents;
  const gap = diff === 0 ? "the same total" : `a difference of ${money(Math.abs(diff))}`;
  return `${provider}; the bank shows ${plural(bank.value.lines, "card payout line")}, ${money(bank.value.cents)}: ${gap}.`;
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
      const pairing = proofs.pairing;
      if (pairing && p.ok && pairing.proven !== null) {
        if (pairing.proven) {
          const explained = pairing.explained > 0 ? ` (${plural(pairing.explained, "difference")} explained)` : "";
          const sub =
            p.value.arrived === 0 && (proofs.bankPayouts?.ok ? proofs.bankPayouts.value.lines : 0) === 0
              ? `${CHECKED}: no card payouts arrived in ${f.monthLabel}`
              : `${CHECKED}: all ${plural(p.value.arrived, "card payout")} are paired with their bank lines${explained}`;
          return { key: b.key, label: b.label, done: true, proven: true, manual: false, sub };
        }
        const left: string[] = [];
        if (pairing.unpaired > 0) left.push(`${plural(pairing.unpaired, "card payout")} not paired with a bank line`);
        if (pairing.bankUnpaired) left.push(`${plural(pairing.bankUnpaired, "bank card-payout line")} not paired with a payout`);
        const line = `${payoutSides(p.value, proofs.bankPayouts, f)} ${left.join("; ")}: pair them in Giving › Bank › Card payouts (Explain and accept), or mark this done.`;
        return { key: b.key, label: b.label, done: b.done, proven: false, manual: true, sub: marked(b.done, line) };
      }
      if (p.ok && p.value.arrived === 0) {
        return { key: b.key, label: b.label, done: true, proven: true, manual: false, sub: `${CHECKED}: no card payouts arrived in ${f.monthLabel}` };
      }
      if (!pairing && p.ok && p.value.matched >= p.value.arrived) {
        return { key: b.key, label: b.label, done: true, proven: true, manual: false, sub: `${CHECKED}: all ${plural(p.value.arrived, "card payout")} are matched to bank deposits` };
      }
      const line = p.ok ? payoutEvidence(p.value, proofs.bankPayouts, f) : p.why === "no_access" ? NO_ACCESS : "Could not read the card payouts";
      return { key: b.key, label: b.label, done: b.done, proven: false, manual: true, sub: marked(b.done, line) };
    }
    return { key: b.key, label: b.label, done: b.done, proven: false, manual: !automatic, sub: b.sub };
  });
}

/** The warning lines for the close, in the order they are drawn. They never count toward readyToLock. */
export function closeWarnings(counts: CloseWarningCounts | undefined): CloseWarning[] {
  const out: CloseWarning[] = [];
  const line = (key: CloseWarning["key"], seen: Seen<number> | null | undefined, label: string, failed: string, href: string) => {
    if (!seen) return;
    if (!seen.ok) {
      if (seen.why === "error") out.push({ key, label: failed, href });
      return;
    }
    if (seen.value > 0) out.push({ key, label: `${label}: ${seen.value.toLocaleString("en-US")}`, href });
  };
  line("proofs_waiting", counts?.proofsWaiting, "Payment confirmations still waiting to be reviewed", "Could not count the payment confirmations still waiting to be reviewed", "/giving/proofs");
  line("unbanked", counts?.unbanked, "Paid pledges not yet bank reconciled", "Could not count the paid pledges not yet bank reconciled", "/giving/payments/bank?view=unbanked");
  return out;
}

/** Every check done, proven or marked: the month can be locked. */
export function readyToLock(items: readonly CloseItem[]): boolean {
  return items.every((i) => i.done);
}
