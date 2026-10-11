// The sentences for matching bank lines to payments, in one place: the Bank screen's Server Actions and the Giving commands
// (giving.match_deposit, giving.confirm_exact_zelle_matches) say the same things in the same words. Pure: no database, no Next.

import { formatCents } from "@/lib/money";

import type { ExactConfirmOutcome } from "./zelle";

const TOTAL_MISMATCH = /chosen payments total (-?\d+) but the deposit is (-?\d+)/;

/**
 * app.match_deposit refuses a deposit whose payments do not add up ("the chosen payments total 5000 but the deposit is 5100").
 * That, said for a person; null for any other error.
 */
export function depositTotalProblem(message: string | null | undefined, currency: string): string | null {
  const m = TOTAL_MISMATCH.exec(message ?? "");
  if (!m) return null;
  return `Could not match the deposit — the ticked payments total ${formatCents(Number(m[1]), currency)} but the deposit is ${formatCents(Number(m[2]), currency)}. They must add up exactly.`;
}

/** What to say when the deposit was matched. */
export function depositMatchedMessage(count: number): string {
  return `Deposit matched to ${count} recorded payment${count === 1 ? "" : "s"} and queued for QuickBooks as one deposit.`;
}

/**
 * What to say after "confirm the exact Zelle matches": how many were confirmed, how many were skipped because they were no longer
 * exact. `ok` is false when nothing at all was confirmed (the caller turns that into an error next to what was clicked).
 */
export function exactConfirmSummary(outcome: Pick<ExactConfirmOutcome, "confirmed" | "skipped">): { ok: boolean; message: string } {
  const n = outcome.confirmed.length;
  const s = outcome.skipped.length;
  const message =
    n === 0
      ? `Nothing was confirmed: ${s === 1 ? "the match is" : `all ${s} matches are`} no longer exact. Match ${s === 1 ? "it" : "them"} by hand.`
      : `Confirmed ${n} Zelle${n === 1 ? "" : "s"}${s > 0 ? `; ${s} skipped (no longer exact)` : ""}.`;
  return { ok: n > 0, message };
}
