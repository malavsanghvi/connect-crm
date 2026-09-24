import { describe, expect, it } from "vitest";

import { formatWeeklyCutoff, storeRules, STORE_RULE_DEFAULTS, validateRulesJson, withStoreRules } from "@/lib/center-rules";
import { formatCutoff, localToUtc, utcToLocal } from "@/lib/local-time";
import { canMoveOrder, isLowStock, prepList, signedDelta, slotStatus, topItems, windowCounts } from "@/lib/store";

const orders = [
  { id: "o1", status: "placed", pickup_window_id: "w1" },
  { id: "o2", status: "preparing", pickup_window_id: "w1" },
  { id: "o3", status: "ready", pickup_window_id: "w1" },
  { id: "o4", status: "cancelled", pickup_window_id: "w1" },
  { id: "o5", status: "placed", pickup_window_id: "w2" },
];
const lines = [
  { order_id: "o1", item_id: "thali", quantity: 2, is_gift: false },
  { order_id: "o2", item_id: "thali", quantity: 1, is_gift: false },
  { order_id: "o2", item_id: "katli", quantity: 3, is_gift: true },
  { order_id: "o3", item_id: "katli", quantity: 5, is_gift: true },
  { order_id: "o4", item_id: "katli", quantity: 9, is_gift: true },
  { order_id: "o5", item_id: "khakhra", quantity: 1, is_gift: false },
];

describe("orders by pickup", () => {
  it("prep list counts only placed and preparing orders", () => {
    const prep = prepList(orders, lines);
    expect(Object.fromEntries(prep)).toEqual({ thali: 3, katli: 3, khakhra: 1 });
    expect(topItems(prep, 2)).toEqual([
      { item_id: "katli", units: 3, pct: 100 },
      { item_id: "thali", units: 3, pct: 100 },
    ]);
  });
  it("counts orders and gift packs per slot, ignoring cancelled", () => {
    expect(windowCounts("w1", orders, lines)).toEqual({ orders: 3, placed: 1, preparing: 1, ready: 1, pickedUp: 0, cancelled: 1, giftPacks: 8 });
  });
  it("names a slot's status", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    const c = windowCounts("w1", orders, lines);
    expect(slotStatus({ status: "open", order_cutoff_at: "2026-09-25T00:00:00Z" }, c, now)).toBe("Open");
    expect(slotStatus({ status: "open", order_cutoff_at: "2026-09-24T00:00:00Z" }, c, now)).toBe("Preparing");
    const ready = { ...c, placed: 0, preparing: 0 };
    expect(slotStatus({ status: "closed", order_cutoff_at: "2026-09-24T00:00:00Z" }, ready, now)).toBe("Ready");
    expect(slotStatus({ status: "closed", order_cutoff_at: "2026-09-24T00:00:00Z" }, { ...ready, ready: 0, pickedUp: 3 }, now)).toBe("Picked up");
    expect(slotStatus({ status: "closed", order_cutoff_at: "2026-09-24T00:00:00Z" }, windowCounts("none", orders, lines), now)).toBe("Closed");
  });
  it("moves orders one step at a time", () => {
    expect(canMoveOrder("placed", "preparing")).toBe(true);
    expect(canMoveOrder("placed", "ready")).toBe(false);
    expect(canMoveOrder("ready", "cancelled")).toBe(false);
  });
});

describe("inventory", () => {
  it("low stock is below the reorder level, tracked items only", () => {
    expect(isLowStock({ track_inventory: true, stock_on_hand: 4, low_stock_threshold: 5 })).toBe(true);
    expect(isLowStock({ track_inventory: true, stock_on_hand: 5, low_stock_threshold: 5 })).toBe(false);
    expect(isLowStock({ track_inventory: false, stock_on_hand: 0, low_stock_threshold: 5 })).toBe(false);
    expect(isLowStock({ track_inventory: true, stock_on_hand: 0, low_stock_threshold: null })).toBe(false);
  });
  it("forces the sign by reason", () => {
    expect(signedDelta("waste", 4)).toBe(-4);
    expect(signedDelta("received", -4)).toBe(4);
    expect(signedDelta("adjustment", -4)).toBe(-4);
  });
});

describe("store rules", () => {
  it("reads defaults and stored values", () => {
    expect(storeRules({})).toEqual(STORE_RULE_DEFAULTS);
    expect(storeRules({ store: { gift_pack_cents: 350, order_cutoff_day: "friday", order_cutoff_time: "18:30", visible_to: "members", kitchen_summary_at_cutoff: false } })).toMatchObject({
      giftPackCents: 350,
      orderCutoffDay: "friday",
      orderCutoffTime: "18:30",
      visibleTo: "members",
      kitchenSummaryAtCutoff: false,
    });
    expect(storeRules({ store: { order_cutoff_day: "someday", order_cutoff_time: "9pm" } })).toMatchObject({ orderCutoffDay: "thursday", orderCutoffTime: "21:00" });
  });
  it("replaces only store keys", () => {
    const next = withStoreRules({ lunch: { slot_minutes: 20 }, store: { legacy: 1 } }, { ...STORE_RULE_DEFAULTS, visibleTo: "members" });
    expect(next.lunch).toEqual({ slot_minutes: 20 });
    expect(next.store).toMatchObject({ legacy: 1, visible_to: "members", gift_pack_cents: 299 });
  });
  it("validates the store keys in the rules editor", () => {
    const bad = validateRulesJson(JSON.stringify({ store: { order_cutoff_day: "Thu", order_cutoff_time: "25:00", visible_to: "all" } }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(3);
    expect(validateRulesJson(JSON.stringify(withStoreRules({}, STORE_RULE_DEFAULTS))).ok).toBe(true);
  });
  it("formats the weekly cutoff", () => {
    expect(formatWeeklyCutoff("thursday", "21:00")).toBe("Thursday 9:00 PM");
    expect(formatWeeklyCutoff("sunday", "00:15")).toBe("Sunday 12:15 AM");
  });
});

describe("local time", () => {
  it("round-trips wall time in the center's zone, across DST", () => {
    expect(localToUtc("2026-09-26T21:00", "America/Chicago")).toBe("2026-09-27T02:00:00.000Z");
    expect(localToUtc("2026-12-01T09:30", "America/Chicago")).toBe("2026-12-01T15:30:00.000Z");
    expect(utcToLocal("2026-09-27T02:00:00.000Z", "America/Chicago")).toBe("2026-09-26T21:00");
    expect(localToUtc("nope", "America/Chicago")).toBeNull();
  });
  it("formats a cutoff the prototype's way", () => {
    expect(formatCutoff("2026-09-27T02:00:00.000Z", "America/Chicago")).toBe("Sat, Sep 26 · 9 PM");
  });
});
