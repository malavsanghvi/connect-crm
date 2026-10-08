import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PRODUCT_MENU, RESOURCES_MENU, SOLUTIONS_MENU } from "@/components/site/header";
import { WEAVERS } from "@/components/site/weavers";

// The home page is one long page; the header, the footer and the buttons on the page jump to places on it. These tests
// keep every such jump pointing at an id that exists (a section that is merged or renamed must take its links along).
const source = readFileSync(join(process.cwd(), "src/app/site/page.tsx"), "utf8");

/** The ids the home page defines: written out in the markup, plus the Weaver cards and the "Also included" items. */
function homePageIds(): Set<string> {
  const ids = new Set<string>();
  for (const m of source.matchAll(/\bid="([a-z][a-z0-9-]*)"/g)) ids.add(m[1]);
  for (const w of WEAVERS) ids.add(w.id);
  const alsoIncluded = source.slice(source.indexOf("const ALSO_INCLUDED"), source.indexOf("function Product()"));
  for (const m of alsoIncluded.matchAll(/\bid: "([a-z][a-z0-9-]*)"/g)) ids.add(m[1]);
  return ids;
}

describe("the home page's in-page links", () => {
  const ids = homePageIds();

  it("has an id for each of its sections", () => {
    for (const id of ["weavers", "product", "raise", "get-ready", "free", "security", "faq"]) expect(ids.has(id)).toBe(true);
  });

  it("every menu link to /#something lands on an id that exists on the home page", () => {
    const links = [...PRODUCT_MENU, ...SOLUTIONS_MENU, ...RESOURCES_MENU].map((i) => i.to).filter((to) => to.startsWith("/#"));
    expect(links.length).toBeGreaterThan(0);
    for (const to of links) expect(ids.has(to.slice(2)), `${to} has no matching id on the home page`).toBe(true);
  });

  it("every /#something written in the page itself lands on an id that exists", () => {
    for (const m of source.matchAll(/to="\/#([a-z][a-z0-9-]*)"/g)) expect(ids.has(m[1]), `/#${m[1]}`).toBe(true);
  });

  it("the menus have no two entries with the same title (the title is the React key)", () => {
    for (const menu of [PRODUCT_MENU, SOLUTIONS_MENU, RESOURCES_MENU]) expect(new Set(menu.map((i) => i.title)).size).toBe(menu.length);
  });
});
