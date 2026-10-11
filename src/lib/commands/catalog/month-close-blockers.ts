import { todayInTz } from "@/lib/dates";
import { closeChecklist, firstOfMonth, longMonth } from "@/lib/giving";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import { CommandDbError } from "../types";

export type CloseBlockersData = {
  month: string;
  locked: boolean;
  ready_to_lock: boolean;
  blockers: { item: string; why: string }[];
  done: string[];
};

const input = object({
  month: f.optional(f.date("Any date in the month to check, like 2026-09-15. Leave out for this month.")),
});

/** The Accounting › Month-end close checklist, read the way that screen reads it, as a list of what still blocks the lock. */
export const monthCloseBlockers = defineCommand<Infer<typeof input>, CloseBlockersData>({
  key: "accounting.month_close_blockers",
  title: "Show what is blocking month-end close",
  description:
    "For one month (this month unless a date is given), list what must still be done before the month can be locked: " +
    "QuickBooks exceptions to clear, payouts to match to bank deposits, refunds to review (including refunds made outside Weaver that still need two approvals) and statements to generate. " +
    "Says whether the month is already locked. Read only: it cannot mark an item done or lock a month.",
  level: "read",
  permission: "close",
  module: "accounting",
  input,
  async execute(ctx, { month: asked }) {
    const { db, center } = ctx.session;
    const month = firstOfMonth(asked ?? todayInTz(center.time_zone, ctx.now?.()));
    const [period, exceptions, flagged] = await Promise.all([
      db.from("accounting_periods").select("status, checklist").eq("center_id", center.id).eq("period_month", month).maybeSingle(),
      db.from("ledger_postings").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "failed").lte("period_month", month),
      db.rpc("flagged_refund_count", { p_center: center.id }),
    ]);
    if (period.error) throw new CommandDbError(period.error, "read the month-end checklist");
    // Same as the screen: a count that cannot be read is said, not treated as zero.
    if (exceptions.error) console.error("[commands] accounting.month_close_blockers: exception count failed:", exceptions.error);
    if (flagged.error) console.error("[commands] accounting.month_close_blockers: flagged refund count failed:", flagged.error);
    const items = closeChecklist(period.data?.checklist ?? {}, exceptions.error ? null : (exceptions.count ?? 0), flagged.error ? 0 : (flagged.data ?? 0));
    const blockers = items.filter((i) => !i.done).map((i) => ({ item: i.label, why: i.sub }));
    if (flagged.error) blockers.push({ item: "Refunds made outside Weaver", why: "Could not count the refunds waiting for approval" });
    const locked = period.data?.status === "closed";
    return {
      ok: true,
      data: { month: longMonth(month), locked, ready_to_lock: !locked && blockers.length === 0, blockers, done: items.filter((i) => i.done).map((i) => i.label) },
      message: locked ? `${longMonth(month)} is already locked.` : blockers.length === 0 ? `Nothing is blocking the lock for ${longMonth(month)}.` : undefined,
    };
  },
});
