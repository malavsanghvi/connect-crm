import { chunk } from "@/lib/data/fetch-all";
import { formatDateTime } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { formatTimeRange } from "@/lib/local-time";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { must } from "../db";
import { cardLine, cardsFor } from "../people/shared";

import { itemsLine, ORDER_STATUS_LABEL, WAITING_STATUSES } from "./pure";

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  pickup_window_id: string | null;
  household_id: string | null;
  person_id: string | null;
  total_cents: number;
  placed_at: string | null;
  ready_at: string | null;
};
type WindowRow = { id: string; starts_at: string; ends_at: string; order_cutoff_at: string; capacity: number | null; location: string | null; status: string };

export type OrdersWaitingData = {
  waiting: number;
  ready_for_pickup: number;
  not_ready_yet: number;
  windows: { window_id: string | null; pickup: string; location: string | null; orders: number; ready: number; not_ready: number }[];
  orders: {
    order_id: string;
    order_number: string;
    status: string;
    status_label: string;
    ready: boolean;
    pickup: string;
    /** The household (never a name alone) or "a guest"; a guest's name is on the order, not here. */
    customer: string;
    items: string;
    total_cents: number;
    total: string;
    placed: string | null;
    /** Marking it ready sends the member a notice; a guest order or a household with no app has none to send. */
    member_gets_notice_when_ready: boolean;
  }[];
  not_listed: number;
  notes: string[];
};

const input = object({
  which: f.withDefault(f.enum("all: every order not yet picked up. ready: ready and waiting for the member. not_ready: placed or being prepared.", ["all", "ready", "not_ready"] as const), "all"),
  limit: f.withDefault(f.integer("The most orders to list (1 to 50), by pickup time then by when they were placed.", { min: 1, max: 50 }), 25),
});

const FETCH_MAX = 500;

