// Store sections (migration 0821, docs/STORE_SECTIONS.md): the store is organised in sections above its categories.
//
//   food    what the store sells today (every category and item that existed when sections arrived is in it)
//   market  the Community Market: products and services other people offer inside the store (NOT BUILT)
//
// The keys are permanent and are what the database stores; the labels are copy and can change at any time. The second key is "market",
// not "marketplace", because "Marketplace" already names Weaver's catalog of paid products (Settings › Marketplace).
//
// Claim only what is built: the portal shows Food, always, and a second section only when it holds something. Nothing in the portal
// creates a market row yet (STORE_SECTION_OPEN), so nobody sees a Marketplace tab, teaser or "coming soon".

export const STORE_SECTIONS = ["food", "market"] as const;
export type StoreSection = (typeof STORE_SECTIONS)[number];

/** Where everything that existed before sections lives, and where a form that names no section writes. */
export const DEFAULT_STORE_SECTION: StoreSection = "food";

/** What a person reads. Copy, not a key: the Community Market's name is the owner's to choose (docs/STORE_MARKETPLACE.md). */
export const STORE_SECTION_LABELS: Record<StoreSection, string> = {
  food: "Food",
  market: "Community Market",
};

/**
 * Whether the portal may add new categories and items to a section. The Community Market has no listings, sellers or rules yet, and an
 * installed member app that does not group by section would show a market row among the food, so this stays false until the market is
 * built and the member app reads sections. A server action refuses to write a row in a section that is not open.
 */
export const STORE_SECTION_OPEN: Record<StoreSection, boolean> = {
  food: true,
  market: false,
};

/** A stored section key, or null for anything else (a future key, a typo, nothing). */
export function asStoreSection(value: unknown): StoreSection | null {
  return typeof value === "string" && (STORE_SECTIONS as readonly string[]).includes(value) ? (value as StoreSection) : null;
}

export type SectionCounts = Record<StoreSection, { categories: number; items: number }>;

type HasSection = { section: string };

/** How many categories and items each section holds. A row in a section this build does not know is counted nowhere. */
export function sectionCounts(categories: readonly HasSection[], items: readonly HasSection[]): SectionCounts {
  const counts: SectionCounts = { food: { categories: 0, items: 0 }, market: { categories: 0, items: 0 } };
  for (const c of categories) {
    const s = asStoreSection(c.section);
    if (s) counts[s].categories += 1;
  }
  for (const i of items) {
    const s = asStoreSection(i.section);
    if (s) counts[s].items += 1;
  }
  return counts;
}

/**
 * The sections the portal shows, in order. Food is always there (it is the store). Any other section appears only when it holds a
 * category or an item: "the second section appears only when there is something to put in it". This is the one switch; the market's
 * build replaces the count test with its own rule.
 */
export function visibleSections(counts: SectionCounts): StoreSection[] {
  return STORE_SECTIONS.filter((s) => s === DEFAULT_STORE_SECTION || counts[s].categories + counts[s].items > 0);
}

/** The section a page is on: the one asked for if it is shown, otherwise Food. */
export function currentSection(requested: string | undefined | null, visible: readonly StoreSection[]): StoreSection {
  const asked = asStoreSection(requested);
  return asked && visible.includes(asked) ? asked : DEFAULT_STORE_SECTION;
}

export type SectionView<C extends HasSection, I extends HasSection> = {
  /** The sections to draw as tabs: Food, and a second only when it holds something. */
  sections: StoreSection[];
  current: StoreSection;
  label: string;
  /** Whether new categories and items may be added in the current section. */
  open: boolean;
  categories: C[];
  items: I[];
  counts: SectionCounts;
};

/** Everything a store page needs to draw one section: which tabs, which one is on, and its categories and items. */
export function sectionView<C extends HasSection, I extends HasSection>(
  categories: readonly C[],
  items: readonly I[],
  requested: string | undefined | null,
): SectionView<C, I> {
  const counts = sectionCounts(categories, items);
  const sections = visibleSections(counts);
  const current = currentSection(requested, sections);
  return {
    sections,
    current,
    label: STORE_SECTION_LABELS[current],
    open: STORE_SECTION_OPEN[current],
    categories: categories.filter((c) => c.section === current),
    items: items.filter((i) => i.section === current),
    counts,
  };
}

/** "9 items in 3 categories" for the card under the tabs. */
export function sectionSummary(counts: { categories: number; items: number }): string {
  const items = `${counts.items} ${counts.items === 1 ? "item" : "items"}`;
  const categories = `${counts.categories} ${counts.categories === 1 ? "category" : "categories"}`;
  return `${items} in ${categories}`;
}
