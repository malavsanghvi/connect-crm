// Turns a command's result (any shape the server cleaned and sent) into something the panel can show without knowing each command:
// household cards, a few facts, and small tables. Money is shown in dollars, never as raw cents. Nothing is added or inferred
// beyond what arrived: the child filter and the secret stripper already ran on the server.

import { formatCents } from "@/lib/money";

export type HouseholdCardView = {
  household_id: string;
  household_name: string | null;
  household_number: string | null;
  org_household_id: string | null;
  /** Adults only. The card never shows anyone else. */
  adults: string[];
  primary_adult: string | null;
  zone: string | null;
  city: string | null;
  last_gift_on: string | null;
  /** Open pledges in dollars, ready to show. */
  open_pledge: string | null;
};

export type ResultFact = { label: string; value: string };
export type ResultLink = { label: string; href: string };
export type ResultTable = {
  title: string;
  columns: { key: string; label: string }[];
  rows: { cells: Record<string, string>; links: ResultLink[] }[];
  more: number;
};
export type ResultHousehold = { card: HouseholdCardView; facts: ResultFact[] };

export type ResultView = {
  notes: string[];
  facts: ResultFact[];
  households: ResultHousehold[];
  tables: ResultTable[];
};

const MAX_ROWS = 10;
const MAX_COLUMNS = 5;
const NOTE_KEYS = new Set(["basis", "message", "note", "notes", "summary"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** "households_behind" becomes "Households behind". */
export function humanize(key: string): string {
  const s = key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A key that is only plumbing (ids, raw cents), never shown to a person. Cents are shown as dollars by their own sibling or below. */
function isHiddenKey(key: string): boolean {
  return key === "id" || key.endsWith("_id") || key.endsWith("Id") || key.endsWith("_ids");
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  return "";
}

/** Reads a household card as the command layer sends it (adults only). Null when it is not one. */
export function asHouseholdCard(v: unknown): HouseholdCardView | null {
  if (!isObject(v)) return null;
  const id = str(v.household_id);
  if (!id || !Array.isArray(v.adults)) return null;
  const cents = typeof v.open_pledge_cents === "number" ? v.open_pledge_cents : null;
  return {
    household_id: id,
    household_name: str(v.household_name),
    household_number: str(v.household_number),
    org_household_id: str(v.org_household_id),
    adults: v.adults.filter((a): a is string => typeof a === "string"),
    primary_adult: str(v.primary_adult),
    zone: str(v.zone),
    city: str(v.city),
    last_gift_on: str(v.last_gift_on),
    open_pledge: str(v.open_pledge) ?? (cents !== null ? formatCents(cents) : null),
  };
}

/** A non-empty list of plain values ("matched on name, phone"). */
function isScalarList(v: unknown): v is (string | number | boolean)[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean");
}

function asLinks(v: unknown): ResultLink[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const links: ResultLink[] = [];
  for (const x of v) {
    if (!isObject(x) || typeof x.label !== "string" || typeof x.href !== "string") return null;
    // Only places inside the portal.
    if (!x.href.startsWith("/") || x.href.startsWith("//")) return null;
    links.push({ label: x.label, href: x.href });
  }
  return links;
}

/** The scalar fields of one object as labelled facts. Raw cents become dollars unless a formatted sibling already exists. */
function factsOf(obj: Record<string, unknown>, skip: Set<string> = new Set()): ResultFact[] {
  const facts: ResultFact[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (skip.has(key) || NOTE_KEYS.has(key)) continue;
    if (isScalarList(value)) {
      if (!isHiddenKey(key)) facts.push({ label: humanize(key), value: formatValue(value) });
      continue;
    }
    if (Array.isArray(value) || isObject(value)) continue;
    if (key.endsWith("_cents")) {
      const base = key.slice(0, -"_cents".length);
      if (base in obj) continue; // a formatted sibling ("open" beside "open_cents") is shown instead
      if (typeof value === "number") facts.push({ label: humanize(base), value: formatCents(value) });
      continue;
    }
    if (isHiddenKey(key)) continue;
    facts.push({ label: humanize(key), value: formatValue(value) });
  }
  return facts;
}

function tableOf(title: string, items: unknown[]): ResultTable | null {
  const objects = items.filter(isObject);
  if (objects.length === 0) return null;
  const shown = objects.slice(0, MAX_ROWS);
  // Columns: the plain fields of the first rows, in order, up to a handful.
  const columns: { key: string; label: string }[] = [];
  for (const row of shown) {
    for (const [key, value] of Object.entries(row)) {
      if (columns.length >= MAX_COLUMNS) break;
      if (Array.isArray(value) || isObject(value) || isHiddenKey(key)) continue;
      if (key.endsWith("_cents") && key.slice(0, -6) in row) continue;
      if (columns.some((c) => c.key === key)) continue;
      columns.push({ key, label: key.endsWith("_cents") ? humanize(key.slice(0, -6)) : humanize(key) });
    }
  }
  if (columns.length === 0) return null;
  const rows = shown.map((row) => {
    const cells: Record<string, string> = {};
    for (const c of columns) {
      const v = row[c.key];
      cells[c.key] = c.key.endsWith("_cents") && typeof v === "number" ? formatCents(v) : formatValue(v);
    }
    const links = Object.values(row).map(asLinks).find((l) => l !== null) ?? [];
    return { cells, links };
  });
  return { title, columns, rows, more: Math.max(0, objects.length - shown.length) };
}

/** A list whose items each carry a household card, with the other plain fields of the item as facts. */
function householdsOf(items: unknown[]): ResultHousehold[] | null {
  const out: ResultHousehold[] = [];
  for (const item of items) {
    if (!isObject(item)) return null;
    const own = asHouseholdCard(item);
    if (own) {
      out.push({ card: own, facts: [] });
      continue;
    }
    const entry = Object.entries(item).find(([, v]) => asHouseholdCard(v) !== null);
    if (!entry) return null;
    const card = asHouseholdCard(entry[1]);
    if (!card) return null;
    out.push({ card, facts: factsOf(item, new Set([entry[0]])) });
  }
  return out.length > 0 ? out : null;
}

/** Describe any result for display. */
export function describeResult(data: unknown): ResultView {
  const view: ResultView = { notes: [], facts: [], households: [], tables: [] };
  if (data === null || data === undefined) return view;

  const single = asHouseholdCard(data);
  if (single) {
    view.households.push({ card: single, facts: [] });
    return view;
  }
  if (Array.isArray(data)) {
    const hh = householdsOf(data);
    if (hh) view.households.push(...hh.slice(0, MAX_ROWS));
    else {
      const t = tableOf("Results", data);
      if (t) view.tables.push(t);
      else if (data.length > 0) view.facts.push({ label: "Results", value: formatValue(data) });
    }
    return view;
  }
  if (!isObject(data)) {
    view.facts.push({ label: "Result", value: formatValue(data) });
    return view;
  }

  view.facts.push(...factsOf(data));
  for (const key of NOTE_KEYS) {
    const note = str(data[key]);
    if (note) view.notes.push(note);
  }
  for (const [key, value] of Object.entries(data)) {
    if (isHiddenKey(key)) continue;
    const card = asHouseholdCard(value);
    if (card) {
      view.households.push({ card, facts: [] });
      continue;
    }
    if (!Array.isArray(value) || value.length === 0 || isScalarList(value)) continue;
    const hh = householdsOf(value);
    if (hh) {
      view.households.push(...hh.slice(0, MAX_ROWS));
      continue;
    }
    const t = tableOf(humanize(key), value);
    if (t) view.tables.push(t);
    else view.facts.push({ label: humanize(key), value: formatValue(value) });
  }
  return view;
}

/** True when there is nothing to draw (the caller then says "Nothing to show"). */
export function isEmptyView(view: ResultView): boolean {
  return view.notes.length === 0 && view.facts.length === 0 && view.households.length === 0 && view.tables.length === 0;
}

/** "2026-03-05" as "Mar 5, 2026" (read as a calendar date, so no time zone can move it a day). Anything else is shown as it came. */
export function friendlyDate(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The small print under a household card's names: zone, city, last gift, open pledges. */
export function householdFacts(card: HouseholdCardView): string[] {
  const facts = [card.zone ? `${card.zone} zone` : "No zone", card.city ?? "No city"];
  facts.push(`Last gift ${friendlyDate(card.last_gift_on) ?? "never"}`);
  if (card.open_pledge) facts.push(`Open pledges ${card.open_pledge}`);
  return facts;
}