/** The store orders that are not picked up or cancelled yet, by pickup slot, with which are ready. Reads only. */
export const ordersWaiting = defineCommand<Infer<typeof input>, OrdersWaitingData>({
  key: "store.orders_waiting",
  title: "See the store orders waiting for pickup",
  description:
    "The store orders still to hand over: how many are ready for the member to collect and how many are not ready yet (placed or being prepared), counted by pickup slot, " +
    "and the orders themselves with what was ordered, the total in dollars and the household (a household card line, never a name alone; a guest's name is not shown). " +
    "Use the order_id with store.set_order_status. Read only: it moves no order and sends nothing.",
  level: "read",
  permission: "storeOrders",
  module: "store",
  input,
  async execute(ctx, { which, limit }) {
    const { db, center } = ctx.session;
    const tz = center.time_zone;
    const money = (c: number) => formatCents(c, center.currency);
    const statuses = which === "ready" ? ["ready"] : which === "not_ready" ? ["placed", "preparing"] : [...WAITING_STATUSES];
    const found = (must(
      await db
        .from("store_orders")
        .select("id, order_number, status, pickup_window_id, household_id, person_id, total_cents, placed_at, ready_at")
        .eq("center_id", center.id)
        .in("status", statuses)
        .order("placed_at", { ascending: true })
        .limit(FETCH_MAX),
      "read the store orders",
    ) ?? []) as OrderRow[];

    const windowIds = [...new Set(found.flatMap((o) => (o.pickup_window_id ? [o.pickup_window_id] : [])))];
    const windows = new Map<string, WindowRow>();
    for (const part of chunk(windowIds)) {
      const w = (must(await db.from("pickup_windows").select("id, starts_at, ends_at, order_cutoff_at, capacity, location, status").in("id", part), "read the pickup slots") ?? []) as WindowRow[];
      for (const row of w) windows.set(row.id, row);
    }
    const startOf = (o: OrderRow) => (o.pickup_window_id ? (windows.get(o.pickup_window_id)?.starts_at ?? "9999") : "9999");
    const sorted = [...found].sort((a, b) => startOf(a).localeCompare(startOf(b)) || (a.placed_at ?? "").localeCompare(b.placed_at ?? "") || a.order_number.localeCompare(b.order_number));
    const shown = sorted.slice(0, limit);

    const pickup = (id: string | null) => {
      const w = id ? windows.get(id) : undefined;
      return w ? formatTimeRange(w.starts_at, w.ends_at, tz) : "No pickup slot";
    };
    const byWindow = new Map<string, { orders: number; ready: number }>();
    for (const o of sorted) {
      const key = o.pickup_window_id ?? "";
      const cur = byWindow.get(key) ?? { orders: 0, ready: 0 };
      cur.orders += 1;
      if (o.status === "ready") cur.ready += 1;
      byWindow.set(key, cur);
    }

    // What was ordered, and the households, for the orders listed.
    const lines = new Map<string, { item_id: string; quantity: number }[]>();
    for (const part of chunk(shown.map((o) => o.id))) {
      const l = (must(await db.from("store_order_lines").select("order_id, item_id, quantity").in("order_id", part), "read what was ordered") ?? []) as { order_id: string; item_id: string; quantity: number }[];
      for (const row of l) lines.set(row.order_id, [...(lines.get(row.order_id) ?? []), { item_id: row.item_id, quantity: row.quantity }]);
    }
    const names = new Map<string, string>();
    for (const part of chunk([...new Set([...lines.values()].flat().map((l) => l.item_id))])) {
      const it = (must(await db.from("store_items").select("id, name").in("id", part), "read the item names") ?? []) as { id: string; name: string }[];
      for (const row of it) names.set(row.id, row.name);
    }
    const cards = await cardsFor(ctx, shown.map((o) => o.household_id));

    const ready = sorted.filter((o) => o.status === "ready").length;
    const notes: string[] = [];
    if (sorted.length === 0) notes.push(which === "all" ? "No orders are waiting." : "No orders match.");
    if (found.length >= FETCH_MAX) notes.push(`Only the first ${FETCH_MAX} orders were read; there may be more.`);
    notes.push("Marking an order ready sends the member a 'Your order is ready' notice. Picking up and cancelling are done by a person.");

    const data: OrdersWaitingData = {
      waiting: sorted.length,
      ready_for_pickup: ready,
      not_ready_yet: sorted.length - ready,
      windows: [...byWindow.entries()]
        .map(([id, c]) => ({ id, ...c }))
        .sort((a, b) => (windows.get(a.id)?.starts_at ?? "9999").localeCompare(windows.get(b.id)?.starts_at ?? "9999"))
        .map((c) => ({ window_id: c.id || null, pickup: pickup(c.id || null), location: windows.get(c.id)?.location ?? null, orders: c.orders, ready: c.ready, not_ready: c.orders - c.ready })),
      orders: shown.map((o) => {
        const card = cards.find((c) => c.household_id === o.household_id);
        return {
          order_id: o.id,
          order_number: o.order_number,
          status: o.status,
          status_label: ORDER_STATUS_LABEL[o.status] ?? o.status,
          ready: o.status === "ready",
          pickup: pickup(o.pickup_window_id),
          customer: o.household_id ? cardLine(card) : "a guest (no member on file)",
          items: itemsLine((lines.get(o.id) ?? []).map((l) => ({ name: names.get(l.item_id) ?? "an item", quantity: l.quantity }))),
          total_cents: o.total_cents,
          total: money(o.total_cents),
          placed: o.placed_at ? formatDateTime(o.placed_at, tz) : null,
          member_gets_notice_when_ready: o.person_id !== null,
        };
      }),
      not_listed: Math.max(0, sorted.length - shown.length),
      notes,
    };
    return {
      ok: true,
      data,
      message: sorted.length === 0 ? "No orders are waiting." : `${sorted.length} ${sorted.length === 1 ? "order is" : "orders are"} waiting: ${ready} ready, ${sorted.length - ready} not ready yet.`,
    };
  },
});
