import { todayInTz } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { sourceLabel } from "@/lib/payments/payment-draft";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import { CommandError, type HouseholdCard } from "../types";

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
};

const input = object({
  household_id: f.uuid("The household (its id, from people.search or another card). A household is never found by name alone."),
});

export const householdGivingSummary = defineCommand<Infer<typeof input>, HouseholdGivingData>({
  key: "giving.household_summary",
  title: "Show a household's giving",
  description:
    "One household's giving, shown with its household card (the adults, number, city, last gift): what it gave in total and in each of the last three years " +
    "(received and refunded), its most recent payments, its open pledges with what is still owed and how overdue each is, and whether it has a recurring gift. " +
    "Needs the household's id: find it first with people.search and let the person choose by the card, never by name. " +
    "Amounts are in the community's currency and exact. Opening balances and payments that never completed are left out, as on year-end statements. Read only.",
  level: "read",
  permission: "payments",
  module: "giving",
  input,
  async execute(ctx, { household_id }) {
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
      limited_view: can(ctx.session, ["giving.view", "giving.manage"])
        ? null
        : "You can see only the payments you recorded yourself, so the totals and the list of payments may be lower than the household's real giving. Open pledges are complete.",
    };
    const shown = data.open_pledges.length;
    const nothing = data.lifetime.payments === 0 && data.open_pledge_count === 0;
    return {
      ok: true,
      data,
      message:
        data.limited_view ??
        (nothing
          ? "This household has no payments or open pledges on record."
          : data.open_pledge_count > shown
            ? `Showing the first ${shown} of ${data.open_pledge_count} open pledges.`
            : undefined),
    };
  },
});
