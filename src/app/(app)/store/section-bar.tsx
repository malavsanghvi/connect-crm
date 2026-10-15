import { ChipLinks } from "@/components/ui";
import { DEFAULT_STORE_SECTION, STORE_SECTION_LABELS, type StoreSection } from "@/lib/store-sections";

/**
 * The store's sections as a row of tabs under the page title (docs/STORE_SECTIONS.md). With one section it is a single clear heading,
 * "Food"; when a second section holds something it sits beside it. The section is in the address (?section=), so the page can be
 * linked, reloaded and used with the back button. Food has no parameter: it is the store.
 */
export function StoreSectionBar({ path, sections, current }: { path: string; sections: StoreSection[]; current: StoreSection }) {
  return (
    <div className="mb-1">
      <p className="cc-section mb-1.5">Store section</p>
      <ChipLinks
        label="Store sections"
        active={current}
        items={sections.map((s) => ({
          key: s,
          label: STORE_SECTION_LABELS[s],
          href: s === DEFAULT_STORE_SECTION ? path : `${path}?section=${s}`,
        }))}
      />
    </div>
  );
}
