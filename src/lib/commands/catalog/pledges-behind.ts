import { todayInTz } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { AppSupabase } from "@/lib/supabase/server";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import { CommandError, type HouseholdCard } from "../types";

import { must, rpcJson } from "./db";
import { asObj, int, rows, str } from "./giving-json";
import { adultHouseholdCards } from "./household";

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
  /** How old the late pledges are: 1 to 30 days, 31 to 60, 61 to 90, over 90. */
  by_age: { bucket: string; pledges: number; open_cents: number; open: string }[];
  /** The fund the list is limited to, when one was asked for. */
  fund: string | null;
  showing: BehindHousehold[];
  basis: string;
};

const input = object({
  min_days_overdue: f.withDefault(f.integer("Only count pledges at least this many days past their due date.", { min: 1, max: 3650 }), 1),
  limit: f.withDefault(f.integer("The most households to list.", { min: 1, max: 25 }), 10),
  fund: f.optional(f.string("Only pledges to this fund, by name, like 'Building fund'. Leave out for all funds.", { min: 1, max: 80 })),
});

/** The fund a person named: an exact name or key wins, otherwise a name that contains the words. Asks which one when it cannot tell. */
async function resolveFund(db: AppSupabase, centerId: string, asked: string): Promise<{ id: string; name: string }> {
  const list = must(await db.from("funds").select("id, name, key").eq("center_id", centerId).eq("active", true).order("name"), "read the funds") ?? [];
  const q = asked.trim().toLowerCase();
  const exact = list.filter((x) => x.name.toLowerCase() === q || x.key.toLowerCase() === q);
  const found = exact.length > 0 ? exact : list.filter((x) => x.name.toLowerCase().includes(q));
  if (found.length === 1) return { id: found[0].id, name: found[0].name };
  if (found.length === 0) throw new CommandError(`There is no fund called "${asked}". The funds are: ${list.map((x) => x.name).join(", ") || "none yet"}.`);
  throw new CommandError(`More than one fund matches "${asked}": ${found.map((x) => x.name).join(", ")}. Which one?`);
}

export const pledgesBehind = defineCommand<Infer<typeof input>, PledgesBehindData>({
  key: "giving.pledges_behind",
  title: "Show who is behind on pledges",
  description:
    "List the households with pledges past their due date, the largest unpaid balance first. A pledge with no due date counts as due 30 days after it was made. " +
    "Each household is a household card (the adults, number, city, last gift) with how many pledges are behind, the unpaid amount and how many days overdue the oldest one is. " +
    "Also gives the totals across all households and how old the late pledges are (1 to 30 days, 31 to 60, 61 to 90, over 90), and can be limited to one fund. " +
    "Amounts are in the community's currency and are exact. Read only: it never contacts anyone or changes a pledge.",
  level: "read",
  permission: "pledges",
  module: "giving",
  input,
  async execute(ctx, { min_days_overdue, limit, fund }) {
    const { db, center } = ctx.session;
    const today = todayInTz(center.time_zone, ctx.now?.());
    const money = (c: number) => formatCents(c, center.currency);
    const chosenFund = fund ? await resolveFund(db, center.id, fund) : null;
    const raw = await rpcJson(
      db,
      "giving_pledges_behind",
      { p_center: center.id, p_today: today, p_min_days: min_days_overdue, p_limit: limit, p_fund: chosenFund?.id ?? null },
      "read the pledges",
    );
    const j = asObj(raw);
    const top = rows(j.rows);
    const { cards } = await adultHouseholdCards(
      db,
      top.flatMap((r) => str(r.household_id) ?? []),
      { today, currency: center.currency },
    );
    const byId = new Map(cards.map((c) => [c.household_id, c]));
    const showing: BehindHousehold[] = top.flatMap((r) => {
      const household = byId.get(str(r.household_id) ?? "");
      return household
        ? [{ household, pledges_behind: int(r.pledges_behind), open_cents: int(r.open_cents), open: money(int(r.open_cents)), oldest_days_overdue: int(r.oldest_days_overdue) }]
        : [];
    });
    const households = int(j.households_behind);
    return {
      ok: true,
      data: {
        households_behind: households,
        pledges_behind: int(j.pledges_behind),
        total_open_cents: int(j.total_open_cents),
        total_open: money(int(j.total_open_cents)),
        by_age: rows(j.by_age).map((a) => ({ bucket: str(a.bucket) ?? "", pledges: int(a.pledges), open_cents: int(a.open_cents), open: money(int(a.open_cents)) })),
        fund: chosenFund?.name ?? null,
        showing,
        basis: `Pledges${chosenFund ? ` to ${chosenFund.name}` : ""} at least ${min_days_overdue} day${min_days_overdue === 1 ? "" : "s"} past due on ${today}.`,
      },
      message:
        households === 0 ? "Nobody is behind on pledges." : households > showing.length ? `Showing ${showing.length} of ${households} households.` : undefined,
    };
  },
});
