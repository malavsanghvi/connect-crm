import { todayInTz } from "@/lib/dates";
import { loadGlanceRows } from "@/lib/giving-glance/load";
import { glanceWindow, glanceYearOf } from "@/lib/giving-glance/period";
import { LIMITED_VIEW_NOTE, summarize } from "@/lib/giving-glance/summary";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { loadFiscalStart } from "@/lib/reports/fiscal";
import { sourceLabel } from "@/lib/payments/payment-draft";
import type { CrmSession } from "@/lib/session";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import { CommandDbError, CommandError, type HouseholdCard } from "../types";

import { rpcJson } from "./db";
import { asObj, int, rows, str } from "./giving-json";
import { adultHouseholdCards } from "./household";

export type HouseholdGivingData = {
  household: HouseholdCard;
  as_of: string;
  lifetime: { payments: number; received_cents: number; received: string; refunded_cents: number; refunded: string; first_gift_on: string | null; last_gift_on: string | null };
  years: { year: number; payments: number; received_cents: number; received: string; refunded_cents: number; refunded: string }[];
  recent_payments: { id: string; receipt_number: string | null; received_on: string; method: string; amount_cents: number; amount: string; refunded_cents: number; status: string }[];
  open_pledges: {
    id: string;
    pledge_number: string | null;
    kind: string;
    campaign: string | null;
    fund: string | null;
    amount_cents: number;
    amount: string;
    paid_cents: number;
    open_cents: number;
    open: string;
    due_on: string | null;
    pledged_on: string | null;
    days_overdue: number;
  }[];
  open_pledge_count: number;
  open_cents: number;
  open: string;
  behind_cents: number;
  behind: string;
  recurring_active: number;
  /** Set when this person can see only the payments they recorded themselves, so the totals above may be too low. */
  limited_view: string | null;
  /** Only when a year was asked for: that one year of the community's own, worked out from the pledges and payments. */
  year_summary?: HouseholdGivingYear;
};

/** One year of a household's giving (the community's own year: it starts in the month Setup says, January when none is set). */
export type HouseholdGivingYear = {
  year: number;
  /** "2025", or "2025-26" for a year that does not start in January. */
  label: string;
  from: string;
  to: string;
  pledged_cents: number;
  pledged: string;
  pledge_count: number;
  /** Received in the year, after refunds. */
  paid_cents: number;
  paid: string;
  refunded_cents: number;
  refunded: string;
  gifts: number;
  average_gift: string | null;
  /** Of the pledges made in the year, how much of their amount has been paid so far (0 to 100); null when none were made. */
  fulfilment_percent: number | null;
  by_cause: { label: string; cents: number; amount: string; percent: number }[];
  /** The year before (the same days of it while this year is still going on). */
  previous: { label: string; paid_cents: number; paid: string; pledged_cents: number; pledged: string } | null;
  /** Said when the start of the year could not be read and the calendar year was used. */
  note: string | null;
};

const input = object({
  household_id: f.uuid("The household (its id, from people.search or another card). A household is never found by name alone."),
  year: f.optional(
    f.integer(
      "A year, to answer 'how much did this household give in 2025?'. It is the community's own year, named by the calendar year it starts in (the calendar year unless Setup says the year starts in another month). " +
        "The answer then also holds year_summary: pledged, paid after refunds, gifts, how much of the pledges made that year has been paid, and what it went to. Leave it out for the usual summary.",
      { min: 1991, max: 2100 },
    ),
  ),
});

