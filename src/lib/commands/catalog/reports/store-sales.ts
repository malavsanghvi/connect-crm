import { reportReads } from "@/lib/reports/load";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";

import { dateFields, got, moneyOf, plural, requireModule, resolveRange, startOfYear } from "./shared";

export type StoreSalesData = {
  from: string;
  to: string;
  orders: number;
  sales_cents: number;
  sales: string;
  by_month: { month: string; orders: number; sales: string; sales_cents: number }[];
  top_items: { item: string; units: number; sales: string; sales_cents: number }[];
  basis: string;
};

const input = object({
  ...dateFields,
  top: f.withDefault(f.integer("How many of the best-selling items to list.", { min: 1, max: 25 }), 5),
});

/** Store orders and sales in a range of days, by month and by item. */
export const storeSales = defineCommand<Infer<typeof input>, StoreSalesData>({
  key: "reports.store_sales",
  title: "Add up store sales",
  description:
    "Add up the store orders and sales between two days: how many orders, the sales in dollars, the sales by month and the best-selling items. Leave the dates out for this year so far. " +
    "Use it for 'how much did the store sell this month?' and 'what sells best?'. Orders still in a cart and cancelled orders are left out. " +
    "The sums are done by the database and are exact. Counts and sums only: no customer is named. Read only.",
  level: "read",
  permission: "store",
  module: "reports",
  input,
  async execute(ctx, { from, to, top }) {
    requireModule(ctx, "store");
    const range = resolveRange(ctx, { from, to }, startOfYear);
    const money = moneyOf(ctx);
    const s = got(await reportReads.storeSales(ctx.session.db, ctx.session.center.id, range.from, range.to, top), "add up the store sales");
    const data: StoreSalesData = {
      from: range.from,
      to: range.to,
      orders: s.orders,
      sales_cents: s.salesCents,
      sales: money(s.salesCents),
      by_month: s.byMonth.map((m) => ({ month: m.month, orders: m.orders, sales: money(m.salesCents), sales_cents: m.salesCents })),
      top_items: s.topItems.map((i) => ({ item: i.item, units: i.units, sales: money(i.salesCents), sales_cents: i.salesCents })),
      basis: "Orders placed, being prepared, ready or picked up, counted on the day they were placed.",
    };
    return { ok: true, data, message: `${range.words}: ${data.sales} from ${plural(s.orders, "order")}.` };
  },
});
