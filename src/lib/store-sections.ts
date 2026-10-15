// Store sections (migrations 0821 and 0830, docs/STORE_SECTIONS.md, docs/STORE_MARKETPLACE.md): the store is organised in sections
// above its categories.
//
//   food    what the store sells today (every category and item that existed when sections arrived is in it)
//   market  the Community Market: the community's own non-food products and services, a Marketplace product (module `market`).
//           Slice 1 is the community's own listings only: no seller applications, no new tables, no money.
//
// The keys are permanent and are what the database stores; the labels are copy and can change at any time. The second key is "market",
// not "marketplace", because "Marketplace" already names Weaver's catalog of paid products (Settings › Marketplace).
//
// Claim only what is built: the portal shows Food, always, and the Community Market only while the community has the module on AND
// the section holds a category or an item (or the person has opened the market's own page, which starts it). A community that does
// not have the module sees no tab, no teaser and no "coming soon", and the database hides any market row from it (0830).

import { isModuleEnabled, type ModuleContext } from "@/lib/modules";

export const STORE_SECTIONS = ["food", "market"] as const;
export type StoreSection = (typeof STORE_SECTIONS)[number];

/** Where everything that existed before sections lives, and where a form that names no section writes. */
export const DEFAULT_STORE_SECTION: StoreSection = "food";

/** What a person reads. Copy, not a key: the Community Market's name was chosen by the owner (docs/STORE_MARKETPLACE.md CM1). */
export const STORE_SECTION_LABELS: Record<StoreSection, string> = {
  food: "Food",
  market: "Community Market",
};

/**
 * The starter set of categories offered when a community starts its Community Market (docs/STORE_MARKETPLACE.md section 6): the owner's
 * examples (memories book printing, laser engraving, gift articles, community products). Suggestions the community edits or removes,
 * not fixtures; the same for every kind of organization in this slice.
 */
export const MARKET_STARTER_CATEGORIES: readonly string[] = ["Gifts", "Printing & books", "Personalised", "Services", "Community products"];

/**
 * Is the Community Market on for this community: granted by Weaver (0740), not paused, and its Store on. Fails closed: the market is off
 * for every kind until granted, so when the module list could not be read it is NOT shown (the opposite of the other modules).
 */
export function marketModuleOn(ctx: ModuleContext & { modulesStatus?: string }): boolean {
  return ctx.modulesStatus === "ok" && isModuleEnabled(ctx, "market");
}

/** A stored section key, or null for anything else (a future key, a typo, nothing). */
export function asStoreSection(value: unknown): StoreSection | null {
  return typeof value === "string" && (STORE_SECTIONS as readonly string[]).includes(value) ? (value as StoreSection) : null;
}

/** May new categories and items be added to a section: Food always; the Community Market only while its module is on. */
export function sectionOpen(section: StoreSection, marketOn: boolean): boolean {
  return section === "market" ? marketOn : true;
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

export type SectionOptions = {
  /** The Community Market module is on for this community (marketModuleOn). */
  marketOn: boolean;
  /** The person may use the Food section (store.view or store.manage). False for someone who runs only the market. Default true. */
  foodAllowed?: boolean;
  /** The person opened the market's own page: show the market even while it holds nothing yet, so it can be started. */
  openEmptyMarket?: boolean;
};

/**
 * The sections the portal shows, in order. Food is always there for a person who may use it (it is the store). The Community Market
 * appears only while its module is on and it holds a category or an item ("the second section appears only when there is something to
 * put in it"), or when the person opened the market's own page. This is the one switch.
 */
export function visibleSections(counts: SectionCounts, opt: SectionOptions): StoreSection[] {
  const out: StoreSection[] = [];
  if (opt.foodAllowed !== false) out.push("food");
  if (opt.marketOn && (counts.market.categories + counts.market.items > 0 || opt.openEmptyMarket)) out.push("market");
  return out;
}

/** The section a page is on: the one asked for if it is shown, otherwise the first one shown (Food), otherwise Food. */
export function currentSection(requested: string | undefined | null, visible: readonly StoreSection[]): StoreSection {
  const asked = asStoreSection(requested);
  if (asked && visible.includes(asked)) return asked;
  return visible[0] ?? DEFAULT_STORE_SECTION;
}

export type SectionView<C extends HasSection, I extends HasSection> = {
  /** The sections to draw as tabs. */
  sections: StoreSection[];
  current: StoreSection;
  label: string;
  /** Whether new categories and items may be added in the current section. */
  open: boolean;
  /** The market is on and holds nothing yet: the page offers to start it (to a person who may). */
  marketEmpty: boolean;
  categories: C[];
  items: I[];
  counts: SectionCounts;
};

/** Everything a store page needs to draw one section: which tabs, which one is on, and its categories and items. */
export function sectionView<C extends HasSection, I extends HasSection>(
  categories: readonly C[],
  items: readonly I[],
  requested: string | undefined | null,
  opt: SectionOptions,
): SectionView<C, I> {
  const counts = sectionCounts(categories, items);
  const sections = visibleSections(counts, opt);
  const current = currentSection(requested, sections);
  return {
    sections,
    current,
    label: STORE_SECTION_LABELS[current],
    open: sectionOpen(current, opt.marketOn),
    marketEmpty: opt.marketOn && counts.market.categories + counts.market.items === 0,
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
