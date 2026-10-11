// The People workspace's household list, the pure part: filter the households by what the database told us, sort, take one page,
// and add up the open balances. The loader (load.ts) fetches; this decides. Nothing here reads or writes.

import type { HouseholdFilters } from "./ask";

export type BaseHousehold = { id: string; name: string; number: string | null; zoneId: string | null; city: string | null; tiers: string[] };

/** What the database answered for the filters that cannot be a simple column match. null = not asked (or not allowed). */
export type FilterSets = {
  /** Households the search found (by name, number or any identifier). */
  searchIds: Set<string> | null;
  /** Open balance by household, in cents. null when the role cannot see giving. */
  balances: Map<string, number> | null;
  /** Households with an RSVP in the asked year. */
  rsvpd: Set<string> | null;
  /** Households with an active membership ending within the asked days. */
  ending: Set<string> | null;
};

export const SORTS = ["name", "open", "area"] as const;
export type SortKey = (typeof SORTS)[number];

export function sortKey(v: string | undefined): SortKey {
  return (SORTS as readonly string[]).includes(v ?? "") ? (v as SortKey) : "name";
}

/**
 * The households that meet every filter. A filter whose answer is missing (`null` set) is not applied here; the loader says so
 * on the page in words, so a missing permission never looks like "no one matches".
 */
export function filterHouseholds(rows: readonly BaseHousehold[], f: HouseholdFilters, sets: FilterSets): BaseHousehold[] {
  return rows.filter((h) => {
    if (f.zone && h.zoneId !== f.zone) return false;
    if (f.tier && !h.tiers.includes(f.tier)) return false;
    if (f.q && sets.searchIds && !sets.searchIds.has(h.id)) return false;
    if (f.overCents !== null && sets.balances && (sets.balances.get(h.id) ?? 0) <= f.overCents) return false;
    if (f.noRsvpYear !== null && sets.rsvpd && sets.rsvpd.has(h.id)) return false;
    if (f.endingDays !== null && sets.ending && !sets.ending.has(h.id)) return false;
    return true;
  });
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function sortHouseholds(rows: readonly BaseHousehold[], sort: SortKey, ctx: { balances: Map<string, number> | null; zoneName: (id: string | null) => string | null }): BaseHousehold[] {
  const byName = (a: BaseHousehold, b: BaseHousehold) => collator.compare(a.name, b.name) || collator.compare(a.number ?? "", b.number ?? "");
  const area = (h: BaseHousehold) => ctx.zoneName(h.zoneId) ?? h.city ?? "";
  const list = [...rows];
  if (sort === "open" && ctx.balances) {
    const bal = ctx.balances;
    return list.sort((a, b) => (bal.get(b.id) ?? 0) - (bal.get(a.id) ?? 0) || byName(a, b));
  }
  if (sort === "area") return list.sort((a, b) => {
    const x = area(a);
    const y = area(b);
    // Households with no area go last.
    if (!x !== !y) return x ? -1 : 1;
    return collator.compare(x, y) || byName(a, b);
  });
  return list.sort(byName);
}

export type PageSlice<T> = { items: T[]; page: number; pages: number; from: number; to: number; total: number };

/** One page (1-based, clamped to the last page). `from`/`to` are 1-based positions for "Showing 26–50 of 112". */
export function pageOf<T>(rows: readonly T[], page: number, size: number): PageSlice<T> {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * size;
  const items = rows.slice(start, start + size);
  return { items, page: p, pages, from: items.length ? start + 1 : 0, to: start + items.length, total };
}

/** The open balance of these households together, in cents; null when balances are not visible. */
export function openTotal(rows: readonly BaseHousehold[], balances: Map<string, number> | null): number | null {
  if (!balances) return null;
  let t = 0;
  for (const h of rows) t += Math.max(0, balances.get(h.id) ?? 0);
  return t;
}

/** "Showing 7 of 17" / "Showing 26–50 of 112" / "" for an empty list. */
export function showingText(s: Pick<PageSlice<unknown>, "from" | "to" | "total">, locale = "en-US"): string {
  if (s.total === 0) return "";
  const n = (x: number) => x.toLocaleString(locale);
  if (s.from === 1 && s.to === s.total) return `Showing all ${n(s.total)}`;
  return s.from === 1 ? `Showing ${n(s.to)} of ${n(s.total)}` : `Showing ${n(s.from)}–${n(s.to)} of ${n(s.total)}`;
}
