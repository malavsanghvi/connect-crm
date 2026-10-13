// What the find box draws for one answer, and what its keys do. Pure, so the top-bar box, the People home box and the tests agree.
//
// A question goes to Niva when Niva is on. When Niva is off the same words are offered as a list only if the page's own rule-based
// reader (src/lib/people-v2/ask.ts) understood them, and otherwise the box says so plainly. Nothing about a child is ever put in
// text that goes to Niva: only the typed words are handed over, never a result row.

import { givingEnter, type FindScope, type GivingRow } from "./giving";
import type { Classified, EnterAction, FindFilter, FindResponse, FindRow, NivaState, UiRow } from "./types";

/** Where a family opens. With a person, the family page opens that person's details over it (the family page reads `person`). */
export function familyHref(householdId: string, personId?: string | null): string {
  return personId ? `/households/${householdId}?person=${personId}` : `/households/${householdId}`;
}

/** A person's row opens their family with their details open; a person in no household opens on their own page. */
export function personHref(personId: string, householdId: string | null): string {
  return householdId ? familyHref(householdId, personId) : `/people/${personId}`;
}

const KIND_WORDS: Record<Classified["kind"], string> = {
  name: "a name",
  email: "an email address",
  phone: "a phone number",
  identifier: "an ID or number",
  question: "a question",
  filter: "a list of families",
};

/** The one line "I understood: …" above the rows. */
export function understoodLine(kind: Classified["kind"], shape: Classified["shape"], families: number, people: number, list?: FindFilter["list"]): string {
  // A sentence about contact gaps or ages is a list of people (adults), not of families.
  const what = kind === "identifier" && shape === "payer" ? "a name or bank payer name" : kind === "filter" && list === "people" ? "a list of people" : KIND_WORDS[kind];
  const counts: string[] = [];
  if (families > 0) counts.push(`${families} ${families === 1 ? "family" : "families"}`);
  if (people > 0) counts.push(`${people} ${people === 1 ? "person" : "people"}`);
  return counts.length > 0 ? `${what} · ${counts.join(" and ")}` : what;
}

function filterRow(filter: FindFilter): UiRow {
  return { type: "filter", key: "filter", filter };
}

function recordRows(rows: readonly FindRow[], scope: FindScope): UiRow[] {
  // In Giving a child is never named (D2, docs/GIVING_REDESIGN.md section 7): their "Child · staff only" rows are left out there.
  return rows
    .filter((row) => scope !== "giving" || row.kind !== "person" || !row.child)
    .map((row) => (row.kind === "family" ? { type: "family" as const, key: `f-${row.id}`, row } : { type: "person" as const, key: `p-${row.id}`, row }));
}

function givingRows(rows: readonly GivingRow[]): UiRow[] {
  return rows.map((row) => ({ type: "giving" as const, key: `g-${row.key}`, row }));
}

export const NIVA_OFF_TEXT = "Niva is off; try a name or number.";
export const NIVA_NO_KEY_TEXT = "Niva is on but has no AI key connected, so it cannot answer questions yet; try a name or number.";

/**
 * The rows for one answer. `shape` is how the typed text was read (a payer name, a code…), only for the sentence above the rows.
 * `niva` decides what a question does. `withPalette` adds the last row that opens the command palette (only where it exists).
 * The Giving lane's rows (`resp.giving`) go first when the text was about money or a number only Giving has, else below the families.
 */
export function buildUiRows(
  resp: FindResponse,
  { niva, withPalette = false, shape = null, scope = "people" }: { niva: NivaState; withPalette?: boolean; shape?: Classified["shape"]; scope?: FindScope },
): { understood: string; rows: UiRow[] } {
  const families = resp.rows.filter((r) => r.kind === "family").length;
  const people = resp.rows.length - families;
  const giving = resp.giving ?? null;
  const givingFirst = !!giving && giving.first;
  const understood = givingFirst ? giving.understood : understoodLine(resp.kind, shape, families, people, resp.filter?.list);
  const lane: UiRow[] = giving
    ? [...givingRows(giving.rows), ...giving.notes.map((text, i) => ({ type: "message" as const, key: `g-note-${i}`, text, tone: "plain" as const }))]
    : [];
  const rows: UiRow[] = [];

  if (resp.kind === "question") {
    if (niva === "on") rows.push({ type: "niva", key: "niva", text: resp.query });
    if (resp.filter) rows.push(filterRow(resp.filter));
    if (niva === "no_key") rows.push({ type: "message", key: "no-niva", text: NIVA_NO_KEY_TEXT, tone: "plain" });
    if (niva === "off" && !resp.filter) rows.push({ type: "message", key: "no-niva", text: NIVA_OFF_TEXT, tone: "plain" });
  } else {
    if (givingFirst) rows.push(...lane);
    if (resp.kind === "filter" && resp.filter) rows.push(filterRow(resp.filter));
    rows.push(...recordRows(resp.rows, scope));
    if (!givingFirst) rows.push(...lane);
    if (resp.problem) rows.push({ type: "message", key: "problem", text: resp.problem, tone: "problem" });
    if (resp.rows.length === 0 && lane.length === 0 && !resp.problem && !(resp.kind === "filter" && resp.filter)) {
      rows.push({ type: "message", key: "none", text: `No family or person matches “${resp.query}”.`, tone: "plain" });
      if (niva === "on") rows.push({ type: "niva", key: "niva", text: resp.query });
    }
    if (resp.more > 0) rows.push({ type: "message", key: "more", text: `${resp.more} more matched. Type a little more to narrow it down.`, tone: "plain" });
  }
  if (withPalette && niva !== "off") rows.push({ type: "palette", key: "palette", text: resp.query });
  return { understood, rows };
}

/** The rows a person can move to with the arrow keys: everything except the explanatory lines. */
export function selectable(rows: readonly UiRow[]): UiRow[] {
  return rows.filter((r) => r.type !== "message");
}

/** The next highlighted row for an arrow key; it wraps round. `current` is -1 when nothing is highlighted. */
export function moveActive(current: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return current < 0 || current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}

/**
 * What Enter does on the highlighted row (the first selectable row when none is highlighted). Shift+Enter asks Niva instead. On Giving
 * pages (`scope` "giving") a family, or an adult's family, opens its giving in place. A Giving row opens a sheet or a list: never a save.
 */
export function enterAction(
  rows: readonly UiRow[],
  active: number,
  { shift = false, niva = "off", typed = "", scope = "people" }: { shift?: boolean; niva?: NivaState; typed?: string; scope?: FindScope } = {},
): EnterAction {
  if (shift) return niva === "on" && typed.trim() ? { type: "niva", text: typed.trim() } : { type: "none" };
  const items = selectable(rows);
  const row = items[active >= 0 ? active : 0];
  if (!row) return { type: "none" };
  switch (row.type) {
    case "family":
      return scope === "giving"
        ? { type: "family-giving", householdId: row.row.id, focus: null, href: row.row.href }
        : { type: "open", href: row.row.href, familyId: row.row.id };
    case "person":
      return scope === "giving" && row.row.householdId && !row.row.child
        ? { type: "family-giving", householdId: row.row.householdId, focus: null, href: row.row.href }
        : { type: "open", href: row.row.href, familyId: row.row.householdId };
    case "giving": {
      const act = givingEnter(row.row);
      return act.type === "open" ? { type: "open", href: act.href, familyId: null } : act;
    }
    case "filter":
      return { type: "open", href: row.filter.href, familyId: null };
    case "niva":
      return { type: "niva", text: row.text };
    case "palette":
      return { type: "palette", text: row.text };
    default:
      return { type: "none" };
  }
}
