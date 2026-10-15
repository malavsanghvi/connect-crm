import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  asStoreSection,
  currentSection,
  DEFAULT_STORE_SECTION,
  MARKET_STARTER_CATEGORIES,
  marketModuleOn,
  sectionCounts,
  sectionOpen,
  sectionSummary,
  sectionView,
  STORE_SECTION_LABELS,
  STORE_SECTIONS,
  visibleSections,
} from "@/lib/store-sections";

const food = (id: string) => ({ id, section: "food" });
const market = (id: string) => ({ id, section: "market" });
const ON = { marketOn: true };
const OFF = { marketOn: false };

describe("store sections: the keys", () => {
  it("are food and market, food first and the default", () => {
    expect([...STORE_SECTIONS]).toStrictEqual(["food", "market"]);
    expect(DEFAULT_STORE_SECTION).toBe("food");
  });

  it("never use the word Marketplace for the key (it names Weaver's catalog of paid products)", () => {
    expect([...STORE_SECTIONS].join(" ")).not.toMatch(/marketplace/i);
  });

  it("read a stored key and nothing else", () => {
    expect(asStoreSection("food")).toBe("food");
    expect(asStoreSection("market")).toBe("market");
    for (const bad of ["Food", "marketplace", "", " food", null, undefined, 1, {}]) expect(asStoreSection(bad), String(bad)).toBeNull();
  });

  it("have a plain label for each (the owner chose Community Market)", () => {
    expect(STORE_SECTION_LABELS.food).toBe("Food");
    expect(STORE_SECTION_LABELS.market).toBe("Community Market");
  });

  it("start the market with the owner's examples as categories", () => {
    expect([...MARKET_STARTER_CATEGORIES]).toStrictEqual(["Gifts", "Printing & books", "Personalised", "Services", "Community products"]);
  });
});

describe("store sections: is the Community Market on", () => {
  it("is off for every community until Weaver grants it, and fails closed when the module list could not be read", () => {
    expect(marketModuleOn({ modulesOff: ["market"], modulesStatus: "ok" })).toBe(false);
    expect(marketModuleOn({ modulesOff: [], modulesStatus: "ok" })).toBe(true);
    // The other modules fail open; the market is off for every kind by default, so it fails closed.
    expect(marketModuleOn({ modulesOff: [], modulesStatus: "error" })).toBe(false);
    expect(marketModuleOn({ modulesOff: [], modulesStatus: "missing" })).toBe(false);
    expect(marketModuleOn({ modulesOff: [] })).toBe(false);
  });

  it("is off while the Store is off, because the market lives in the store", () => {
    expect(marketModuleOn({ modulesOff: ["store"], modulesStatus: "ok" })).toBe(false);
  });

  it("opens Food always and the market only while it is on", () => {
    expect(sectionOpen("food", false)).toBe(true);
    expect(sectionOpen("food", true)).toBe(true);
    expect(sectionOpen("market", false)).toBe(false);
    expect(sectionOpen("market", true)).toBe(true);
  });
});

describe("store sections: which tabs a store shows", () => {
  it("shows only Food while the market is off, whatever the store holds (even market rows the database should be hiding)", () => {
    expect(visibleSections(sectionCounts([], []), OFF)).toStrictEqual(["food"]);
    expect(visibleSections(sectionCounts([food("c1")], [food("i1"), food("i2")]), OFF)).toStrictEqual(["food"]);
    expect(visibleSections(sectionCounts([market("c1")], [market("i1")]), OFF)).toStrictEqual(["food"]);
  });

  it("shows only Food while the market is on but holds nothing: no tab, no teaser", () => {
    expect(visibleSections(sectionCounts([food("c1")], [food("i1")]), ON)).toStrictEqual(["food"]);
  });

  it("shows the market beside Food when it is on and holds a category, or an item", () => {
    expect(visibleSections(sectionCounts([market("c1")], []), ON)).toStrictEqual(["food", "market"]);
    expect(visibleSections(sectionCounts([], [market("i1")]), ON)).toStrictEqual(["food", "market"]);
  });

  it("shows the market on its own page even while empty, so it can be started", () => {
    expect(visibleSections(sectionCounts([], []), { marketOn: true, openEmptyMarket: true })).toStrictEqual(["food", "market"]);
    // ... but never while the module is off
    expect(visibleSections(sectionCounts([], []), { marketOn: false, openEmptyMarket: true })).toStrictEqual(["food"]);
  });

  it("shows only the market to a person who runs only the market", () => {
    expect(visibleSections(sectionCounts([market("c1")], []), { marketOn: true, foodAllowed: false })).toStrictEqual(["market"]);
    expect(visibleSections(sectionCounts([], []), { marketOn: true, foodAllowed: false, openEmptyMarket: true })).toStrictEqual(["market"]);
  });

  it("ignores a row in a section this build does not know", () => {
    const counts = sectionCounts([{ section: "services" }], [{ section: "services" }]);
    expect(counts).toStrictEqual({ food: { categories: 0, items: 0 }, market: { categories: 0, items: 0 } });
    expect(visibleSections(counts, ON)).toStrictEqual(["food"]);
  });

  it("counts categories and items apart", () => {
    expect(sectionCounts([food("c1"), food("c2"), market("c3")], [food("i1"), market("i2"), market("i3")])).toStrictEqual({
      food: { categories: 2, items: 1 },
      market: { categories: 1, items: 2 },
    });
  });
});

