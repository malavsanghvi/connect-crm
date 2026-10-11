import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { must } from "../db";

import { lowStockItems, type LowStockItem, type StockRow } from "./pure";

const input = object({
  limit: f.withDefault(f.integer("The most items to list (1 to 50), the furthest below their reorder level first.", { min: 1, max: 50 }), 20),
});

export type LowStockData = { low: number; items: LowStockItem[]; not_listed: number; notes: string[] };

const READ_MAX = 1000;

/** The store items that track stock and are below the level where they should be reordered. Reads only. */
export const lowStock = defineCommand<Infer<typeof input>, LowStockData>({
  key: "store.low_stock",
  title: "See which store items are running low",
  description:
    "The store items that keep a stock count and are below their reorder level: how many are in stock, the level to reorder at, and how far short each is, the furthest short first. " +
    "Items that do not track stock, and retired items, are not included. Use the item_id with store.adjust_stock after a delivery or a count. Read only: it changes no stock.",
  level: "read",
  permission: "store",
  module: "store",
  input,
  async execute(ctx, { limit }) {
    const { db, center } = ctx.session;
    const list = (must(
      await db
        .from("store_items")
        .select("id, name, sku, stock_on_hand, low_stock_threshold, track_inventory, status")
        .eq("center_id", center.id)
        .eq("track_inventory", true)
        .neq("status", "retired")
        .limit(READ_MAX),
      "read the store items",
    ) ?? []) as StockRow[];
    const low = lowStockItems(list);
    const notes: string[] = [];
    if (low.length === 0) notes.push("Nothing is below its reorder level.");
    if (list.length >= READ_MAX) notes.push(`Only the first ${READ_MAX} items were read; there may be more.`);
    return {
      ok: true,
      data: { low: low.length, items: low.slice(0, limit), not_listed: Math.max(0, low.length - limit), notes },
      message: low.length === 0 ? "Nothing is running low." : `${low.length} ${low.length === 1 ? "item is" : "items are"} below the reorder level.`,
    };
  },
});
