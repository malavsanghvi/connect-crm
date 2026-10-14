import { parseAmountToCents } from "@/lib/money";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type AnyCommand, type CommandPreview } from "../../types";
import { must } from "../db";
import { dbFail } from "../people/shared";

import { priceChange } from "./pure";

const input = object({
  item_id: f.uuid("The product (its item_id, from store.products)."),
  price: f.string("The new price in the community's currency, like 8.99.", { max: 20 }),
});
export type ChangePriceInput = Infer<typeof input>;
export type ChangePriceData = { item: { id: string; name: string }; before_cents: number; after_cents: number; before: string; after: string };

/** Said whenever the command is used while the owner has not approved it. */
export const PRICE_CHANGE_NOT_APPROVED =
  "Changing a price with Niva is switched off until the owner approves it. Prepare the change with Niva (store.draft_product), then change the price on Store > Menu & pickup.";

/**
 * Change one product's price. BUILT BUT SWITCHED OFF: a price is a money rule, so this command refuses every use until the owner
 * approves it (NEEDS OWNER OK in the pull request). `ownerApproved` is false in the catalog; the tests build the approved version to prove
 * that the code behind the switch works. To turn it on, the owner decides, then the catalog line in ./index.ts passes `true` (and
 * the community still has to tick the command in Platform > Niva for admins, like every confirm command).
 */
export function makeChangePrice(opts: { ownerApproved: boolean }): AnyCommand {
  return defineCommand<ChangePriceInput, ChangePriceData>({
    key: "store.change_price",
    title: "Change a store item's price (not available yet)",
    description:
      "Change the price of one store product to a new amount in the community's currency (like 8.99); the card shows before and after. SWITCHED OFF until the owner approves price changes through Niva: do not offer it. " +
      "Use store.draft_product to prepare a price change instead, and tell the person to change the price on Menu & pickup. This asks the person to confirm first and needs store.manage. Orders already placed keep their price.",
    level: "confirm",
    permission: "storeManage",
    module: "store",
    // Off until the owner approves it AND the community ticks it (assistant.tools.store.change_price).
    enabledByDefault: false,
    input,
    async preview(ctx, inp): Promise<CommandPreview> {
      if (!opts.ownerApproved) throw new CommandError(PRICE_CHANGE_NOT_APPROVED);
      const { db, center } = ctx.session;
      const cents = parseAmountToCents(inp.price);
      if (cents === null || cents < 0) throw new CommandError("Could not change the price — the price must be an amount like 8.99.");
      const item = must(await db.from("store_items").select("id, name, price_cents").eq("id", inp.item_id).eq("center_id", center.id).maybeSingle(), "look up the product") as {
        id: string;
        name: string;
        price_cents: number;
      } | null;
      if (!item) throw new CommandError("Could not change the price — that product was not found, or you can't see it.");
      const change = priceChange(item.price_cents, cents, center.currency);
      const warnings = ["Orders already placed keep their price.", "Niva only prepares this. Nothing changes until you press the button."];
      if (change.difference_cents === 0) warnings.unshift(`The new price is the same as the current price, ${change.before}.`);
      return {
        summary: `Change the price of "${item.name}" from ${change.before} to ${change.after} (${change.difference}).`,
        lines: [
          { label: "Item", value: item.name },
          { label: "Price", before: change.before, after: change.after },
          { label: "Difference", value: change.percent === null ? change.difference : `${change.difference} (${change.percent}%)` },
        ],
        warnings,
      };
    },
    confirmText: "Yes, change the price",
    async execute(ctx, inp) {
      if (!opts.ownerApproved) return { ok: false, error: PRICE_CHANGE_NOT_APPROVED };
      const { db, center } = ctx.session;
      const doing = "change the price";
      const cents = parseAmountToCents(inp.price);
      if (cents === null || cents < 0) return { ok: false, error: `Could not ${doing} — the price must be an amount like 8.99.` };
      const item = await db.from("store_items").select("id, name, price_cents").eq("id", inp.item_id).eq("center_id", center.id).maybeSingle();
      if (item.error) return dbFail(`Could not ${doing}`, item.error);
      if (!item.data) return { ok: false, error: `Could not ${doing} — that product was not found, or you can't see it.` };
      const beforeCents = item.data.price_cents;
      const { data, error } = await db.from("store_items").update({ price_cents: cents }).eq("id", inp.item_id).eq("center_id", center.id).select("id");
      if (error) return dbFail(`Could not ${doing}`, error);
      if (!data?.length) return { ok: false, error: `Could not ${doing} — nothing was saved. The product may have been removed, or you can't change it.` };
      revalidateAfterCommand(["/store", "/store/menu", "/store/orders"]);
      const change = priceChange(beforeCents, cents, center.currency);
      return {
        ok: true,
        data: { item: { id: item.data.id, name: item.data.name }, before_cents: change.before_cents, after_cents: change.after_cents, before: change.before, after: change.after },
        message: `"${item.data.name}" is now ${change.after} (it was ${change.before}).`,
      };
    },
  });
}

/** The catalog's version: built, and switched off until the owner approves (see the pull request: NEEDS OWNER OK). */
export const changePrice = makeChangePrice({ ownerApproved: false });
