import { fetchAll } from "@/lib/data/fetch-all";
import { addDays, dateInTz, daysBetween, todayInTz } from "@/lib/dates";
import { formatCents } from "@/lib/money";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import { CommandDbError, type HouseholdCard } from "../types";

import { adultHouseholdCards } from "./household";

/** A pledge made with no due date counts as due this many days after it was made. */
export const IMPLIED_DUE_DAYS = 30;

type PledgeRow = { id: string; household_id: string; amount_cents: number; paid_cents: number; pledged_at: string; due_on: string | null };

export type BehindHousehold = {
  household: HouseholdCard;
  pledges_behind: number;
  open_cents: number;
  open: string;
  oldest_days_overdue: number;
};

export type PledgesBehindData = {
  households_behind: number;
  pledges_behind: number;
  total_open_cents: number;
  total_open: string;
  showing: BehindHousehold[];
  basis: string;
};

/**
 * Pure: which open pledges are behind and how the households add up. Money stays integer cents. A pledge is behind when it is past
 * its due date (or, with no due date, IMPLIED_DUE_DAYS after it was made) by at least `minDays` days.
 */
export function summarizeBehind(pledges: readonly PledgeRow[], today: string, tz: string, minDays: number) {
  const byHousehold = new Map<string, { pledges: number; open: number; oldest: number }>();
  let pledgesBehind = 0;
  let totalOpen = 0;
  for (const p of pledges) {
    const open = p.amount_cents - p.paid_cents;
    if (open <= 0) continue;
    const due = p.due_on ?? addDays(dateInTz(p.pledged_at, tz), IMPLIED_DUE_DAYS);
    const overdue = daysBetween(due, today);
    if (overdue < minDays) continue;
    const h = byHousehold.get(p.household_id) ?? { pledges: 0, open: 0, oldest: 0 };
    h.pledges += 1;
    h.open += open;
    h.oldest = Math.max(h.oldest, overdue);
    byHousehold.set(p.household_id, h);
    pledgesBehind += 1;
    totalOpen += open;
  }
  const ranked = [...byHousehold.entries()].sort((a, b) => b[1].open - a[1].open || b[1].oldest - a[1].oldest || a[0].localeCompare(b[0]));
  return { ranked, pledgesBehind, totalOpen, households: byHousehold.size };
}

const input = object({
  min_days_overdue: f.withDefault(f.integer("Only count pledges at least this many days past their due date.", { min: 1, max: 3650 }), 1),
  limit: f.withDefault(f.integer("The most households to list.", { min: 1, max: 25 }), 10),
});

export const pledgesBehind = defineCommand<Infer<typeof input>, PledgesBehindData>({
  key: "giving.pledges_behind",
  title: "Show who is behind on pledges",
  description:
    "List the households with pledges past their due date, the largest unpaid balance first. A pledge with no due date counts as due 30 days after it was made. " +
    "Each household is a household card (the adults, number, city, last gift) with how many pledges are behind, the unpaid amount and how many days overdue the oldest one is. " +
    "Also gives the totals across all households. Amounts are in dollars and are exact. Read only: it never contacts anyone or changes a pledge.",
  level: "read",
  permission: "pledges",
  module: "giving",
  input,
  async execute(ctx, { min_days_overdue, limit }) {
    const { db, center } = ctx.session;
    const tz = center.time_zone;
    const today = todayInTz(tz, ctx.now?.());
    const res = await fetchAll<PledgeRow>((from, to) =>
      db
        .from("pledges")
        .select("id, household_id, amount_cents, paid_cents, pledged_at, due_on")
        .eq("center_id", center.id)
        .in("status", ["open", "partially_paid"])
        .order("id")
        .range(from, to),
    );
    if (res.error) throw new CommandDbError(res.error, "read the pledges");
    const sum = summarizeBehind(res.data, today, tz, min_days_overdue);
    const top = sum.ranked.slice(0, limit);
    const { cards } = await adultHouseholdCards(
      db,
      top.map(([id]) => id),
      { today, currency: center.currency },
    );
    const byId = new Map(cards.map((c) => [c.household_id, c]));
    const showing: BehindHousehold[] = top.flatMap(([id, h]) => {
      const household = byId.get(id);
      return household ? [{ household, pledges_behind: h.pledges, open_cents: h.open, open: formatCents(h.open, center.currency), oldest_days_overdue: h.oldest }] : [];
    });
    return {
      ok: true,
      data: {
        households_behind: sum.households,
        pledges_behind: sum.pledgesBehind,
        total_open_cents: sum.totalOpen,
        total_open: formatCents(sum.totalOpen, center.currency),
        showing,
        basis: `Pledges at least ${min_days_overdue} day${min_days_overdue === 1 ? "" : "s"} past due on ${today}.`,
      },
      message: res.truncated
        ? "There are more pledges than could be read at once, so these totals may be too low."
        : sum.households === 0
          ? "Nobody is behind on pledges."
          : sum.households > showing.length
            ? `Showing ${showing.length} of ${sum.households} households.`
            : undefined,
    };
  },
});