export const householdGivingSummary = defineCommand<Infer<typeof input>, HouseholdGivingData>({
  key: "giving.household_summary",
  title: "Show a household's giving",
  description:
    "One household's giving, shown with its household card (the adults, number, city, last gift): what it gave in total and in each of the last three years " +
    "(received and refunded), its most recent payments, its open pledges with what is still owed and how overdue each is, and whether it has a recurring gift. " +
    "Needs the household's id: find it first with people.search and let the person choose by the card, never by name. " +
    "Pass year to see one year of it (pledged, paid, fulfilment, what it went to) in the community's own year. " +
    "Amounts are in the community's currency and exact. Opening balances and payments that never completed are left out, as on year-end statements. Read only.",
  level: "read",
  permission: "payments",
  module: "giving",
  input,
  async execute(ctx, { household_id, year }) {
    const { db, center } = ctx.session;
    const today = todayInTz(center.time_zone, ctx.now?.());
    const money = (c: number) => formatCents(c, center.currency);
    const raw = await rpcJson(db, "giving_household_summary", { p_household: household_id, p_today: today }, "read the household's giving");
    const j = asObj(raw);
    if (!str(j.household_id)) throw new CommandError("That household was not found, or you can't see its giving.");
    const { cards } = await adultHouseholdCards(db, [household_id], { today, currency: center.currency });
    const household = cards[0];
    if (!household) throw new CommandError("That household was not found, or you can't see its giving.");

    const life = asObj(j.lifetime);
    const data: HouseholdGivingData = {
      household,
      as_of: str(j.as_of) ?? today,
      lifetime: {
        payments: int(life.payments),
        received_cents: int(life.received_cents),
        received: money(int(life.received_cents)),
        refunded_cents: int(life.refunded_cents),
        refunded: money(int(life.refunded_cents)),
        first_gift_on: str(life.first_gift_on),
        last_gift_on: str(life.last_gift_on),
      },
      years: rows(j.years).map((y) => ({
        year: int(y.year),
        payments: int(y.payments),
        received_cents: int(y.received_cents),
        received: money(int(y.received_cents)),
        refunded_cents: int(y.refunded_cents),
        refunded: money(int(y.refunded_cents)),
      })),
      recent_payments: rows(j.recent_payments).map((p) => ({
        id: str(p.id) ?? "",
        receipt_number: str(p.receipt_number),
        received_on: str(p.received_on) ?? "",
        method: PAYMENT_METHOD_LABEL[str(p.method) ?? ""] ?? str(p.method) ?? "Other",
        amount_cents: int(p.amount_cents),
        amount: money(int(p.amount_cents)),
        refunded_cents: int(p.refunded_cents),
        status: str(p.status) ?? "",
      })),
      open_pledges: rows(j.open_pledges).map((p) => ({
        id: str(p.id) ?? "",
        pledge_number: str(p.pledge_number),
        kind: sourceLabel(str(p.source) ?? ""),
        campaign: str(p.campaign),
        fund: str(p.fund),
        amount_cents: int(p.amount_cents),
        amount: money(int(p.amount_cents)),
        paid_cents: int(p.paid_cents),
        open_cents: int(p.open_cents),
        open: money(int(p.open_cents)),
        due_on: str(p.due_on),
        pledged_on: str(p.pledged_on),
        days_overdue: int(p.days_overdue),
      })),
      open_pledge_count: int(j.open_pledge_count),
      open_cents: int(j.open_cents),
      open: money(int(j.open_cents)),
      behind_cents: int(j.behind_cents),
      behind: money(int(j.behind_cents)),
      recurring_active: int(j.recurring_active),
      // A finance volunteer (giving.record_offline only) sees the payments they recorded themselves, not the household's whole history.
      limited_view: can(ctx.session, ["giving.view", "giving.manage"]) ? null : LIMITED_VIEW_NOTE,
    };
    if (year !== undefined) data.year_summary = await oneYear(ctx.session, household_id, year, today, money);
    const shown = data.open_pledges.length;
    const nothing = data.lifetime.payments === 0 && data.open_pledge_count === 0;
    const ys = data.year_summary;
    return {
      ok: true,
      data,
      message:
        data.limited_view ??
        (ys && ys.pledge_count === 0 && ys.gifts === 0
          ? `This household has no pledges or payments in ${ys.label}.`
          : nothing
          ? "This household has no payments or open pledges on record."
          : data.open_pledge_count > shown
            ? `Showing the first ${shown} of ${data.open_pledge_count} open pledges.`
            : undefined),
    };
  },
});

/** The pledges and payments of one year, read as the signed-in person (so a finance volunteer sees only what they recorded). */
async function oneYear(
  session: CrmSession,
  householdId: string,
  year: number,
  today: string,
  money: (cents: number) => string,
): Promise<HouseholdGivingYear> {
  const { db, center } = session;
  const fiscal = await loadFiscalStart(db, center.id);
  if (year > glanceYearOf(today, fiscal.month)) throw new CommandError(`${year} has not started yet, so there is no giving to show for it.`);
  const window = glanceWindow({ kind: "year", year }, today, fiscal.month);
  const loaded = await loadGlanceRows(db, center.id, center.time_zone, { households: [householdId] });
  if (!loaded.ok) throw new CommandDbError(loaded.error, "read the household's pledges and payments for that year");
  const s = summarize(loaded.rows, window, today);
  return {
    year,
    label: window.label,
    from: window.from ?? "",
    to: window.to ?? "",
    pledged_cents: s.totals.pledgedCents,
    pledged: money(s.totals.pledgedCents),
    pledge_count: s.totals.pledgedCount,
    paid_cents: s.totals.paidCents,
    paid: money(s.totals.paidCents),
    refunded_cents: s.totals.refundedCents,
    refunded: money(s.totals.refundedCents),
    gifts: s.totals.giftCount,
    average_gift: s.totals.averageCents === null ? null : money(s.totals.averageCents),
    fulfilment_percent: s.fulfilmentPercent,
    by_cause: s.byCause.map((c) => ({ label: c.label, cents: c.cents, amount: money(c.cents), percent: c.percent })),
    previous: s.previous && window.previous ? { label: window.previous.label, paid_cents: s.previous.paidCents, paid: money(s.previous.paidCents), pledged_cents: s.previous.pledgedCents, pledged: money(s.previous.pledgedCents) } : null,
    note: fiscal.problem,
  };
}
