// The sections of a workspace, as the left panel lists them (docs/CRM_NAV_REDESIGN_PLAN.md section 2). Pure: no React, no server-only
// imports, so the shell, the panel and the tests read the same thing.
//
// Nothing here decides who may see what. The lists are built from what visibleNav (permissions.ts) and givingTabs (Giving's own tab
// row) already return for this person, so a section appears exactly when its page could be opened before.

import { booksViewOrder } from "@/lib/books/views";
import { givingTabs, type GivingTab, type GivingTabKey, type TabContext } from "@/lib/giving-today/tabs";
import { pathUnder } from "@/lib/permissions";
import type { VisibleWorkspace, WorkspaceKey } from "@/lib/workspaces";

export type SectionItem = {
  key: string;
  label: string;
  href: string;
  /** Addresses that light this section (the longest match wins). */
  paths: string[];
  /** Views inside this section (Books), shown while the section is open. */
  children?: { label: string; href: string }[];
};

export type SectionGroup = {
  /** Null for a list with no heading. */
  title: string | null;
  items: SectionItem[];
};

export type WorkspaceSections = {
  key: WorkspaceKey;
  label: string;
  groups: SectionGroup[];
};

/** Giving's tabs, under the headings the panel gives them. A tab missing from this map goes under the last heading. */
const GIVING_GROUP: Record<GivingTabKey, string | null> = {
  today: null,
  pledges: "Money in",
  payments: "Money in",
  recurring: "Money in",
  proofs: "Money in",
  counts: "Money in",
  bank: "Bank and books",
  books: "Bank and books",
  campaigns: "Campaigns",
  labh: "Campaigns",
  bolis: "Campaigns",
  statements: "Donors and insights",
  insights: "Donors and insights",
  matching: "Donors and insights",
};
const GIVING_GROUP_ORDER: (string | null)[] = [null, "Money in", "Bank and books", "Campaigns", "Donors and insights"];

function givingGroups(tabs: readonly GivingTab[], booksViews: { label: string; href: string }[]): SectionGroup[] {
  const byTitle = new Map<string | null, SectionItem[]>();
  for (const t of tabs) {
    const title = t.key in GIVING_GROUP ? GIVING_GROUP[t.key] : "Donors and insights";
    const item: SectionItem = { key: t.key, label: t.label, href: t.href, paths: t.paths };
    if (t.key === "books" && booksViews.length >= 2) item.children = booksViews;
    byTitle.set(title, [...(byTitle.get(title) ?? []), item]);
  }
  return GIVING_GROUP_ORDER.flatMap((title) => (byTitle.has(title) ? [{ title, items: byTitle.get(title) ?? [] }] : []));
}

/**
 * A module's tabs under their headings, in the order the headings first appear. A tab with no group goes under the module's name when
 * the workspace holds several modules, and flat otherwise. A module that names no groups is one list, as it always was.
 */
function groupTabs(moduleLabel: string, several: boolean, tabs: readonly { href: string; label: string; group?: string }[]): SectionGroup[] {
  const order: (string | null)[] = [];
  const by = new Map<string | null, SectionItem[]>();
  for (const t of tabs) {
    const title = t.group ?? (several ? moduleLabel : null);
    if (!by.has(title)) {
      by.set(title, []);
      order.push(title);
    }
    by.get(title)?.push({ key: t.href, label: t.label, href: t.href, paths: [t.href] });
  }
  return order.map((title) => ({ title, items: by.get(title) ?? [] }));
}

/** The panel's lists for each workspace the person can open. */
export function sectionsFor(workspaces: readonly VisibleWorkspace[], ctx: TabContext): WorkspaceSections[] {
  return workspaces.map((w) => {
    if (w.key === "giving") {
      const tabs = givingTabs(ctx);
      const accounting = w.modules.find((m) => m.key === "accounting");
      const books = accounting ? booksViewOrder(accounting.tabs) : [];
      const groups = givingGroups(tabs, books);
      // A module the Giving row does not reach (Bolis for a person with no Giving) keeps its own heading, so nothing is lost.
      const covered = (prefix: string) => tabs.some((t) => t.paths.some((p) => pathUnder(prefix, p)));
      for (const m of w.modules) {
        if (m.key === "giving" || m.key === "accounting") continue;
        if (m.paths.every(covered)) continue;
        groups.push({ title: m.label, items: m.tabs.map((t) => ({ key: t.href, label: t.label, href: t.href, paths: [t.href] })) });
      }
      return { key: w.key, label: w.label, groups };
    }
    const several = w.modules.length > 1;
    const groups = w.modules.flatMap((m) => groupTabs(m.label, several, m.tabs));
    return { key: w.key, label: w.label, groups };
  });
}

/** How many sections a workspace lists (the panel is shown from two). */
export function sectionCount(groups: readonly SectionGroup[]): number {
  return groups.reduce((sum, g) => sum + g.items.length, 0);
}

/** The key of the section an address belongs to (the longest matching path wins), or null for a page outside the list. */
export function activeSectionKey(groups: readonly SectionGroup[], pathname: string): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const g of groups) {
    for (const item of g.items) {
      for (const p of item.paths) {
        // Today owns /giving itself only, not every page under it.
        const hit = p === "/giving" ? pathname === "/giving" : pathUnder(pathname, p);
        if (hit && p.length > bestLen) {
          best = item.key;
          bestLen = p.length;
        }
      }
    }
  }
  return best;
}

/** The view of an open section (Books) the address is on, if the section has views. */
export function activeChildHref(item: SectionItem, pathname: string): string | undefined {
  return (item.children ?? []).filter((c) => pathUnder(pathname, c.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
