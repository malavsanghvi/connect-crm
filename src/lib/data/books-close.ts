// Month-end close, read once for everyone who shows or acts on it: the close page (Giving › Books), the lock action and the
// accounting.month_close_blockers command (Niva and Giving › Today). The counts behind each check are read with the person's
// own database access; a count the person cannot see is "could not check", never zero (src/lib/books/close.ts).

import { closeItems, closeWarnings, type CloseItem, type CloseProofs, type CloseWarning, type CloseWarningCounts, type Seen } from "@/lib/books/close";
import { communityFormat } from "@/lib/community-format";
import { longMonth } from "@/lib/giving";
import { isModuleEnabled } from "@/lib/modules";
import { can, canAccess } from "@/lib/permissions";
import { parseProofCounts, parseUnbankedCounts } from "@/lib/payment-proofs/counts";
import type { CrmSession } from "@/lib/session";

type DbError = { code?: string; message: string } | null;

export type ClosePeriod = { status: string; checklist: unknown; closed_by: string | null; closed_at: string | null } | null;

export type CloseState = {
  month: string;
  label: string;
  /** null when the period itself could not be read (the screen says so; nothing may be marked or locked). */
  periodError: DbError;
  period: ClosePeriod;
  locked: boolean;
  items: CloseItem[];
  /** Reminders beside the checklist (payment proofs waiting, paid pledges not on the bank). They never block the lock. */
  warnings: CloseWarning[];
};

function seen<T>(res: { error: DbError }, value: () => T, what: string): Seen<T> {
  if (res.error) {
    console.error(`[books-close] ${what} could not be read; the check is not ticked:`, res.error);
    return { ok: false, why: "error" };
  }
  return { ok: true, value: value() };
}

const NO_ACCESS = { ok: false, why: "no_access" } as const;

/** What the data proves for one month (first day of the month, YYYY-MM-01). */
export async function loadCloseProofs(session: CrmSession, month: string): Promise<CloseProofs> {
  const { db, center } = session;
  // QuickBooks postings and card payouts are readable with giving.view or accounting.manage (0010); payments with giving staff access.
  const seesLedger = canAccess(session, "qboLedger");
  const seesPayments = canAccess(session, "paymentsAll");
  // Card payouts and their bank lines: one read of app.payouts_close_state (0747), which counts both sides and says whether the
  // month is proven (null when Bank reconciliation is off). Giving staff and whoever closes the month may read it.
  const seesPayouts = can(session, ["giving.view", "giving.manage", "accounting.close", "accounting.manage"]) && isModuleEnabled(session, "accounting");

  const [exceptions, flagged, requests, payoutState, warnings] = await Promise.all([
    seesLedger
      ? db.from("ledger_postings").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "failed").lte("period_month", month)
      : null,
    db.rpc("flagged_refund_count", { p_center: center.id }),
    seesPayments
      ? db
          .from("payments")
          .select("id", { count: "exact", head: true })
          .eq("center_id", center.id)
          .not("refund_approved_by", "is", null)
          .eq("refunded_cents", 0)
      : null,
    seesPayouts ? db.rpc("payouts_close_state", { p_center: center.id, p_month: month }) : null,
    loadWarningCounts(session),
  ]);
  if (flagged.error) console.error("[books-close] flagged refund count failed; the refunds check is not ticked:", flagged.error);
  const flaggedCount = !flagged.error && typeof flagged.data === "number" ? flagged.data : null;
  return {
    exceptions: exceptions ? seen(exceptions, () => exceptions.count ?? 0, "the QuickBooks exception count") : NO_ACCESS,
    refundRequests: requests ? seen(requests, () => requests.count ?? 0, "the open refund requests") : NO_ACCESS,
    flaggedRefunds: flaggedCount,
    ...payoutProofs(payoutState),
    warnings,
  };
}

/**
 * The counts behind the two warning lines: proofs waiting (Payment proofs on) and paid pledges not yet on the bank (Bank reconciliation
 * on), each read with the person's own access. A module that is off, or a count the person is not allowed to see, gives null (no
 * line); a count that failed gives { ok: false } (said in words).
 */
export async function loadWarningCounts(session: CrmSession): Promise<CloseWarningCounts> {
  const { db, center } = session;
  const seesPayments = canAccess(session, "payments");
  const proofsOn = seesPayments && isModuleEnabled(session, "giving_proofs");
  const bankOn = canAccess(session, "bank") && isModuleEnabled(session, "giving_bank");
  const [proofs, unbanked] = await Promise.all([
    proofsOn ? db.rpc("payment_proof_counts", { p_center: center.id }) : null,
    bankOn ? db.rpc("unbanked_counts", { p_center: center.id }) : null,
  ]);
  return {
    proofsWaiting: proofs ? seen(proofs, () => parseProofCounts(proofs.data).waiting + parseProofCounts(proofs.data).needsInfo, "the payment proofs waiting") : null,
    unbanked: unbanked ? seen(unbanked, () => parseUnbankedCounts(unbanked.data).total, "the paid pledges not yet bank reconciled") : null,
  };
}

/** The shape app.payouts_close_state returns (0747). */
type PayoutCloseState = {
  payouts: number;
  paired: number;
  unpaired: number;
  explained: number;
  net_cents: number;
  bank_on: boolean;
  bank_lines: number | null;
  bank_lines_unpaired: number | null;
  bank_cents: number | null;
  proven: boolean | null;
};

/** Both sides of the card payouts and whether the month is proven, from one read; "could not check" is never "nothing". */
export function payoutProofs(res: { data: unknown; error: DbError } | null): Pick<CloseProofs, "payouts" | "bankPayouts" | "pairing"> {
  if (!res) return { payouts: NO_ACCESS, bankPayouts: null, pairing: null };
  const s = res.data as PayoutCloseState | null;
  if (res.error || !s || typeof s !== "object" || Array.isArray(s) || typeof s.payouts !== "number") {
    console.error("[books-close] the card payouts could not be read; the payouts check is not ticked:", res.error ?? res.data);
    return { payouts: { ok: false, why: "error" }, bankPayouts: null, pairing: null };
  }
  const n = (v: unknown) => Number(v ?? 0);
  return {
    payouts: { ok: true, value: { arrived: n(s.payouts), matched: n(s.paired), netCents: n(s.net_cents) } },
    bankPayouts: s.bank_on ? { ok: true, value: { lines: n(s.bank_lines), cents: n(s.bank_cents) } } : null,
    pairing: {
      proven: typeof s.proven === "boolean" ? s.proven : null,
      unpaired: n(s.unpaired),
      bankUnpaired: s.bank_on ? n(s.bank_lines_unpaired) : null,
      explained: n(s.explained),
    },
  };
}

/** The month's period row, its checklist with the proven checks ticked, and whether it is locked. */
export async function loadCloseState(session: CrmSession, month: string): Promise<CloseState> {
  const { db, center } = session;
  const label = longMonth(month);
  const [period, proofs] = await Promise.all([
    db.from("accounting_periods").select("status, checklist, closed_by, closed_at").eq("center_id", center.id).eq("period_month", month).maybeSingle(),
    loadCloseProofs(session, month),
  ]);
  const fmt = communityFormat(center);
  const row = (period.data ?? null) as ClosePeriod;
  return {
    month,
    label,
    periodError: period.error ?? null,
    period: row,
    locked: row?.status === "closed",
    items: closeItems(row?.checklist ?? {}, proofs, { monthLabel: label, currency: fmt.currency, locale: fmt.locale }),
    warnings: closeWarnings(proofs.warnings),
  };
}
