"use server";

import { revalidatePath } from "next/cache";

import type { TablesUpdate } from "@/lib/database.types";
import { STORE_RULE_DEFAULTS, storeRules, withStoreRules, WEEKDAYS, type Weekday } from "@/lib/center-rules";
import { failure, type ActionResult } from "@/lib/errors";
import { localToUtc } from "@/lib/local-time";
import { parseAmountToCents } from "@/lib/money";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";
import { canMoveOrder, signedDelta } from "@/lib/store";

// Sales, not giving: nothing here creates pledges or touches funds.

function refresh() {
  revalidatePath("/store");
  revalidatePath("/store/menu");
  revalidatePath("/store/orders");
}

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function wholeNumber(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export async function moveOrderAction(orderId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const to = text(fd, "to");
  const auth = await authorizeAction("storePickup", "update the order");
  if (!auth.ok) return auth;
  if (!isUuid(orderId) || !["preparing", "ready", "picked_up", "cancelled"].includes(to)) {
    return { ok: false, error: "Could not update the order — unknown change." };
  }
  const { db, center, userId } = auth.session;
  const order = await db.from("store_orders").select("status, order_number").eq("id", orderId).eq("center_id", center.id).maybeSingle();
  if (order.error) return failure("Could not update the order", order.error);
  if (!order.data) return { ok: false, error: "Could not update the order — it no longer exists, or you can't see it." };
  const from = order.data.status;
  if (!canMoveOrder(from, to)) {
    return { ok: false, error: `Could not update order #${order.data.order_number} — it is ${from.replace("_", " ")} and can't move to ${to.replace("_", " ")}. Refresh to see the latest.` };
  }
  const now = new Date().toISOString();
  const patch: TablesUpdate<"store_orders"> = { status: to };
  if (to === "ready") patch.ready_at = now;
  if (to === "picked_up") {
    patch.picked_up_at = now;
    patch.picked_up_by = userId;
  }
  if (to === "cancelled") patch.cancelled_at = now;
  const res = await db.from("store_orders").update(patch).eq("id", orderId).eq("status", from).select("id");
  if (res.error) return failure("Could not update the order", res.error);
  if (!res.data?.length) return { ok: false, error: "Could not update the order — someone else just changed it. Refresh to see the latest." };
  refresh();
  return { ok: true, message: `Order #${order.data.order_number} ${to.replace("_", " ")}.` };
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
export async function saveCategoryAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("storeManage", "add the category");
  if (!auth.ok) return auth;
  const name = text(fd, "name");
  if (!name) return { ok: false, error: "Could not add the category — give it a name." };
  const order = wholeNumber(text(fd, "sort_order"));
  if (Number.isNaN(order)) return { ok: false, error: "Could not add the category — the order must be a whole number." };
  const { error } = await auth.session.db.from("store_categories").insert({ center_id: auth.session.center.id, name: name.slice(0, 80), sort_order: order ?? 0 });
  if (error) return failure("Could not add the category", error);
  refresh();
  return { ok: true, message: `Category "${name}" added.` };
}

export async function saveItemAction(itemId: string | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = itemId ? "save the item" : "add the item";
  const auth = await authorizeAction("storeManage", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const name = text(fd, "name");
  if (!name) return { ok: false, error: `Could not ${doing} — give it a name.` };
  const price = parseAmountToCents(text(fd, "price"));
  if (price === null || price < 0) return { ok: false, error: `Could not ${doing} — the price must be an amount like 8.99.` };
  const reorder = wholeNumber(text(fd, "low_stock_threshold"));
  if (Number.isNaN(reorder) || (reorder !== null && reorder < 0)) return { ok: false, error: `Could not ${doing} — "Reorder at" must be a whole number.` };
  const status = text(fd, "status") || "active";
  if (!["active", "paused", "retired"].includes(status)) return { ok: false, error: `Could not ${doing} — choose a status.` };
  const category = text(fd, "category_id");
  const values = {
    name: name.slice(0, 120),
    category_id: isUuid(category) ? category : null,
    sku: text(fd, "sku") || null,
    description: text(fd, "description") || null,
    price_cents: price,
    pack_size: text(fd, "pack_size") || null,
    taxable: Boolean(fd.get("taxable")),
    track_inventory: Boolean(fd.get("track_inventory")),
    gift_pack: Boolean(fd.get("gift_pack")),
    low_stock_threshold: reorder,
    status,
  };
  if (itemId) {
    if (!isUuid(itemId)) return { ok: false, error: `Could not ${doing} — unknown item.` };
    const { data, error } = await db.from("store_items").update(values).eq("id", itemId).eq("center_id", center.id).select("id");
    if (error) return failure(`Could not ${doing}`, error);
    if (!data?.length) return { ok: false, error: `Could not ${doing} — it was not found.` };
  } else {
    const { error } = await db.from("store_items").insert({ ...values, center_id: center.id });
    if (error) return failure(`Could not ${doing}`, error);
  }
  refresh();
  return { ok: true, message: itemId ? `"${name}" saved.` : `"${name}" added to the menu.` };
}

export async function saveWindowAction(windowId: string | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = windowId ? "save the pickup slot" : "add the pickup slot";
  const auth = await authorizeAction("storeManage", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const tz = center.time_zone;
  const starts = localToUtc(text(fd, "starts_at"), tz);
  const ends = localToUtc(text(fd, "ends_at"), tz);
  const cutoff = localToUtc(text(fd, "order_cutoff_at"), tz);
  if (!starts || !ends || !cutoff) return { ok: false, error: `Could not ${doing} — pickup start, end and order cutoff are required.` };
  if (ends <= starts) return { ok: false, error: `Could not ${doing} — pickup must end after it starts.` };
  if (cutoff > starts) return { ok: false, error: `Could not ${doing} — the order cutoff must be before pickup starts.` };
  const capacity = wholeNumber(text(fd, "capacity"));
  if (Number.isNaN(capacity) || (capacity !== null && capacity < 1)) return { ok: false, error: `Could not ${doing} — capacity must be a whole number of orders.` };
  const status = text(fd, "status") || "open";
  if (!["open", "closed", "fulfilled"].includes(status)) return { ok: false, error: `Could not ${doing} — choose a status.` };
  const eventId = text(fd, "event_id");
  const values = {
    starts_at: starts,
    ends_at: ends,
    order_cutoff_at: cutoff,
    capacity,
    location: text(fd, "location") || null,
    event_id: isUuid(eventId) ? eventId : null,
    status,
  };
  if (windowId) {
    if (!isUuid(windowId)) return { ok: false, error: `Could not ${doing} — unknown slot.` };
    const { data, error } = await db.from("pickup_windows").update(values).eq("id", windowId).eq("center_id", center.id).select("id");
    if (error) return failure(`Could not ${doing}`, error);
    if (!data?.length) return { ok: false, error: `Could not ${doing} — it was not found.` };
  } else {
    const { error } = await db.from("pickup_windows").insert({ ...values, center_id: center.id });
    if (error) return failure(`Could not ${doing}`, error);
  }
  refresh();
  return { ok: true, message: windowId ? "Pickup slot saved." : "Pickup slot added." };
}

// ---------------------------------------------------------------------------
// Inventory. A movement row is the audit line; stock_on_hand follows it (the
// store_items update is also in the audit log). Two writes: if the second
// fails, we say so.
// ---------------------------------------------------------------------------
async function applyMovement(itemId: string, delta: number, reason: string, doing: string): Promise<ActionResult> {
  const auth = await authorizeAction("storeManage", doing);
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  if (!isUuid(itemId)) return { ok: false, error: `Could not ${doing} — choose the item.` };
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: `Could not ${doing} — enter a quantity other than zero.` };
  const item = await db.from("store_items").select("name, stock_on_hand, track_inventory").eq("id", itemId).eq("center_id", center.id).maybeSingle();
  if (item.error) return failure(`Could not ${doing}`, item.error);
  if (!item.data) return { ok: false, error: `Could not ${doing} — that item no longer exists.` };
  if (!item.data.track_inventory) return { ok: false, error: `Could not ${doing} — "${item.data.name}" does not track stock. Turn on "Track stock" on Menu & pickup first.` };
  const mv = await db.from("inventory_movements").insert({ center_id: center.id, item_id: itemId, delta, reason, recorded_by: userId });
  if (mv.error) return failure(`Could not ${doing}`, mv.error);
  const now = item.data.stock_on_hand + delta;
  const upd = await db.from("store_items").update({ stock_on_hand: now }).eq("id", itemId).eq("stock_on_hand", item.data.stock_on_hand).select("id");
  if (upd.error || !upd.data?.length) {
    console.error("[store] movement recorded but the stock count was not updated:", upd.error ?? "stock changed meanwhile");
    return {
      ok: false,
      error: `The change was logged, but ${item.data.name}'s stock count could not be updated${upd.error ? "" : " (someone changed it at the same time)"}. Refresh, check the count, and correct it with an adjustment.`,
    };
  }
  refresh();
  return { ok: true, message: `Adjusted stock ${item.data.name} by ${delta > 0 ? "+" : ""}${delta} (now ${now})` };
}

export async function quickAdjustAction(itemId: string, delta: number): Promise<ActionResult> {
  if (delta !== -5 && delta !== 10) return { ok: false, error: "Could not adjust stock — unknown adjustment." };
  return applyMovement(itemId, delta, "adjustment", "adjust the stock");
}

export async function recordMovementAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const reason = text(fd, "reason");
  if (!["received", "waste", "adjustment", "returned"].includes(reason)) return { ok: false, error: "Could not record the stock change — choose a reason." };
  const qty = Number(text(fd, "quantity"));
  if (!Number.isInteger(qty) || qty === 0) return { ok: false, error: "Could not record the stock change — enter a whole quantity other than zero." };
  return applyMovement(text(fd, "item_id"), signedDelta(reason, qty), reason, "record the stock change");
}

// ---------------------------------------------------------------------------
// Order and pickup settings (centers.rules.store). centers updates need
// settings.manage (centers_admin_update); the page says so to store leads.
// ---------------------------------------------------------------------------
export async function saveStoreSettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("centerSettings", "save the store settings");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const gift = parseAmountToCents(text(fd, "gift_pack"));
  if (gift === null || gift < 0) return { ok: false, error: "Could not save the store settings — the gift packing price must be an amount like 2.99." };
  const day = text(fd, "cutoff_day") as Weekday;
  if (!(WEEKDAYS as readonly string[]).includes(day)) return { ok: false, error: "Could not save the store settings — choose the cutoff day." };
  const time = text(fd, "cutoff_time");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, error: "Could not save the store settings — the cutoff time is not valid." };
  const cancel = Number(text(fd, "cancel_hours") || String(STORE_RULE_DEFAULTS.cancelHoursBeforePickup));
  if (!Number.isInteger(cancel) || cancel < 0 || cancel > 720) {
    return { ok: false, error: "Could not save the store settings — the cancellation window must be 0 to 720 hours." };
  }
  const visible = text(fd, "visible_to") === "members" ? "members" : "everyone";
  const current = await db.from("centers").select("rules").eq("id", center.id).single();
  if (current.error) return failure("Could not save the store settings", current.error);
  const next = withStoreRules(current.data.rules, {
    ...storeRules(current.data.rules),
    giftPackCents: gift,
    orderCutoffDay: day,
    orderCutoffTime: time,
    cancelHoursBeforePickup: cancel,
    kitchenSummaryAtCutoff: Boolean(fd.get("kitchen_summary")),
    visibleTo: visible,
  });
  const { data, error } = await db.from("centers").update({ rules: next }).eq("id", center.id).select("id");
  if (error) return failure("Could not save the store settings", error);
  if (!data?.length) return { ok: false, error: "Could not save the store settings — you don't have permission to change center settings." };
  refresh();
  revalidatePath("/settings/center");
  return { ok: true, message: "Store settings · saved and audited" };
}
