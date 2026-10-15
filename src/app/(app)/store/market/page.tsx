import type { Metadata } from "next";

import { kindTerm } from "@/lib/kind";
import { kindTitle } from "@/lib/kind-title";

import { StoreMenuView } from "../menu/menu-view";

export const generateMetadata = (): Promise<Metadata> => kindTitle((k) => `Community Market · ${kindTerm(k, "store", "My Store")}`, "Community Market · My Store");

/**
 * Store › Community Market (0830): the community's own products and services in the store's second section, and their categories. The
 * page always opens while Weaver has granted the market to this community, so the first category can be added; the same section also
 * appears as a tab on Menu & pickup once it holds something. Docs: docs/STORE_MARKETPLACE.md.
 */
export default async function CommunityMarketPage() {
  return StoreMenuView({ requested: "market", path: "/store/market", marketPage: true });
}
