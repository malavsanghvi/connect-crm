import { reportReads } from "@/lib/reports/load";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";

import { dateFields, got, moneyOf, plural, resolveRange, startOfYear } from "./shared";

export type GivingTotalsData = {
  from: string;
  to: string;
  group_by: string;
  total: { payments: number; received_cents: number; received: string; refunded_cents: number; refunded: string; net_cents: number; net: string };
  groups: { label: string; payments: number; received_cents: number; received: string; net_cents: number | null; net: string | null }[];
  basis: string;
};

const input = object({
  ...dateFields,
  group_by: f.withDefault(
    f.enum("How to split the money: by way of paying (method), by month, by year, by fund or by campaign.", ["method", "month", "year", "fund", "campaign"] as const),
    "month",
  ),
});

const COMMON = "Failed, voided and only-authorized payments are left out.";
const BASIS: Record<string, string> = {
  method: `Money received in the range by way of paying, net of refunds. ${COMMON}`,
  month: `Money received in the range by month, net of refunds. ${COMMON}`,
  year: `Money received in the range by year, net of refunds. ${COMMON}`,
  fund: `Money applied to pledges, by the fund of the pledge; money not applied to any pledge is its own line. The total is net of refunds, the lines are before refunds (refunds are not split by fund). ${COMMON}`,
  campaign: `Money applied to pledges, by the campaign of the pledge; money not applied to any pledge is its own line. The total is net of refunds, the lines are before refunds (refunds are not split by campaign). ${COMMON}`,
};

/** Money received in a range of days, added up by the database and split by method, month, year, fund or campaign. */
export const givingTotals = defineCommand<Infer<typeof input>, GivingTotalsData>({
  key: "reports.giving_totals",
  title: "Add up the money received",
  description:
    "Add up the money received between two days, split by way of paying (method), month, year, fund or campaign. Use it for 'how much did we receive for the Building fund this year?', " +
    "'what came in each month?' and 'how much was Zelle against checks?'. Leave the dates out for this year so far. The sums are done by the database and are exact; amounts are in dollars with the exact cents. " +
    "The total is net of refunds. Counts and sums only: no household or donor is named. Use giving.household_summary for the giving of one household. Read only.",
  level: "read",
  permission: "paymentsAll",
  module: "reports",
  input,
  async execute(ctx, { from, to, group_by }) {
    const range = resolveRange(ctx, { from, to }, startOfYear);
    const money = moneyOf(ctx);
    const s = got(await reportReads.payments(ctx.session.db, ctx.session.center.id, range.from, range.to, group_by), "add up the money received");
    const data: GivingTotalsData = {
      from: range.from,
      to: range.to,
      group_by,
      total: {
        payments: s.totals.payments,
        received_cents: s.totals.receivedCents,
        received: money(s.totals.receivedCents),
        refunded_cents: s.totals.refundedCents,
        refunded: money(s.totals.refundedCents),
        net_cents: s.totals.netCents,
        net: money(s.totals.netCents),
      },
      groups: s.groups.map((g) => ({
        label: g.label,
        payments: g.payments,
        received_cents: g.receivedCents,
        received: money(g.receivedCents),
        net_cents: g.netCents,
        net: g.netCents === null ? null : money(g.netCents),
      })),
      basis: BASIS[group_by] ?? "",
    };
    return { ok: true, data, message: `${range.words}: ${data.total.net} net from ${plural(data.total.payments, "payment")}.` };
  },
});
