// The Store commands (B90 phase 4). The reads and the draft are on for everyone whose role allows them; the confirm-level ones (mark an
// order ready, adjust stock) are registered but OFF for Niva until the owner switches each on (assistant.tools.<key>). Marking an order
// ready sends the member the existing 'Your order is ready' notice, and its card says so. There is NO refund command, and
// store.change_price is built but switched off until the owner approves price changes through Niva. The Server Actions in
// src/app/(app)/store run the same `execute` (order moves and stock), so a screen, the ⌘K palette and Niva share one code path.

import type { AnyCommand } from "../../types";

import { adjustStock } from "./adjust-stock";
import { changePrice } from "./change-price";
import { draftProduct } from "./draft-product";
import { lowStock } from "./low-stock";
import { ordersWaiting } from "./orders-waiting";
import { products } from "./products";
import { salesSummary } from "./sales-summary";
import { setOrderStatus } from "./set-order-status";

export { adjustStock, changePrice, setOrderStatus };

/** In the order a person would meet them: look, prepare, then change. */
export const STORE_COMMANDS: readonly AnyCommand[] = [
  // read
  ordersWaiting,
  lowStock,
  salesSummary,
  products,
  // draft (writes nothing)
  draftProduct,
  // confirm (off by default)
  setOrderStatus,
  adjustStock,
  changePrice,
];
