// The pure pieces of the Store commands: sales in the community's currency from the database's cents, the low-stock rule, how an order is worded, and
// the before/after of a price. No database, no clock of its own: everything is given in, so every rule here is tested on its own
// (tests/commands/store-pure.test.ts). Money is integer cents underneath; amounts are only ever formatted from them.

import { daysBetween } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { isLowStock } from "@/lib/store";

import { asObj, int, rows, str, type Obj } from "../giving-json";

// ---------------------------------------------------------------------------
// Sales for a period
// ---------------------------------------------------------------------------
export const MAX_PERIOD_DAYS = 366;

/** This month so far: the first of the month to today (both in the community's own time zone). */
export function defaultPeriod(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Why a period cannot be summed, or null when it can. The sentence follows "Could not add up the sales — ". */
export function periodProblem(from: string, to: string): string | null {
  if (to < from) return "the end of the period is before its start.";
  if (daysBetween(from, to) + 1 > MAX_PERIOD_DAYS) return `a period can be at most ${MAX_PERIOD_DAYS} days. Ask for a shorter one.`;
  return null;
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  placed: "Placed",
  preparing: "Being prepared",
  ready: "Ready for pickup",
  picked_up: "Picked up",
  cancelled: "Cancelled",
  refunded: "Refunded",
  cart: "In a cart",
};

export type SalesData = {
  from: string;
  to: string;
  days: number;
  orders: number;
  units: number;
  subtotal_cents: number;
  subtotal: string;
  gift_packing_cents: number;
  gift_packing: string;
  tax_cents: number;
  tax: string;
  total_cents: number;
  total: string;
  by_status: { status: string; label: string; orders: number }[];
  cancelled_orders: number;
  refunded_orders: number;
  refunded_cents: number;
  refunded: string;
  top_items: { item: string; units: number; sold_cents: number; sold: string }[];
  notes: string[];
};

export function buildSales(j: Obj, currency: string): SalesData {
  const money = (c: number) => formatCents(c, currency);
  const from = str(j.from) ?? "";
  const to = str(j.to) ?? "";
  const orders = int(j.orders);
  const status = asObj(j.by_status);
  const subtotal = int(j.subtotal_cents);
  const gift = int(j.gift_packing_cents);
  const tax = int(j.tax_cents);
  const total = int(j.total_cents);
  const refunded = int(j.refunded_cents);
  const order = ["placed", "preparing", "ready", "picked_up", "cancelled", "refunded"];
  const data: SalesData = {
    from,
    to,
    days: from && to ? daysBetween(from, to) + 1 : 0,
    orders,
    units: int(j.units),
    subtotal_cents: subtotal,
    subtotal: money(subtotal),
    gift_packing_cents: gift,
    gift_packing: money(gift),
    tax_cents: tax,
    tax: money(tax),
    total_cents: total,
    total: money(total),
    by_status: order.filter((s) => int(status[s]) > 0).map((s) => ({ status: s, label: ORDER_STATUS_LABEL[s] ?? s, orders: int(status[s]) })),
    cancelled_orders: int(j.cancelled_orders),
    refunded_orders: int(j.refunded_orders),
    refunded_cents: refunded,
    refunded: money(refunded),
    top_items: rows(j.top_items).map((t) => ({ item: str(t.name) ?? "An item", units: int(t.units), sold_cents: int(t.cents), sold: money(int(t.cents)) })),
    notes: [],
  };
  data.notes.push("Sales are orders placed in the period that are placed, being prepared, ready or picked up. Cancelled and refunded orders are not sales; they are counted apart.");
  if (orders === 0) data.notes.push("No orders were placed in this period.");
  if (data.refunded_orders > 0) data.notes.push("Niva can't refund an order: refunds are made by a person with the Giving permission.");
  return data;
}

// ---------------------------------------------------------------------------
// Low stock
// ---------------------------------------------------------------------------
export type StockRow = { id: string; name: string; sku: string | null; stock_on_hand: number; low_stock_threshold: number | null; track_inventory: boolean; status: string };

export type LowStockItem = { item_id: string; name: string; sku: string | null; in_stock: number; reorder_at: number; short_by: number; out_of_stock: boolean; status: string };

/** Items that track stock and are below their reorder level, the furthest below first (the rule of Inventory: below, not at). Retired items are left out. */
export function lowStockItems(list: readonly StockRow[]): LowStockItem[] {
  return list
    .filter((i) => i.status !== "retired" && isLowStock(i))
    .map((i) => {
      const reorderAt = i.low_stock_threshold ?? 0;
      return { item_id: i.id, name: i.name, sku: i.sku, in_stock: i.stock_on_hand, reorder_at: reorderAt, short_by: reorderAt - i.stock_on_hand, out_of_stock: i.stock_on_hand <= 0, status: i.status };
    })
    .sort((a, b) => b.short_by - a.short_by || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export const WAITING_STATUSES = ["placed", "preparing", "ready"] as const;

/** "2 × Samosa pack, 1 × Gift jar" (the first few, then "and 2 more"). */
export function itemsLine(lines: readonly { name: string; quantity: number }[], max = 4): string {
  if (lines.length === 0) return "no items";
  const shown = lines.slice(0, max).map((l) => `${l.quantity} × ${l.name}`);
  const more = lines.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------
export type PriceChange = { before_cents: number; after_cents: number; before: string; after: string; difference_cents: number; difference: string; percent: number | null };

export function priceChange(beforeCents: number, afterCents: number, currency: string): PriceChange {
  const diff = afterCents - beforeCents;
  return {
    before_cents: beforeCents,
    after_cents: afterCents,
    before: formatCents(beforeCents, currency),
    after: formatCents(afterCents, currency),
    difference_cents: diff,
    difference: `${diff >= 0 ? "+" : "-"}${formatCents(Math.abs(diff), currency)}`,
    percent: beforeCents > 0 ? Math.round((diff * 1000) / beforeCents) / 10 : null,
  };
}
