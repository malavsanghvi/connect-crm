import { todayInTz } from "@/lib/dates";
import { loadCloseState } from "@/lib/data/books-close";
import { firstOfMonth } from "@/lib/giving";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import { CommandDbError } from "../types";

export type CloseBlockersData = {
  month: string;
  locked: boolean;
  ready_to_lock: boolean;
  blockers: { item: string; why: string }[];
  done: string[];
  /** The checks the data proved (ticked by the system, with what was checked). */
  proven?: { item: string; why: string }[];
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
    "Checks the data can prove tick themselves (no refund waiting, no card payout to match) and are listed with what was checked. " +
    "Says whether the month is already locked. Read only: it cannot mark an item done or lock a month.",
  level: "read",
  permission: "close",
  module: "accounting",
  input,
  async execute(ctx, { month: asked }) {
    const month = firstOfMonth(asked ?? todayInTz(ctx.session.center.time_zone, ctx.now?.()));
    // The same reader as the Month-end close screen and the lock: the checks the data proves are ticked, the rest are a person's.
    const state = await loadCloseState(ctx.session, month);
    if (state.periodError) throw new CommandDbError(state.periodError, "read the month-end checklist");
    const blockers = state.items.filter((i) => !i.done).map((i) => ({ item: i.label, why: i.sub }));
    const proven = state.items.filter((i) => i.proven).map((i) => ({ item: i.label, why: i.sub }));
    const { locked, label } = state;
    return {
      ok: true,
      data: { month: label, locked, ready_to_lock: !locked && blockers.length === 0, blockers, done: state.items.filter((i) => i.done).map((i) => i.label), proven },
      message: locked ? `${label} is already locked.` : blockers.length === 0 ? `Nothing is blocking the lock for ${label}.` : undefined,
    };
  },
});
