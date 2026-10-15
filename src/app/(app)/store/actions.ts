"use server";

import { revalidatePath } from "next/cache";

import { plain } from "@/lib/commands/catalog/messages/screen";
import { runScreenCommand } from "@/lib/commands/screen";
import { STORE_RULE_DEFAULTS, storeRules, withStoreRules, WEEKDAYS, type Weekday } from "@/lib/center-rules";
import { failure, type ActionResult } from "@/lib/errors";
import { localToUtc } from "@/lib/local-time";
import { parseAmountToCents } from "@/lib/money";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";
import { signedDelta } from "@/lib/store";
import {
  asStoreSection,
  DEFAULT_STORE_SECTION,
  MARKET_STARTER_CATEGORIES,
  marketModuleOn,
  sectionOpen,
  STORE_SECTION_LABELS,
  type StoreSection,
} from "@/lib/store-sections";

// Sales, not giving: nothing here creates pledges or touches funds.

function refresh() {
  revalidatePath("/store");
  revalidatePath("/store/menu");
  revalidatePath("/store/market");
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
/**
 * Move an order along (Orders by pickup). The work is the command store.set_order_status (src/lib/commands/catalog/store): this reads the
 * form and calls it, the same code the ⌘K palette and Niva use. Marking an order ready sends the member the 'Your order is ready' notice
 * (a database trigger, 0598).
 */
export async function moveOrderAction(orderId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const to = text(fd, "to");
  const auth = await authorizeAction("storePickup", "update the order");
  if (!auth.ok) return auth;
  if (!isUuid(orderId) || !["preparing", "ready", "picked_up", "cancelled"].includes(to)) {
    return { ok: false, error: "Could not update the order — unknown change." };
  }
  return plain(await runScreenCommand("store.set_order_status", { order_id: orderId, to }, "update the order"));
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
/**
 * The section a new category or item is created in (0821): the one the form carries, which is the section the page was on. A form that
 * names none (a page left open from before sections) writes to Food, as every row did. A section the form names that does not exist
 * is refused in plain words.
 */
function askedSection(fd: FormData, doing: string): { section: StoreSection } | { error: string } {
  const asked = text(fd, "section");
  if (!asked) return { section: DEFAULT_STORE_SECTION };
  const section = asStoreSection(asked);
  return section ? { section } : { error: `Could not ${doing} — that store section does not exist.` };
}

/**
 * The Community Market takes new rows only while the community has it on (0830; the database refuses a market row otherwise). Said in
 * plain words, with where to ask, before anything is written.
 */
function notOn(doing: string): string {
  return `Could not ${doing} — the ${STORE_SECTION_LABELS.market} is not on for your community. An administrator can ask for it in Settings › Marketplace.`;
}

export async function saveCategoryAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "add the category";
  const asked = askedSection(fd, doing);
  // Food is the store manager's; the Community Market is also market.manage's (0830).
  const auth = await authorizeAction("section" in asked && asked.section === "market" ? "marketManage" : "storeManage", doing);
  if (!auth.ok) return auth;
  const name = text(fd, "name");
  if (!name) return { ok: false, error: "Could not add the category — give it a name." };
  const order = wholeNumber(text(fd, "sort_order"));
  if (Number.isNaN(order)) return { ok: false, error: "Could not add the category — the order must be a whole number." };
  const where = asked;
  if ("error" in where) return { ok: false, error: where.error };
  if (!sectionOpen(where.section, marketModuleOn(auth.session))) return { ok: false, error: notOn(doing) };
  const { error } = await auth.session.db
    .from("store_categories")
    .insert({ center_id: auth.session.center.id, name: name.slice(0, 80), sort_order: order ?? 0, section: where.section });
  if (error) return failure("Could not add the category", error);
  refresh();
  return { ok: true, message: `Category "${name}" added.` };
}

export async function saveItemAction(itemId: string | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = itemId ? "save the item" : "add the item";
  // A new item is the store manager's in Food and also market.manage's in the Community Market (0830). Saving an existing item may be
  // either person's; the database lets market.manage change only a market item.
  const asked = itemId ? null : askedSection(fd, doing);
  const auth = await authorizeAction(itemId || (asked && "section" in asked && asked.section === "market") ? "marketManage" : "storeManage", doing);
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
    // A new item goes in the section the page was on; the database moves it to its category's section if it has a category (0821).
    const where = asked ?? askedSection(fd, doing);
    if ("error" in where) return { ok: false, error: where.error };
    if (!sectionOpen(where.section, marketModuleOn(auth.session))) return { ok: false, error: notOn(doing) };
    const { error } = await db.from("store_items").insert({ ...values, section: where.section, center_id: center.id });
    if (error) return failure(`Could not ${doing}`, error);
    refresh();
    return { ok: true, message: where.section === "market" ? `"${name}" added to the ${STORE_SECTION_LABELS.market}.` : `"${name}" added to the menu.` };
  }
  refresh();
  return { ok: true, message: `"${name}" saved.` };
}

// ---------------------------------------------------------------------------
// The Community Market (0830): starting it, and its categories. Its listings are store items filed in the market section (saveItemAction).
// ---------------------------------------------------------------------------
/**
 * Start the Community Market: add the starter categories (src/lib/store-sections.ts MARKET_STARTER_CATEGORIES) that this community does
 * not already have a category of the same name for. A name that a Food category already uses is skipped and said so (a category name is
 * unique in a community). The categories are the community's to rename or remove afterwards.
 */
