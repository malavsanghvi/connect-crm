// A person's own saved views and pinned families, the pure part: what a saved view stores, how it is checked and turned back into the
// address of the list it opens, how names are cleaned and compared, how rows are ordered, and the limits. Nothing here reads or
// writes (the loader and the Server Actions do), and nothing here is specific to one kind of organization.
//
// Private to the person: a view or a pin belongs to the signed-in person and the community they are working in, and the database lets
// nobody else read it. A typed search (a name or an ID) is NOT saved: it can be a person's name (a child's, even), and a saved view is
// a work queue made of filters, not a place to keep names.

import { foldName } from "@/lib/commands/name-fold";
import { filtersFromParams, FILTER_PARAM, NO_FILTERS, paramsFromFilters, listHeading, type FilterKey, type HouseholdFilters } from "@/lib/people-v2/ask";
import { sortKey, type SortKey } from "@/lib/people-v2/list";
import { hrefWith } from "@/lib/search-params";

/** The caps the database also enforces (migration 0722: people_saved_limits). Keep the two in step. */
export const MAX_VIEWS = 30;
export const MAX_PINS = 40;
export const MAX_NAME = 60;

export type SavedList = "households" | "people";
const LISTS: readonly SavedList[] = ["households", "people"];
export const isSavedList = (v: unknown): v is SavedList => typeof v === "string" && (LISTS as readonly string[]).includes(v);

/** A saved view as the database holds it. `params` is the filters as URL values (see paramsFromFilters), never a typed search. */
export type SavedViewRow = {
  id: string;
  name: string;
  list: SavedList;
  params: Record<string, string>;
  sort: string | null;
  position: number;
  createdAt: string;
};

/** What the person asked to save: already cleaned and checked. */
export type ViewToSave = { name: string; list: SavedList; params: Record<string, string>; sort: SortKey | null };

export type Cleaned = { ok: true; name: string } | { ok: false; error: string };

/** A view's name as it will be stored: one line, single spaces, no control characters, 1 to 60 characters (counted as people see them). */
export function cleanViewName(raw: unknown): Cleaned {
  if (typeof raw !== "string") return { ok: false, error: "Give the view a name first." };
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  if (name === "") return { ok: false, error: "Give the view a name first." };
  if ([...name].length > MAX_NAME) return { ok: false, error: `Use ${MAX_NAME} characters or fewer for the name.` };
  return { ok: true, name };
}

/** Two names are the same view name when they read the same in any case, with or without accents, in any script. */
export function sameViewName(a: string, b: string): boolean {
  const x = foldName(a);
  return x !== "" && x === foldName(b);
}

/** Keys that never go into a saved view: a typed search can be a person's name. */
const NOT_SAVED: readonly FilterKey[] = ["q"];

/** The URL values of the filters that a view keeps (everything but the typed search). */
export function viewParams(filters: HouseholdFilters): Record<string, string> {
  const params = paramsFromFilters({ ...filters, ...Object.fromEntries(NOT_SAVED.map((k) => [k, null])) });
  return params;
}

/** The checked thing to store for the list the person is looking at, or the reason it cannot be saved. */
export function viewToSave(input: { name: unknown; list: unknown; params: unknown; sort: unknown }): { ok: true; view: ViewToSave } | { ok: false; error: string } {
  const name = cleanViewName(input.name);
  if (!name.ok) return name;
  if (!isSavedList(input.list)) return { ok: false, error: "That list cannot be saved as a view." };
  const raw = typeof input.params === "object" && input.params !== null && !Array.isArray(input.params) ? (input.params as Record<string, unknown>) : {};
  // Read the address values the way the page does (anything malformed is dropped), then keep only the saved keys.
  const strings: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v.length <= 200) strings[k] = v;
  const params = viewParams(filtersFromParams(strings));
  if (Object.keys(params).length === 0) return { ok: false, error: "There is no filter to save yet. Add a filter to the list, then save it." };
  const sort = typeof input.sort === "string" && input.sort !== "" ? sortKey(input.sort) : null;
  return { ok: true, view: { name: name.name, list: input.list, params, sort: sort === "name" ? null : sort } };
}

/** The filters of a stored view, read the way the page reads an address (so a stored value that is no longer valid is dropped). */
export function viewFilters(row: Pick<SavedViewRow, "params">): HouseholdFilters {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(row.params ?? {})) if (typeof v === "string") flat[k] = v;
  return { ...NO_FILTERS, ...filtersFromParams(flat), q: null };
}

/** Where a saved view opens: the same list workspace, with its filters in the address (so each one is a chip the person can remove). */
export function viewHref(row: Pick<SavedViewRow, "list" | "params" | "sort">): string {
  const params = viewParams(viewFilters(row));
  const sort = row.sort ? sortKey(row.sort) : "name";
  return hrefWith("/people", {}, { ...params, view: isSavedList(row.list) ? row.list : "households", ...(sort !== "name" ? { sort } : {}) });
}

/** What a view is called when the person has not typed a name yet: the list's own heading, else its chips in words. */
export function suggestedViewName(filters: HouseholdFilters, chipLabels: readonly string[]): string {
  const heading = listHeading(filters);
  const text = heading ?? chipLabels.filter(Boolean).join(", ");
  const cleaned = cleanViewName(text);
  if (cleaned.ok) return cleaned.name;
  const cut = cleanViewName([...text].slice(0, MAX_NAME).join(""));
  return cut.ok ? cut.name : "My view";
}

/** The order views and pins are shown in: by position, then when they were made, then id (so the order never flickers). */
export function inOrder<T extends { position: number; createdAt: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || (a.id < b.id ? -1 : 1));
}

/** The position a new view or pin takes: after every one the person already has. */
export function nextPosition(rows: readonly { position: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;
}

/** Why one more cannot be added, or null. Same words the database uses (the database is the one that enforces it). */
export function limitProblem(kind: "view" | "pin", count: number): string | null {
  if (kind === "view") return count >= MAX_VIEWS ? `You can keep up to ${MAX_VIEWS} saved views. Delete one you no longer use, then save this one.` : null;
  return count >= MAX_PINS ? `You can pin up to ${MAX_PINS} families. Unpin one you no longer need, then pin this one.` : null;
}

/** A pin as the database holds it. */
export type PinRow = { id: string; householdId: string; position: number; createdAt: string };

/** The param names the saved keys use, for the tests and the dev preview. */
export const SAVED_PARAM_NAMES: readonly string[] = (Object.keys(FILTER_PARAM) as FilterKey[]).filter((k) => !NOT_SAVED.includes(k)).map((k) => FILTER_PARAM[k]);
