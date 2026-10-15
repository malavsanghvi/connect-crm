import type { Metadata } from "next";

import { kindTerm } from "@/lib/kind";
import { kindTitle } from "@/lib/kind-title";
import { param, type RawSearchParams } from "@/lib/search-params";

import { StoreMenuView } from "./menu-view";

export const generateMetadata = (): Promise<Metadata> => kindTitle((k) => `Menu & pickup · ${kindTerm(k, "store", "My Store")}`, "Menu & pickup · My Store");

/** Store › Menu & pickup: the store one section at a time (?section=). The view is shared with Store › Community Market (./menu-view). */
export default async function StoreMenuPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  return StoreMenuView({ requested: param(sp, "section"), path: "/store/menu", marketPage: false });
}
