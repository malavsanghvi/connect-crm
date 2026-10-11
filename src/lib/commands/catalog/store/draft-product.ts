import { formatCents, parseAmountToCents } from "@/lib/money";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError } from "../../types";
import { must } from "../db";

import { priceChange, type PriceChange } from "./pure";

const input = object({
  item_id: f.optional(f.uuid("An existing product, to prepare a price change for it (its item_id, from store.products). Leave it out to prepare a new product.")),
  name: f.optional(f.string("A new product's name, like 'Samosa pack'. Needed for a new product.", { max: 120 })),
  price: f.string("The price in dollars, like 8.99. For an existing product this is the new price.", { max: 20 }),
  pack_size: f.optional(f.string("A new product's pack size, like '6 pieces'.", { max: 60 })),
  sku: f.optional(f.string("A new product's SKU, if it has one.", { max: 60 })),
  track_stock: f.optional(f.boolean("Whether a new product keeps a stock count.")),
});
export type DraftProductInput = Infer<typeof input>;

export type DraftProductData = {
  kind: "new_product" | "price_change";
  /** Always false: nothing is written. */
  saved: false;
  summary: string;
  changes: { field: string; before: string | null; after: string }[];
  price?: PriceChange;
  warnings: string[];
  how_to_make_it_real: string;
};

const MENU = "Store > Menu & pickup";
const LARGE_CHANGE_PERCENT = 50;

/**
 * Prepare a new product or a price change and show it as before and after in dollars. It writes nothing: the person makes it real on
 * Menu & pickup. (Niva's own price-change command, store.change_price, is built but switched off until the owner approves it.)
 */
export const draftProduct = defineCommand<DraftProductInput, DraftProductData>({
  key: "store.draft_product",
  title: "Prepare a new store product or a price change",
  description:
    "Prepare, without saving anything, either a new store product (give name and price) or a price change for an existing product (give item_id and the new price): the card shows before and after in dollars, " +
    "the difference, and anything to check, such as a product that already has that name or a very large change. The price is in dollars, like 8.99. " +
    "It changes nothing and the person makes the change on Menu & pickup. Say plainly that nothing has been saved.",
  level: "draft",
  permission: "storeManage",
  module: "store",
  input,
  async execute(ctx, inp) {
    const { db, center } = ctx.session;
    const currency = center.currency;
    const cents = parseAmountToCents(inp.price);
    if (cents === null || cents < 0) throw new CommandError("Could not prepare the product — the price must be an amount like 8.99.");

    if (inp.item_id) {
      const item = must(
        await db.from("store_items").select("id, name, price_cents, status").eq("id", inp.item_id).eq("center_id", center.id).maybeSingle(),
        "look up the product",
      ) as { id: string; name: string; price_cents: number; status: string } | null;
      if (!item) throw new CommandError("Could not prepare the price change — that product was not found, or you can't see it.");
      const change = priceChange(item.price_cents, cents, currency);
      const warnings = ["Nothing has been saved. The price stays the same until a person changes it."];
      if (change.difference_cents === 0) warnings.push(`The new price is the same as the current price, ${change.before}.`);
      if (change.percent !== null && Math.abs(change.percent) >= LARGE_CHANGE_PERCENT) warnings.push(`That is a change of ${change.percent}%. Check the price is right.`);
      if (item.status === "retired") warnings.push("This product is retired, so members do not see it.");
      warnings.push("Orders already placed keep their price.");
      return {
        ok: true,
        data: {
          kind: "price_change",
          saved: false,
          summary: `Change the price of "${item.name}" from ${change.before} to ${change.after} (${change.difference}).`,
          changes: [{ field: "Price", before: change.before, after: change.after }],
          price: change,
          warnings,
          how_to_make_it_real: `Change it on ${MENU}. Changing a price through Niva is switched off until the owner approves it.`,
        },
        message: `Prepared a price change for "${item.name}": ${change.before} to ${change.after}. Nothing was saved.`,
      };
    }

    const name = (inp.name ?? "").trim();
    if (!name) throw new CommandError("Could not prepare the product — give it a name, or give the item_id of the product whose price should change.");
    const existing = (must(await db.from("store_items").select("id, name, sku, status").eq("center_id", center.id).limit(1000), "check the existing products") ?? []) as {
      id: string;
      name: string;
      sku: string | null;
      status: string;
    }[];
    const warnings = ["Nothing has been saved. The product is not on the menu until a person adds it."];
    const sameName = existing.find((i) => i.name.trim().toLowerCase() === name.toLowerCase());
    if (sameName) warnings.push(`A product called "${sameName.name}" already exists (${sameName.status}). Check this is not a duplicate.`);
    const sku = (inp.sku ?? "").trim();
    if (sku && existing.some((i) => (i.sku ?? "").toLowerCase() === sku.toLowerCase())) warnings.push(`The SKU ${sku} is already used by another product, and the store does not allow two.`);
    const price = formatCents(cents, currency);
    const changes: DraftProductData["changes"] = [
      { field: "Name", before: null, after: name },
      { field: "Price", before: null, after: price },
    ];
    if (inp.pack_size?.trim()) changes.push({ field: "Pack size", before: null, after: inp.pack_size.trim() });
    if (sku) changes.push({ field: "SKU", before: null, after: sku });
    if (inp.track_stock !== undefined) changes.push({ field: "Keeps a stock count", before: null, after: inp.track_stock ? "Yes" : "No" });
    return {
      ok: true,
      data: {
        kind: "new_product",
        saved: false,
        summary: `Add "${name}" to the menu at ${price}.`,
        changes,
        warnings,
        how_to_make_it_real: `Add it on ${MENU} (Add item).`,
      },
      message: `Prepared a new product, "${name}" at ${price}. Nothing was saved.`,
    };
  },
});
