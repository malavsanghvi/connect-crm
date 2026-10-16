// The OPEN BALANCE RULE (owner, 2026-10-15; docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 3.1). Pure: no database, no React.
//
//   Open balance = amount - paid - soft credit, summed over pledges that are Open or Partly paid.
//
// A pledge in Soft credit (fully covered by claims the treasury team has not verified yet), Paid or Bank reconciled adds nothing, and soft
// credit is reported as its own figure, never inside Open. `paid_cents` keeps its meaning (verified allocations only), so giving totals,
// statements and QuickBooks do not change. Bank reconciled is a pledge that is `paid` and has `reconciled_at` (a column, not a status).

/** A pledge's amounts as the database stores them. `soft_credit_cents` is optional so rows read before 0865 still work (it counts as 0). */
export type PledgeAmounts = { amount_cents: number; paid_cents: number; soft_credit_cents?: number | null };

/** The statuses that mean "still outstanding". `soft_credit` is deliberately not one of them (covered, but not yet verified). */
export const OPEN_PLEDGE_STATUSES = ["open", "partially_paid"] as const;

export function isOpenPledgeStatus(status: string): boolean {
  return status === "open" || status === "partially_paid";
}

const soft = (p: Pick<PledgeAmounts, "soft_credit_cents">): number => Math.max(0, p.soft_credit_cents ?? 0);

/**
 * What is still to pay on one pledge: amount - paid - soft credit, never below zero. This is the figure a payment can be applied to,
 * so it is also what the allocation preview uses. It does not look at the status; use `openBalanceCents` to add up an Open balance.
 */
export function stillToPayCents(p: PledgeAmounts): number {
  return Math.max(0, p.amount_cents - p.paid_cents - soft(p));
}

/** One pledge's part of the Open balance: its still-to-pay amount when it is Open or Partly paid, else nothing. */
export function openBalanceCents(p: PledgeAmounts & { status: string }): number {
  return isOpenPledgeStatus(p.status) ? stillToPayCents(p) : 0;
}

/**
 * The soft credit waiting on one pledge, as its own figure. A pledge in Soft credit shows what the waiting proofs cover (at most what is
 * not yet paid); an Open or Partly paid pledge shows the part a proof covers ("Soft credit $X waiting"); every other status shows none.
 */
export function softCreditWaitingCents(p: PledgeAmounts & { status: string }): number {
  if (p.status !== "soft_credit" && !isOpenPledgeStatus(p.status)) return 0;
  return Math.min(soft(p), Math.max(0, p.amount_cents - p.paid_cents));
}

/** Bank reconciled: fully paid, and every payment on it is matched to the bank (`reconciled_at`, kept by the database). */
export function isBankReconciled(p: { status: string; reconciled_at?: string | null }): boolean {
  return p.status === "paid" && !!p.reconciled_at;
}

export type PledgeStanding = "open" | "part_paid" | "soft_credit" | "paid" | "bank_reconciled" | "written_off" | "cancelled";

/** The word the screens show, from the status and `reconciled_at`. An unknown status is shown as Open (the safe, quiet default). */
export function pledgeStanding(p: { status: string; reconciled_at?: string | null }): PledgeStanding {
  if (p.status === "paid") return isBankReconciled(p) ? "bank_reconciled" : "paid";
  if (p.status === "soft_credit" || p.status === "written_off" || p.status === "cancelled") return p.status;
  return p.status === "partially_paid" ? "part_paid" : "open";
}

export const PLEDGE_STANDING_LABEL: Record<PledgeStanding, string> = {
  open: "Open",
  part_paid: "Partly paid",
  soft_credit: "Soft credit",
  paid: "Paid",
  bank_reconciled: "Bank reconciled",
  written_off: "Written off",
  cancelled: "Cancelled",
};

export type PledgeTotals = {
  /** Open balance: amount - paid - soft credit over Open and Partly paid pledges. */
  openCents: number;
  openCount: number;
  /** Soft credit waiting to be verified, over every pledge that has some. */
  softCreditCents: number;
  softCreditCount: number;
  /** Bank reconciled pledges and what they were for. */
  reconciledCents: number;
  reconciledCount: number;
};

/** The four household tiles' pledge figures in one pass. */
export function totalPledges(rows: readonly (PledgeAmounts & { status: string; reconciled_at?: string | null })[]): PledgeTotals {
  const t: PledgeTotals = { openCents: 0, openCount: 0, softCreditCents: 0, softCreditCount: 0, reconciledCents: 0, reconciledCount: 0 };
  for (const p of rows) {
    const open = openBalanceCents(p);
    if (isOpenPledgeStatus(p.status) && open > 0) {
      t.openCents += open;
      t.openCount += 1;
    }
    const s = softCreditWaitingCents(p);
    if (s > 0) {
      t.softCreditCents += s;
      t.softCreditCount += 1;
    }
    if (isBankReconciled(p)) {
      t.reconciledCents += p.amount_cents;
      t.reconciledCount += 1;
    }
  }
  return t;
}
