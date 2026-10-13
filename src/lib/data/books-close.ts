// Month-end close, read once for everyone who shows or acts on it: the close page (Giving › Books), the lock action and the
// accounting.month_close_blockers command (Niva and Giving › Today). The counts behind each check are read with the person's
// own database access; a count the person cannot see is "could not check", never zero (src/lib/books/close.ts).

import { closeItems, type CloseItem, type CloseProofs, type Seen } from "@/lib/books/close";
import { communityFormat } from "@/lib/community-format";
import { addMonths, longMonth } from "@/lib/giving";
import { GIVING_ADDONS } from "@/lib/giving-today/tabs";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
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
};

const lastDayOf = (month: string) => {
  const next = addMonths(month, 1);
  const d = new Date(`${next}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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
  const end = lastDayOf(month);
  // QuickBooks postings and card payouts are readable with giving.view or accounting.manage (0010); payments with giving staff access.
  const seesLedger = canAccess(session, "qboLedger");
  const seesPayments = canAccess(session, "paymentsAll");
  const seesBank = seesPayments && isModuleEnabled(session, GIVING_ADDONS.bank);

  const [exceptions, flagged, requests, payouts, bank] = await Promise.all([
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
    seesLedger
      ? db.from("payouts").select("net_cents, matched").eq("center_id", center.id).gte("arrives_on", month).lte("arrives_on", end).limit(2000)
      : null,
    seesBank
      ? db
          .from("bank_transactions")
          .select("amount_cents")
          .eq("center_id", center.id)
          .eq("channel", "card_payout")
          .gte("posted_on", month)
          .lte("posted_on", end)
          .limit(2000)
      : null,
  ]);
  if (flagged.error) console.error("[books-close] flagged refund count failed; the refunds check is not ticked:", flagged.error);
  const flaggedCount = !flagged.error && typeof flagged.data === "number" ? flagged.data : null;
  return {
    exceptions: exceptions ? seen(exceptions, () => exceptions.count ?? 0, "the QuickBooks exception count") : NO_ACCESS,
    refundRequests: requests ? seen(requests, () => requests.count ?? 0, "the open refund requests") : NO_ACCESS,
    flaggedRefunds: flaggedCount,
    payouts: payouts
      ? seen(
          payouts,
          () => {
            const rows = (payouts.data ?? []) as { net_cents: number; matched: boolean }[];
            return { arrived: rows.length, matched: rows.filter((r) => r.matched).length, netCents: rows.reduce((a, r) => a + Number(r.net_cents), 0) };
          },
          "the card payouts",
        )
      : NO_ACCESS,
    bankPayouts: bank
      ? seen(
          bank,
          () => {
            const rows = ((bank.data ?? []) as { amount_cents: number }[]).filter((r) => Number(r.amount_cents) > 0);
            return { lines: rows.length, cents: rows.reduce((a, r) => a + Number(r.amount_cents), 0) };
          },
          "the bank's card payout lines",
        )
      : null,
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
  };
}