describe("store sections: the section a page is on", () => {
  it("is the one asked for when it is shown, otherwise the first one shown", () => {
    expect(currentSection(undefined, ["food"])).toBe("food");
    expect(currentSection("food", ["food", "market"])).toBe("food");
    expect(currentSection("market", ["food", "market"])).toBe("market");
    // A link to a section that is not shown (no teaser, no empty tab) lands on Food.
    expect(currentSection("market", ["food"])).toBe("food");
    expect(currentSection("marketplace", ["food", "market"])).toBe("food");
    expect(currentSection("", ["food", "market"])).toBe("food");
    expect(currentSection(null, ["food", "market"])).toBe("food");
    // A person who runs only the market lands on the market.
    expect(currentSection("food", ["market"])).toBe("market");
    expect(currentSection(undefined, [])).toBe("food");
  });
});

describe("store sections: one section of the store", () => {
  const categories = [
    { id: "c-mithai", name: "Mithai", section: "food" },
    { id: "c-gifts", name: "Gifts", section: "market" },
  ];
  const items = [
    { id: "i-1", name: "Mohanthal", section: "food" },
    { id: "i-2", name: "Kaju katli", section: "food" },
    { id: "i-3", name: "Memory book printing", section: "market" },
  ];

  it("a store that has only ever had food is one section, Food, open, with everything in it", () => {
    const v = sectionView(categories.filter((c) => c.section === "food"), items.filter((i) => i.section === "food"), undefined, OFF);
    expect(v.sections).toStrictEqual(["food"]);
    expect(v.current).toBe("food");
    expect(v.label).toBe("Food");
    expect(v.open).toBe(true);
    expect(v.marketEmpty).toBe(false);
    expect(v.categories.map((c) => c.id)).toStrictEqual(["c-mithai"]);
    expect(v.items.map((i) => i.id)).toStrictEqual(["i-1", "i-2"]);
    expect(sectionSummary(v.counts.food)).toBe("2 items in 1 category");
  });

  it("asking for the market of a store that does not have it draws Food, and never an empty market", () => {
    const off = sectionView(categories, items, "market", OFF);
    expect(off.sections).toStrictEqual(["food"]);
    expect(off.current).toBe("food");
    expect(off.items.map((i) => i.id)).toStrictEqual(["i-1", "i-2"]);
    const emptyOn = sectionView(categories.slice(0, 1), items.slice(0, 2), "market", ON);
    expect(emptyOn.sections).toStrictEqual(["food"]);
    expect(emptyOn.current).toBe("food");
    expect(emptyOn.marketEmpty).toBe(true);
  });

  it("a store with the market on and market rows draws one section at a time, and the market is open for new rows", () => {
    const foodView = sectionView(categories, items, undefined, ON);
    expect(foodView.sections).toStrictEqual(["food", "market"]);
    expect(foodView.items.map((i) => i.id)).toStrictEqual(["i-1", "i-2"]);
    const marketView = sectionView(categories, items, "market", ON);
    expect(marketView.current).toBe("market");
    expect(marketView.label).toBe("Community Market");
    expect(marketView.open).toBe(true);
    expect(marketView.marketEmpty).toBe(false);
    expect(marketView.categories.map((c) => c.id)).toStrictEqual(["c-gifts"]);
    expect(marketView.items.map((i) => i.id)).toStrictEqual(["i-3"]);
  });

  it("the market's own page of an empty market is the market, empty, ready to be started", () => {
    const v = sectionView([], [], "market", { marketOn: true, openEmptyMarket: true });
    expect(v.sections).toStrictEqual(["food", "market"]);
    expect(v.current).toBe("market");
    expect(v.marketEmpty).toBe(true);
    expect(v.open).toBe(true);
    expect(sectionSummary(v.counts.market)).toBe("0 items in 0 categories");
  });

  it("says counts in plain words", () => {
    expect(sectionSummary({ categories: 3, items: 9 })).toBe("9 items in 3 categories");
    expect(sectionSummary({ categories: 1, items: 1 })).toBe("1 item in 1 category");
  });
});

describe("store sections: the tabs", () => {
  it("draw Food alone as one tab with no parameter, and the second beside it when there is one", async () => {
    const { StoreSectionBar, sectionHrefs } = await import("@/app/(app)/store/section-bar");
    const one = renderToStaticMarkup(createElement(StoreSectionBar, { hrefs: sectionHrefs("/store/menu"), sections: ["food"], current: "food" }));
    expect(one).toContain("Store section");
    expect(one).toContain(">Food<");
    expect(one).toContain('href="/store/menu"');
    expect(one).toContain('aria-current="page"');
    expect(one).not.toMatch(/market/i);
    expect(one).not.toMatch(/soon/i);

    const two = renderToStaticMarkup(createElement(StoreSectionBar, { hrefs: sectionHrefs("/store"), sections: ["food", "market"], current: "market" }));
    expect(two).toContain(">Food<");
    expect(two).toContain(">Community Market<");
    expect(two).toContain('href="/store"');
    expect(two).toContain('href="/store?section=market"');
    // Only the section the page is on is marked as the current page.
    expect(two.match(/aria-current="page"/g)).toHaveLength(1);

    // The Community Market's own page: its tab is that page, and Food goes back to Menu & pickup.
    const own = renderToStaticMarkup(createElement(StoreSectionBar, { hrefs: sectionHrefs("/store/market"), sections: ["food", "market"], current: "market" }));
    expect(own).toContain('href="/store/menu"');
    expect(own).toContain('href="/store/market"');
    expect(own).not.toContain("section=market");
  });
});
