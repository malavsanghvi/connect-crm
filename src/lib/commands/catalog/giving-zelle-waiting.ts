import { todayInTz } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { parseExactPair, REPORT_STATUS_LABEL, type ReportStatus } from "@/lib/payments/zelle";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import type { HouseholdCard } from "../types";

import { rpcJson } from "./db";
import { asArr, asObj, bool, int, rows, str } from "./giving-json";
import { adultHouseholdCards } from "./household";

export type ZelleWaitingReport = {
  id: string;
  household: HouseholdCard | null;
  status: string;
  amount_cents: number;
  amount: string;
  sent_on: string;
  days_waiting: number;
  /** The date the bank should have shown it by (the community's report window). */
  due_on: string;
  past_window: boolean;
  sender_name: string | null;
  has_confirmation: boolean;
  pledges_named: number;
  /** A bank line has the same confirmation number and amount: the treasurer can confirm it in one step. */
  exact_bank_match: boolean;
  is_test: boolean;
};

export type ZelleWaitingData = {
  as_of: string;
  waiting: number;
  reported: number;
  unmatched: number;
  past_window: number;
  total_cents: number;
  total: string;
  /** How many reports have an exact bank line (ready for "confirm exact matches"). */
  exact_matches: number;
  reports: ZelleWaitingReport[];
  where_to_match: string;
};

const input = object({
  limit: f.withDefault(f.integer("The most reports to list, oldest first.", { min: 1, max: 25 }), 10),
});

export const zelleWaiting = defineCommand<Infer<typeof input>, ZelleWaitingData>({
  key: "giving.zelle_waiting",
  title: "Show Zelle reports waiting for the bank",
  description:
    "The Zelle payments members say they sent that the treasurer has not matched to a bank line yet: how many, the total in the community's currency, which are past the community's report window, " +
    "and which already have a bank line with the same confirmation number and amount (ready to confirm in one step). Each is shown with its household card. " +
    "A report credits nobody until a bank line is matched. Read only: it does not confirm or close anything. Matching is done on Giving > Payments > Bank > Zelle reports.",
  level: "read",
  permission: "bank",
  module: "giving",
  input,
  async execute(ctx, { limit }) {
    const { db, center } = ctx.session;
    const today = todayInTz(center.time_zone, ctx.now?.());
    const money = (c: number) => formatCents(c, center.currency);
    const j = asObj(await rpcJson(db, "giving_zelle_waiting", { p_center: center.id, p_limit: limit, p_today: today }, "read the Zelle reports"));
    // Which of the waiting reports have exactly one matching bank line. Only the report ids are used: the household details in
    // that answer list every member by first name (children included) and are never read; the cards below come from adults only.
    const exactIds = asArr(await rpcJson(db, "zelle_exact_matches", { p_center: center.id }, "look for exact Zelle matches"))
      .map(parseExactPair)
      .flatMap((p) => (p ? [p.report_id] : []));
    const exact = new Set(exactIds);
    const list = rows(j.reports);
    const { cards } = await adultHouseholdCards(
      db,
      list.flatMap((r) => str(r.household_id) ?? []),
      { today, currency: center.currency },
    );
    const byId = new Map(cards.map((c) => [c.household_id, c]));
    const data: ZelleWaitingData = {
      as_of: str(j.as_of) ?? today,
      waiting: int(j.reported) + int(j.unmatched),
      reported: int(j.reported),
      unmatched: int(j.unmatched),
      past_window: int(j.past_window),
      total_cents: int(j.total_cents),
      total: money(int(j.total_cents)),
      exact_matches: exact.size,
      reports: list.map((r) => ({
        id: str(r.id) ?? "",
        household: byId.get(str(r.household_id) ?? "") ?? null,
        status: REPORT_STATUS_LABEL[(str(r.status) ?? "") as ReportStatus] ?? "Waiting",
        amount_cents: int(r.amount_cents),
        amount: money(int(r.amount_cents)),
        sent_on: str(r.sent_on) ?? "",
        days_waiting: int(r.days_waiting),
        due_on: str(r.due_on) ?? "",
        past_window: bool(r.past_window),
        sender_name: str(r.sender_name),
        has_confirmation: bool(r.has_confirmation),
        pledges_named: int(r.pledges_named),
        exact_bank_match: exact.has(str(r.id) ?? ""),
        is_test: bool(r.is_test),
      })),
      where_to_match: "/giving/payments/bank?view=zelle",
    };
    return {
      ok: true,
      data,
      message:
        data.waiting === 0
          ? "No Zelle reports are waiting for the bank."
          : data.waiting > data.reports.length
            ? `Showing the oldest ${data.reports.length} of ${data.waiting} Zelle reports waiting.`
            : undefined,
    };
  },
});
