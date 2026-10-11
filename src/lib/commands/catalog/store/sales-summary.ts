import { todayInTz } from "@/lib/dates";
import { can } from "@/lib/permissions";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError } from "../../types";
import { rpcJson } from "../db";
import { asObj } from "../giving-json";

import { buildSales, defaultPeriod, periodProblem, type SalesData } from "./pure";

const input = object({
  from: f.optional(f.date("The first day of the period, like 2026-10-01. Leave it out for the start of this month.")),
  to: f.optional(f.date("The last day of the period, included. Leave it out for today.")),
});

const NO_ACCESS = "You don't have access to this area. The store's sales need the Store permission (view or manage).";

/** What the store sold in a period, added up in the database: orders, units, subtotal, gift packing, tax and total, and the top items. Reads only. */
export const salesSummary = defineCommand<Infer<typeof input>, SalesData>({
  key: "store.sales_summary",
  title: "See the store sales for a period",
  description:
    "What the store sold between two days (the community's own days): the number of orders and units, the subtotal, gift packing, sales tax and total in dollars (the cents are in the *_cents fields), " +
    "the orders by status, and the five items that sold most. Added up in the database. Cancelled and refunded orders are not sales; they are counted apart. " +
    "Leave the days out for this month so far. Read only: it refunds nothing and changes no order.",
  level: "read",
  permission: "store",
  module: "store",
  input,
  async execute(ctx, inp) {
    const { db, center } = ctx.session;
    if (!can(ctx.session, ["store.view", "store.manage"])) throw new CommandError(NO_ACCESS);
    const today = todayInTz(center.time_zone, ctx.now?.());
    const to = inp.to ?? today;
    const from = inp.from ?? (inp.to ? `${inp.to.slice(0, 7)}-01` : defaultPeriod(today).from);
    const problem = periodProblem(from, to);
    if (problem) throw new CommandError(`Could not add up the sales — ${problem}`);
    const raw = await rpcJson(db, "store_sales_summary", { p_center: center.id, p_from: from, p_to: to }, "add up the store sales");
    if (raw === null || raw === undefined) throw new CommandError(NO_ACCESS);
    const data = buildSales(asObj(raw), center.currency);
    return {
      ok: true,
      data,
      message: data.orders === 0 ? `No orders were placed from ${from} to ${to}.` : `${data.orders} ${data.orders === 1 ? "order" : "orders"}, ${data.total} in total, from ${from} to ${to}.`,
    };
  },
});
