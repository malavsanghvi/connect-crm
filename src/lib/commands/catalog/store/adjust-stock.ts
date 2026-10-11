import { isUuid } from "@/lib/search-params";
import { signedDelta } from "@/lib/store";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandPreview } from "../../types";
import { must } from "../db";
import { dbFail } from "../people/shared";

export const STOCK_REASONS = ["received", "waste", "adjustment", "returned"] as const;

const input = object({
  item_id: f.uuid("The product (its item_id, from store.products or store.low_stock)."),
  reason: f.enum(
    "received: stock arrived (adds). waste: thrown away or spoiled (takes away). returned: came back (adds). adjustment: a count correction, add or take away depending on the sign of the quantity.",
    STOCK_REASONS,
  ),
  quantity: f.integer("How many units. A whole number other than zero. For an adjustment, use a negative number to take stock away.", { min: -2000000000, max: 2000000000 }),
  doing: f.optional(f.string("Leave this out. (Screens use it to word their error messages.)", { max: 60 })),
});
export type AdjustStockInput = Infer<typeof input>;
export type AdjustStockData = { item: { id: string; name: string }; change: number; reason: string; now: number | null };

const DEFAULT_DOING = "adjust the stock";

/**
 * Add to or take from the stock of one store item. This is the existing stock path of Inventory: the app writes ONE movement row and
 * the database moves the count with it (trigger inventory_apply, 0017). It never writes the count itself (that applied a change twice or,
 * as a guarded update, never matched) and, since PR #128, a failure to read the new count back after the movement was recorded is NOT
 * an error: the change is saved, so failing would invite a retry that adjusts the stock a second time.
 */
export const adjustStock = defineCommand<AdjustStockInput, AdjustStockData>({
  key: "store.adjust_stock",
  title: "Adjust the stock of a store item",
  description:
    "Add to or take from the stock count of one store item that keeps a count: stock received, waste, returned goods, or a count correction (adjustment, negative to take away). " +
    "It records one stock movement and the count moves with it; it never sets the count directly. This asks the person to confirm first, showing the count before and after. " +
    "Find the item with store.products or store.low_stock. An item that does not keep a count can't be adjusted.",
  level: "confirm",
  permission: "storeManage",
  module: "store",
  // Off until the owner switches it on in the community's settings (assistant.tools.store.adjust_stock).
  enabledByDefault: false,
  covers: ["src/app/(app)/store/actions.ts#quickAdjustAction", "src/app/(app)/store/actions.ts#recordMovementAction"],
  input,
  async preview(ctx, inp): Promise<CommandPreview> {
    const { db, center } = ctx.session;
    const delta = signedDelta(inp.reason, inp.quantity);
    if (delta === 0) throw new CommandError(`Could not ${DEFAULT_DOING} — enter a quantity other than zero.`);
    const item = must(
      await db.from("store_items").select("name, stock_on_hand, track_inventory").eq("id", inp.item_id).eq("center_id", center.id).maybeSingle(),
      DEFAULT_DOING,
    ) as { name: string; stock_on_hand: number; track_inventory: boolean } | null;
    if (!item) throw new CommandError(`Could not ${DEFAULT_DOING} — that item no longer exists.`);
    if (!item.track_inventory) throw new CommandError(`Could not ${DEFAULT_DOING} — "${item.name}" does not track stock. Turn on "Track stock" on Menu & pickup first.`);
    const after = item.stock_on_hand + delta;
    const warnings = ["Niva only prepares this. Nothing changes until you press the button."];
    if (after < 0) warnings.push("This would take the count below zero. Check the quantity.");
    return {
      summary: `${delta > 0 ? "Add" : "Take"} ${Math.abs(delta)} ${delta > 0 ? "to" : "from"} the stock of "${item.name}" (${inp.reason}).`,
      lines: [
        { label: "Item", value: item.name },
        { label: "Reason", value: inp.reason },
        { label: "Change", value: `${delta > 0 ? "+" : ""}${delta}` },
        { label: "Stock on hand", before: String(item.stock_on_hand), after: String(after) },
      ],
      warnings,
    };
  },
  confirmText: "Yes, record the stock change",
  async execute(ctx, inp) {
    const { db, center, userId } = ctx.session;
    const doing = inp.doing?.trim() || DEFAULT_DOING;
    const itemId = inp.item_id;
    const delta = signedDelta(inp.reason, inp.quantity);
    if (!isUuid(itemId)) return { ok: false, error: `Could not ${doing} — choose the item.` };
    if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: `Could not ${doing} — enter a quantity other than zero.` };
    const item = await db.from("store_items").select("name, stock_on_hand, track_inventory").eq("id", itemId).eq("center_id", center.id).maybeSingle();
    if (item.error) return dbFail(`Could not ${doing}`, item.error);
    if (!item.data) return { ok: false, error: `Could not ${doing} — that item no longer exists.` };
    if (!item.data.track_inventory) return { ok: false, error: `Could not ${doing} — "${item.data.name}" does not track stock. Turn on "Track stock" on Menu & pickup first.` };
    const mv = await db.from("inventory_movements").insert({ center_id: center.id, item_id: itemId, delta, reason: inp.reason, recorded_by: userId });
    if (mv.error) return dbFail(`Could not ${doing}`, mv.error);
    revalidateAfterCommand(["/store", "/store/menu", "/store/orders"]);
    const change = `${delta > 0 ? "+" : ""}${delta}`;
    const ref = { id: itemId, name: item.data.name };
    const after = await db.from("store_items").select("stock_on_hand").eq("id", itemId).eq("center_id", center.id).maybeSingle();
    if (after.error || !after.data) {
      // The change is recorded and the count moved with it, so this is still a success: failing here would invite a retry
      // that adjusts the stock a second time.
      console.error("[store] stock adjusted, but the new count could not be read back:", after.error ?? "item not found");
      return { ok: true, data: { item: ref, change: delta, reason: inp.reason, now: null }, message: `Adjusted stock ${item.data.name} by ${change}. Refresh to see the new count.` };
    }
    return { ok: true, data: { item: ref, change: delta, reason: inp.reason, now: after.data.stock_on_hand }, message: `Adjusted stock ${item.data.name} by ${change} (now ${after.data.stock_on_hand})` };
  },
});
