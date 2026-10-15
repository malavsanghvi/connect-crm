import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  asStoreSection,
  currentSection,
  DEFAULT_STORE_SECTION,
  sectionCounts,
  sectionSummary,
  sectionView,
  STORE_SECTION_LABELS,
  STORE_SECTION_OPEN,
  STORE_SECTIONS,
  visibleSections,
} from "@/lib/store-sections";

const food = (id: string) => ({ id, section: "food" });
const market = (id: string) => ({ id, section: "market" });

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

  it("have a plain label for each, and only Food is open for new rows until the market is built", () => {
    expect(STORE_SECTION_LABELS.food).toBe("Food");
    expect(STORE_SECTION_LABELS.market).toBe("Community Market");
    expect(STORE_SECTION_OPEN).toStrictEqual({ food: true, market: false });
  });
});

describe("store sections: which tabs a store shows", () => {
  it("shows only Food while the market holds nothing, however many food rows there are (or none)", () => {
    expect(visibleSections(sectionCounts([], []))).toStrictEqual(["food"]);
    expect(visibleSections(sectionCounts([food("c1"), food("c2")], [food("i1"), food("i2"), food("i3")]))).toStrictEqual(["food"]);
  });

  it("shows the market beside Food as soon as it holds a category, or an item", () => {
    expect(visibleSections(sectionCounts([market("c1")], []))).toStrictEqual(["food", "market"]);
    expect(visibleSections(sectionCounts([], [market("i1")]))).toStrictEqual(["food", "market"]);
  });

  it("shows Food even when only the market holds anything", () => {
    expect(visibleSections(sectionCounts([market("c1")], [market("i1")]))).toStrictEqual(["food", "market"]);
  });

  it("ignores a row in a section this build does not know", () => {
    const counts = sectionCounts([{ section: "services" }], [{ section: "services" }]);
    expect(counts).toStrictEqual({ food: { categories: 0, items: 0 }, market: { categories: 0, items: 0 } });
    expect(visibleSections(counts)).toStrictEqual(["food"]);
  });

  it("counts categories and items apart", () => {
    expect(sectionCounts([food("c1"), food("c2"), market("c3")], [food("i1"), market("i2"), market("i3")])).toStrictEqual({
      food: { categories: 2, items: 1 },
      market: { categories: 1, items: 2 },
    });
  });
});

describe("store sections: the section a page is on", () => {
  it("is the one asked for when it is shown, otherwise Food", () => {
    expect(currentSection(undefined, ["food"])).toBe("food");
    expect(currentSection("food", ["food", "market"])).toBe("food");
    expect(currentSection("market", ["food", "market"])).toBe("market");
    // A link to a section that is not shown (no teaser, no empty tab) lands on Food.
    expect(currentSection("market", ["food"])).toBe("food");
    expect(currentSection("marketplace", ["food", "market"])).toBe("food");
    expect(currentSection("", ["food", "market"])).toBe("food");
    expect(currentSection(null, ["food", "market"])).toBe("food");
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
    { id: "i-3", name: "Memory book", section: "market" },
  ];

  it("a store that has only ever had food is one section, Food, open, with everything in it", () => {
    const v = sectionView(categories.filter((c) => c.section === "food"), items.filter((i) => i.section === "food"), undefined);
    expect(v.sections).toStrictEqual(["food"]);
    expect(v.current).toBe("food");
    expect(v.label).toBe("Food");
    expect(v.open).toBe(true);
    expect(v.categories.map((c) => c.id)).toStrictEqual(["c-mithai"]);
    expect(v.items.map((i) => i.id)).toStrictEqual(["i-1", "i-2"]);
    expect(sectionSummary(v.counts.food)).toBe("2 items in 1 category");
  });

  it("asking for the market of a store that has none draws Food, and never an empty market", () => {
    const foodOnly = sectionView(categories.slice(0, 1), items.slice(0, 2), "market");
    expect(foodOnly.sections).toStrictEqual(["food"]);
    expect(foodOnly.current).toBe("food");
    expect(foodOnly.items).toHaveLength(2);
  });

  it("a store with market rows draws one section at a time, and the market is not open for new rows", () => {
    const foodView = sectionView(categories, items, undefined);
    expect(foodView.sections).toStrictEqual(["food", "market"]);
    expect(foodView.items.map((i) => i.id)).toStrictEqual(["i-1", "i-2"]);
    const marketView = sectionView(categories, items, "market");
    expect(marketView.current).toBe("market");
    expect(marketView.label).toBe("Community Market");
    expect(marketView.open).toBe(false);
    expect(marketView.categories.map((c) => c.id)).toStrictEqual(["c-gifts"]);
    expect(marketView.items.map((i) => i.id)).toStrictEqual(["i-3"]);
  });

  it("says counts in plain words", () => {
    expect(sectionSummary({ categories: 3, items: 9 })).toBe("9 items in 3 categories");
    expect(sectionSummary({ categories: 1, items: 1 })).toBe("1 item in 1 category");
    expect(sectionSummary({ categories: 0, items: 0 })).toBe("0 items in 0 categories");
  });
});

describe("store sections: the tabs", () => {
  it("draw Food alone as one tab with no parameter, and the second beside it when there is one", async () => {
    const { StoreSectionBar } = await import("@/app/(app)/store/section-bar");
    const one = renderToStaticMarkup(createElement(StoreSectionBar, { path: "/store/menu", sections: ["food"], current: "food" }));
    expect(one).toContain("Store section");
    expect(one).toContain(">Food<");
    expect(one).toContain('href="/store/menu"');
    expect(one).toContain('aria-current="page"');
    expect(one).not.toMatch(/market/i);
    expect(one).not.toMatch(/soon/i);

    const two = renderToStaticMarkup(createElement(StoreSectionBar, { path: "/store", sections: ["food", "market"], current: "market" }));
    expect(two).toContain(">Food<");
    expect(two).toContain(">Community Market<");
    expect(two).toContain('href="/store"');
    expect(two).toContain('href="/store?section=market"');
    // Only the section the page is on is marked as the current page.
    expect(two.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
