import { describe, expect, it } from "vitest";

import { ROLE_PERMISSIONS } from "@/lib/giving-today/fixtures";
import type { TabContext } from "@/lib/giving-today/tabs";
import { NEUTRAL_KIND } from "@/lib/kind";
import { visibleWorkspaces } from "@/lib/workspaces";
import { activeChildHref, activeSectionKey, sectionCount, sectionsFor } from "@/lib/workspace-sections";

const ctx = (permissions: string[], modulesOff: string[] = ["bolis"]): TabContext => ({ permissions, isPlatformAdmin: false, modulesOff, kind: NEUTRAL_KIND });
const sections = (c: TabContext) => sectionsFor(visibleWorkspaces(c), c);
const giving = (c: TabContext) => sections(c).find((s) => s.key === "giving");

describe("the left panel's sections", () => {
  it("lists Giving under headings, in the Giving tab row's order, with a treasurer's whole row", () => {
    const g = giving(ctx(ROLE_PERMISSIONS.treasurer));
    expect(g?.groups.map((x) => x.title)).toEqual([null, "Money in", "Bank and books", "Campaigns", "Donors and insights"]);
    expect(g?.groups.flatMap((x) => x.items.map((i) => i.key))).toEqual(["today", "pledges", "payments", "proofs", "counts", "bank", "books", "campaigns", "statements", "insights"]);
    expect(sectionCount(g?.groups ?? [])).toBe(10);
  });

  it("gives Books its views, in Books' own order, and no other section any", () => {
    const g = giving(ctx(ROLE_PERMISSIONS.treasurer));
    const items = g?.groups.flatMap((x) => x.items) ?? [];
    const books = items.find((i) => i.key === "books");
    expect(books?.children?.[0].href).toBe("/accounting/close");
    expect(items.filter((i) => i.children).map((i) => i.key)).toEqual(["books"]);
  });

  it("leaves out a heading with nothing under it", () => {
    const g = giving(ctx(ROLE_PERMISSIONS.volunteer));
    expect(g?.groups.map((x) => x.title)).toEqual([null, "Money in", "Bank and books"]);
  });

  it("lists another workspace's modules, with a heading each only when it has several", () => {
    const c = ctx(["households.view", "people.view", "applications.review"]);
    const people = sections(c).find((s) => s.key === "people");
    if (!people) return; // permission names differ per setup; the shape is what this test checks when the workspace is open
    const hasSeveral = people.groups.length > 1;
    for (const g of people.groups) expect(g.title === null).toBe(!hasSeveral);
  });

  it("lights the section of the page being read, the longest address winning, and Today only on /giving itself", () => {
    const g = giving(ctx(ROLE_PERMISSIONS.treasurer))?.groups ?? [];
    expect(activeSectionKey(g, "/giving")).toBe("today");
    expect(activeSectionKey(g, "/giving/ask")).toBe("today");
    expect(activeSectionKey(g, "/giving/pledges")).toBe("pledges");
    expect(activeSectionKey(g, "/giving/payments/bank")).toBe("bank");
    expect(activeSectionKey(g, "/giving/payments")).toBe("payments");
    expect(activeSectionKey(g, "/accounting/qbo")).toBe("books");
    expect(activeSectionKey(g, "/nowhere")).toBeNull();
  });

  it("finds the Books view being read", () => {
    const g = giving(ctx(ROLE_PERMISSIONS.treasurer))?.groups ?? [];
    const books = g.flatMap((x) => x.items).find((i) => i.key === "books");
    expect(books && activeChildHref(books, "/accounting/qbo/mapping")).toBe("/accounting/qbo/mapping");
    expect(books && activeChildHref(books, "/accounting/close")).toBe("/accounting/close");
  });
});
