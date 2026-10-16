import { describe, expect, it } from "vitest";

import { ROLE_PERMISSIONS } from "@/lib/giving-today/fixtures";
import type { TabContext } from "@/lib/giving-today/tabs";
import { NEUTRAL_KIND } from "@/lib/kind";
import { NAV } from "@/lib/permissions";
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

  it("lists a workspace of one module that names no groups as one flat list", () => {
    const c: TabContext = { ...ctx([]), isPlatformAdmin: true };
    const all = sections(c);
    // Reports is one module with no groups: one list, no heading.
    expect(all.find((s) => s.key === "reports")?.groups.map((g) => g.title)).toEqual([null]);
    expect(all.find((s) => s.key === "people")?.groups.map((g) => g.title)).toEqual([null]);
  });

  it("puts Settings, Content, Messages and the school under headings the tabs name, in the order they first appear", () => {
    const c: TabContext = { ...ctx([]), isPlatformAdmin: true };
    const all = sections(c);
    const titles = (key: string) => all.find((s) => s.key === key)?.groups.map((g) => g.title);
    expect(titles("settings")).toEqual(["Getting started", "Your organization", "Organization", "Roles and access", "Connections", "Money", "Messaging", "Data"]);
    expect(titles("content")).toEqual(["Review", "Daily life", "Library and media", "About us"]);
    expect(titles("messages")).toEqual(["Send", "Receive"]);
    expect(titles("learning")).toEqual(["Classes", "Teaching", "Admin"]);
    // Nothing is lost by grouping: every section the person could open before is still in the list, once.
    const settings = all.find((s) => s.key === "settings");
    const hrefs = settings?.groups.flatMap((g) => g.items.map((i) => i.href)) ?? [];
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain("/settings/payments");
    expect(hrefs).toContain("/setup/go-live");
  });

  it("every tab of a module that uses headings has one, so a new page cannot land loose at the top of the list", () => {
    for (const key of ["setup", "settings", "content", "comms", "pathshala"]) {
      const m = NAV.find((n) => n.key === key);
      expect(m, key).toBeTruthy();
      const loose = (m?.tabs ?? []).filter((t) => !t.group).map((t) => t.href);
      expect(loose, `tabs of "${key}" with no group (add group: "..." in permissions.ts)`).toEqual([]);
    }
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
