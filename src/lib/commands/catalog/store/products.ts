import { formatCents } from "@/lib/money";
import { isLowStock } from "@/lib/store";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { must } from "../db";

type ItemRow = {
  id: string;
  name: string;
  sku: string | null;
  price_cents: number;
  pack_size: string | null;
  status: string;
  taxable: boolean;
  gift_pack: boolean;
  track_inventory: boolean;
  stock_on_hand: number;
  low_stock_threshold: number | null;
  category_id: string | null;
};

export type ProductsData = {
  count: number;
  items: {
    item_id: string;
    name: string;
    sku: string | null;
    price_cents: number;
    price: string;
    pack_size: string | null;
    status: string;
    category: string | null;
    taxable: boolean;
    gift_pack_available: boolean;
    tracks_stock: boolean;
    in_stock: number | null;
    below_reorder_level: boolean;
  }[];
  not_listed: number;
  notes: string[];
};

const input = object({
  status: f.withDefault(f.enum("active: on sale. paused: hidden for now. retired: taken off the menu. all: every item.", ["active", "paused", "retired", "all"] as const), "active"),
  search: f.optional(f.string("Part of a name or SKU to look for, like 'samosa'.", { max: 80 })),
  limit: f.withDefault(f.integer("The most items to list (1 to 50).", { min: 1, max: 50 }), 25),
});

const READ_MAX = 1000;

/** The store's products with their prices in the community's currency (the cents are in price_cents). Reads only. */
export const products = defineCommand<Infer<typeof input>, ProductsData>({
  key: "store.products",
  title: "See the store products and prices",
  description:
    "The store's products: name, SKU, price in the community's currency (price_cents has the cents), pack size, whether it is on sale, its category, whether it is sold gift packed, and the stock on hand for items that keep a count. " +
    "Use the item_id with store.draft_product (to prepare a price change) or store.adjust_stock. Read only: it changes no product.",
  level: "read",
  permission: "store",
  module: "store",
  input,
  async execute(ctx, { status, search, limit }) {
    const { db, center } = ctx.session;
    let q = db
      .from("store_items")
      .select("id, name, sku, price_cents, pack_size, status, taxable, gift_pack, track_inventory, stock_on_hand, low_stock_threshold, category_id")
      .eq("center_id", center.id);
    if (status !== "all") q = q.eq("status", status);
    const list = (must(await q.order("name").limit(READ_MAX), "read the store products") ?? []) as ItemRow[];
    const cats = (must(await db.from("store_categories").select("id, name").eq("center_id", center.id), "read the categories") ?? []) as { id: string; name: string }[];
    const category = new Map(cats.map((c) => [c.id, c.name]));
    const needle = (search ?? "").trim().toLowerCase();
    const matching = (needle ? list.filter((i) => i.name.toLowerCase().includes(needle) || (i.sku ?? "").toLowerCase().includes(needle)) : list).sort((a, b) => a.name.localeCompare(b.name));
    const notes: string[] = [];
    if (matching.length === 0) notes.push(needle ? "No product matches." : "There are no products here.");
    if (list.length >= READ_MAX) notes.push(`Only the first ${READ_MAX} products were read; there may be more.`);
    return {
      ok: true,
      data: {
        count: matching.length,
        items: matching.slice(0, limit).map((i) => ({
          item_id: i.id,
          name: i.name,
          sku: i.sku,
          price_cents: i.price_cents,
          price: formatCents(i.price_cents, center.currency),
          pack_size: i.pack_size,
          status: i.status,
          category: i.category_id ? (category.get(i.category_id) ?? null) : null,
          taxable: i.taxable,
          gift_pack_available: i.gift_pack,
          tracks_stock: i.track_inventory,
          in_stock: i.track_inventory ? i.stock_on_hand : null,
          below_reorder_level: isLowStock(i),
        })),
        not_listed: Math.max(0, matching.length - limit),
        notes,
      },
      message: `${matching.length} ${matching.length === 1 ? "product" : "products"}.`,
    };
  },
});