export async function startMarketAction(): Promise<ActionResult> {
  const doing = "start the Community Market";
  const auth = await authorizeAction("marketManage", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  if (!marketModuleOn(auth.session)) return { ok: false, error: notOn(doing) };
  const existing = await db.from("store_categories").select("name, section").eq("center_id", center.id);
  if (existing.error) return failure(`Could not ${doing}`, existing.error);
  const have = existing.data ?? [];
  const taken = new Set(have.map((c) => c.name.trim().toLowerCase()));
  const toAdd = MARKET_STARTER_CATEGORIES.filter((n) => !taken.has(n.toLowerCase()));
  const skipped = MARKET_STARTER_CATEGORIES.filter((n) => taken.has(n.toLowerCase()));
  if (toAdd.length === 0) return { ok: true, message: "The starter categories are already there." };
  const first = have.filter((c) => c.section === "market").length;
  const { error } = await db
    .from("store_categories")
    .insert(toAdd.map((name, i) => ({ center_id: center.id, name, sort_order: first + i + 1, section: "market" as const })));
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  const added = `Added ${toAdd.length} starter ${toAdd.length === 1 ? "category" : "categories"} to the ${STORE_SECTION_LABELS.market}.`;
  return { ok: true, message: skipped.length ? `${added} Left out because the name is already used: ${skipped.join(", ")}.` : added };
}

/** Rename or re-order a Community Market category. Food's categories are not edited here (the market's page is the only caller). */
export async function saveMarketCategoryAction(categoryId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "save the category";
  const auth = await authorizeAction("marketManage", doing);
  if (!auth.ok) return auth;
  if (!isUuid(categoryId)) return { ok: false, error: `Could not ${doing} — unknown category.` };
  const name = text(fd, "name");
  if (!name) return { ok: false, error: `Could not ${doing} — give it a name.` };
  const order = wholeNumber(text(fd, "sort_order"));
  if (Number.isNaN(order)) return { ok: false, error: `Could not ${doing} — the order must be a whole number.` };
  const { db, center } = auth.session;
  const { data, error } = await db
    .from("store_categories")
    .update({ name: name.slice(0, 80), sort_order: order ?? 0 })
    .eq("id", categoryId)
    .eq("center_id", center.id)
    .eq("section", "market")
    .select("id");
  if (error) return failure(`Could not ${doing}`, error);
  if (!data?.length) return { ok: false, error: `Could not ${doing} — it was not found in the ${STORE_SECTION_LABELS.market}.` };
  refresh();
  return { ok: true, message: `Category "${name}" saved.` };
}

/**
 * Remove a Community Market category. Its listings are kept: they lose the category and stay in the market (the database leaves an item
 * where it was, 0821). This deletes only the category's name.
 */
export async function removeMarketCategoryAction(categoryId: string): Promise<ActionResult> {
  const doing = "remove the category";
  const auth = await authorizeAction("marketManage", doing);
  if (!auth.ok) return auth;
  if (!isUuid(categoryId)) return { ok: false, error: `Could not ${doing} — unknown category.` };
  const { db, center } = auth.session;
  const { data, error } = await db.from("store_categories").delete().eq("id", categoryId).eq("center_id", center.id).eq("section", "market").select("id, name");
  if (error) return failure(`Could not ${doing}`, error);
  if (!data?.length) return { ok: false, error: `Could not ${doing} — it was not found in the ${STORE_SECTION_LABELS.market}.` };
  refresh();
  return { ok: true, message: `Category "${data[0].name}" removed. Its listings are kept, without a category.` };
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
// Inventory. A movement row is the audit line, and the database moves
// stock_on_hand with it (trigger inventory_apply, migration 0017): the app
// inserts the movement and nothing else. Writing the count here as well would
// apply the change twice or, as a guarded update, never match. The count is
// read back afterwards so the message shows what is really on the shelf.
// ---------------------------------------------------------------------------
async function applyMovement(itemId: string, reason: string, quantity: number, doing: string): Promise<ActionResult> {
  const auth = await authorizeAction("storeManage", doing);
  if (!auth.ok) return auth;
  if (!isUuid(itemId)) return { ok: false, error: `Could not ${doing} — choose the item.` };
  const delta = signedDelta(reason, quantity);
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: `Could not ${doing} — enter a quantity other than zero.` };
  // The work is the command store.adjust_stock (src/lib/commands/catalog/store): it records the movement and reads the count back
  // exactly as this action always did, and shares that code with the ⌘K palette and Niva.
  return plain(await runScreenCommand("store.adjust_stock", { item_id: itemId, reason, quantity, doing }, doing));
}

export async function quickAdjustAction(itemId: string, delta: number): Promise<ActionResult> {
  if (delta !== -5 && delta !== 10) return { ok: false, error: "Could not adjust stock — unknown adjustment." };
  return applyMovement(itemId, "adjustment", delta, "adjust the stock");
}

export async function recordMovementAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const reason = text(fd, "reason");
  if (!["received", "waste", "adjustment", "returned"].includes(reason)) return { ok: false, error: "Could not record the stock change — choose a reason." };
  const qty = Number(text(fd, "quantity"));
  if (!Number.isInteger(qty) || qty === 0) return { ok: false, error: "Could not record the stock change — enter a whole quantity other than zero." };
  return applyMovement(text(fd, "item_id"), reason, qty, "record the stock change");
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
