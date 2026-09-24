// Satvik Store: pure helpers shared by the console (Orders by pickup) and the
// kitchen display. Sales, not giving — nothing here touches pledges or funds.

export type OrderLike = { id: string; status: string; pickup_window_id: string | null };
export type LineLike = { order_id: string; item_id: string; quantity: number; is_gift: boolean };

/** Orders that still need the kitchen (placed or preparing). */
export const KITCHEN_OPEN = ["placed", "preparing"] as const;
/** Orders that count toward a pickup slot (everything a customer placed and did not cancel). */
export const ACTIVE_ORDER = ["placed", "preparing", "ready", "picked_up"] as const;

/**
 * Units to prepare per item: lines of orders not yet ready (placed or
 * preparing). Lifted from the kitchen display so both screens agree.
 */
export function prepList(orders: OrderLike[], lines: LineLike[]): Map<string, number> {
  const open = new Set(orders.filter((o) => (KITCHEN_OPEN as readonly string[]).includes(o.status)).map((o) => o.id));
  const out = new Map<string, number>();
  for (const l of lines) {
    if (open.has(l.order_id)) out.set(l.item_id, (out.get(l.item_id) ?? 0) + l.quantity);
  }
  return out;
}

/** The biggest prep items, for the "Top items to prepare" bars. */
export function topItems(prep: Map<string, number>, limit = 5): { item_id: string; units: number; pct: number }[] {
  const sorted = [...prep.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  const max = sorted[0]?.[1] ?? 0;
  return sorted.map(([item_id, units]) => ({ item_id, units, pct: max > 0 ? Math.round((units * 100) / max) : 0 }));
}

export type WindowCounts = { orders: number; placed: number; preparing: number; ready: number; pickedUp: number; cancelled: number; giftPacks: number };

/** Per-window counts: "N orders · N placed · N preparing · N ready" plus gift packs. */
export function windowCounts(windowId: string, orders: OrderLike[], lines: LineLike[]): WindowCounts {
  const os = orders.filter((o) => o.pickup_window_id === windowId);
  const active = new Set(os.filter((o) => (ACTIVE_ORDER as readonly string[]).includes(o.status)).map((o) => o.id));
  const count = (s: string) => os.filter((o) => o.status === s).length;
  return {
    orders: active.size,
    placed: count("placed"),
    preparing: count("preparing"),
    ready: count("ready"),
    pickedUp: count("picked_up"),
    cancelled: count("cancelled"),
    giftPacks: lines.filter((l) => l.is_gift && active.has(l.order_id)).reduce((s, l) => s + l.quantity, 0),
  };
}

export type SlotStatus = "Open" | "Preparing" | "Ready" | "Picked up" | "Closed" | "No orders";

/**
 * One word for a pickup slot in "This cycle": Open until the order cutoff,
 * then Preparing while any order is placed/preparing, Ready when all are
 * ready, Picked up when every order has been collected.
 */
export function slotStatus(
  w: { status: string; order_cutoff_at: string },
  counts: WindowCounts,
  now: Date = new Date(),
): SlotStatus {
  if (w.status === "open" && new Date(w.order_cutoff_at).getTime() > now.getTime()) return "Open";
  if (counts.orders === 0) return w.status === "open" ? "No orders" : "Closed";
  if (counts.placed + counts.preparing > 0) return "Preparing";
  if (counts.ready > 0) return "Ready";
  return "Picked up";
}

/** Low stock when the count is below the reorder level (the prototype's rule). */
export function isLowStock(item: { track_inventory: boolean; stock_on_hand: number; low_stock_threshold: number | null }): boolean {
  return item.track_inventory && item.low_stock_threshold !== null && item.stock_on_hand < item.low_stock_threshold;
}

/** The quick-adjust buttons on Inventory. */
export const QUICK_ADJUST = [-5, 10] as const;

/** Stock movement reasons and the sign each one forces. */
export function signedDelta(reason: string, quantity: number): number {
  if (reason === "waste") return -Math.abs(quantity);
  if (reason === "received" || reason === "returned") return Math.abs(quantity);
  return quantity;
}

// Order status moves forward one step at a time (or is cancelled).
export const NEXT_ORDER_STATUS: Record<string, string[]> = {
  placed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["picked_up"],
};

export function canMoveOrder(from: string, to: string): boolean {
  return (NEXT_ORDER_STATUS[from] ?? []).includes(to);
}
