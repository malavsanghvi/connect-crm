import { ChipLinks } from "@/components/ui";
import { STORE_SECTION_LABELS, type StoreSection } from "@/lib/store-sections";

/** Where each section's tab goes, for a page: Menu & pickup and Inventory switch with ?section=, the Community Market also has its own page. */
export function sectionHrefs(path: "/store" | "/store/menu" | "/store/market"): Record<StoreSection, string> {
  if (path === "/store/market") return { food: "/store/menu", market: "/store/market" };
  return { food: path, market: `${path}?section=market` };
}

/**
 * The store's sections as a row of tabs under the page title (docs/STORE_SECTIONS.md). With one section it is a single clear heading,
 * "Food"; when the Community Market is on and holds something it sits beside it. The section is in the address, so the page can be
 * linked, reloaded and used with the back button. Food has no parameter: it is the store.
 */
export function StoreSectionBar({ hrefs, sections, current }: { hrefs: Record<StoreSection, string>; sections: StoreSection[]; current: StoreSection }) {
  return (
    <div className="mb-1">
      <p className="cc-section mb-1.5">Store section</p>
      <ChipLinks label="Store sections" active={current} items={sections.map((s) => ({ key: s, label: STORE_SECTION_LABELS[s], href: hrefs[s] }))} />
    </div>
  );
}
