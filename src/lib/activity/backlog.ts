// Platform › Automation backlog: the rows of app.automation_backlog (0623) and how the screen sorts them.
// The view holds keys and counts across the communities that have recording on, nothing else: no community, no role, no
// person, no event. Pure functions, no server imports.

/** One row of app.automation_backlog (every column can be null in the generated type; a row without a key is dropped). */
export type BacklogRow = {
  item_key: string | null;
  label: string | null;
  surface: string | null;
  communities: number | null;
  ideas: number | null;
  times: number | null;
  minutes_per_month: number | null;
  last_seen: string | null;
};

export type BacklogItem = {
  key: string;
  label: string;
  surface: "portal" | "member";
  communities: number;
  ideas: number;
  times: number;
  minutesPerMonth: number;
  lastSeen: string | null;
};

export const BACKLOG_SORTS = ["minutes", "communities", "ideas", "times", "name", "seen"] as const;
export type BacklogSort = (typeof BACKLOG_SORTS)[number];
export type SortDirection = "asc" | "desc";

export const DEFAULT_BACKLOG_SORT: { sort: BacklogSort; dir: SortDirection } = { sort: "minutes", dir: "desc" };

/** What the first click on a column does: the number columns start with the most, the name with A to Z. */
export const FIRST_DIRECTION: Record<BacklogSort, SortDirection> = {
  minutes: "desc",
  communities: "desc",
  ideas: "desc",
  times: "desc",
  name: "asc",
  seen: "desc",
};

export function parseBacklogSort(sort: string | undefined, dir: string | undefined): { sort: BacklogSort; dir: SortDirection } {
  const s = (BACKLOG_SORTS as readonly string[]).includes(sort ?? "") ? (sort as BacklogSort) : DEFAULT_BACKLOG_SORT.sort;
  const d: SortDirection = dir === "asc" || dir === "desc" ? dir : s === DEFAULT_BACKLOG_SORT.sort ? DEFAULT_BACKLOG_SORT.dir : FIRST_DIRECTION[s];
  return { sort: s, dir: d };
}

/** A key with no label becomes its last part in words ("giving.record_payment" -> "Record payment"). */
function keyInWords(key: string): string {
  const words = key.replace(/^screen:\/?/, "").split(/[./]/).pop()?.replace(/[_-]+/g, " ").replace(/[[\]]/g, "").trim() ?? "";
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

export function backlogItems(rows: readonly BacklogRow[] | null | undefined): BacklogItem[] {
  const items: BacklogItem[] = [];
  for (const r of rows ?? []) {
    if (!r.item_key) continue;
    items.push({
      key: r.item_key,
      label: r.label?.trim() || keyInWords(r.item_key),
      surface: r.surface === "member" ? "member" : "portal",
      communities: Number(r.communities) || 0,
      ideas: Number(r.ideas) || 0,
      times: Number(r.times) || 0,
      minutesPerMonth: Number(r.minutes_per_month) || 0,
      lastSeen: r.last_seen,
    });
  }
  return items;
}

const VALUE: Record<Exclude<BacklogSort, "name" | "seen">, (i: BacklogItem) => number> = {
  minutes: (i) => i.minutesPerMonth,
  communities: (i) => i.communities,
  ideas: (i) => i.ideas,
  times: (i) => i.times,
};

/** A sorted copy. Ties fall back to the most minutes, then the name, so the order is the same every time. */
export function sortBacklog(items: readonly BacklogItem[], sort: BacklogSort, dir: SortDirection): BacklogItem[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: BacklogItem, b: BacklogItem) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
  return [...items].sort((a, b) => {
    let c = 0;
    if (sort === "name") c = byName(a, b);
    else if (sort === "seen") c = (a.lastSeen ? Date.parse(a.lastSeen) : 0) - (b.lastSeen ? Date.parse(b.lastSeen) : 0);
    else c = VALUE[sort](a) - VALUE[sort](b);
    if (c !== 0) return c * sign;
    return b.minutesPerMonth - a.minutesPerMonth || byName(a, b);
  });
}

/** The direction a click on a column's heading asks for: the other way when it is already the sort, else its first direction. */
export function nextDirection(current: { sort: BacklogSort; dir: SortDirection }, clicked: BacklogSort): SortDirection {
  if (current.sort === clicked) return current.dir === "asc" ? "desc" : "asc";
  return FIRST_DIRECTION[clicked];
}
