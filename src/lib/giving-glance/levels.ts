// "Giving at a glance": whose giving the panel shows. Pure.
//
// Pledges and payments belong to a HOUSEHOLD. A person is attached only through pledges.pledged_by_person_id and
// payments.payer_person_id, and either can be empty. So a community chooses how it reads giving (Settings > Rules > "Show giving by"):
// by household (the default, and what an unset setting means) or by person. By person the household's giving is split into one part
// per ADULT plus a part that is "Not tied to a person": gifts with no named giver, and anything recorded under someone who is not
// one of the adults shown (a child is never listed or named, so what is recorded under a child falls here). The parts always add up
// to the household's total.

import type { GlanceWindow } from "./period";
import { paidBetween, periodTotals, type GlanceRows } from "./summary";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type GivingShowBy = "household" | "person";

export const SHOW_BY_OPTIONS: { value: GivingShowBy; label: string; note: string }[] = [
  { value: "household", label: "Household", note: "Everyone in the household together" },
  { value: "person", label: "Person", note: "Each adult, plus gifts not tied to a person" },
];

/** The community's choice; the household when nothing (or anything unreadable) is set. */
export function givingShowBy(rules: unknown): GivingShowBy {
  const giving = isRecord(rules) ? rules.giving : undefined;
  return isRecord(giving) && giving.show_by === "person" ? "person" : "household";
}

/** Problems with the stored setting, in plain words (for the rules checker); none when it is unset. */
export function givingRuleProblems(giving: unknown): string[] {
  if (giving === undefined || giving === null) return [];
  if (!isRecord(giving)) return [`"giving" must be an object.`];
  const v = giving.show_by;
  if (v === undefined || v === null || v === "household" || v === "person") return [];
  return [`"giving.show_by" must be "household" or "person".`];
}

export type GlanceScope = { kind: "household" } | { kind: "person"; personId: string } | { kind: "rest" };

/** The scope an address asks for (?giving_for=<person id> or none). Anything that is not an adult of this household is the whole household. */
export function parseGlanceScope(raw: string | string[] | undefined | null, adultIds: ReadonlySet<string>): GlanceScope {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (v === "none") return { kind: "rest" };
  if (v && adultIds.has(v)) return { kind: "person", personId: v };
  return { kind: "household" };
}

export function scopeParam(scope: GlanceScope): string | null {
  return scope.kind === "person" ? scope.personId : scope.kind === "rest" ? "none" : null;
}

const inRest = (personId: string | null, adultIds: ReadonlySet<string>): boolean => personId === null || !adultIds.has(personId);

/** The rows that belong to a scope. `adultIds` are the household's adults (the ones listed). */
export function scopeRows(rows: GlanceRows, scope: GlanceScope, adultIds: ReadonlySet<string>): GlanceRows {
  if (scope.kind === "household") return rows;
  const keep = (personId: string | null) => (scope.kind === "person" ? personId === scope.personId : inRest(personId, adultIds));
  return {
    pledges: rows.pledges.filter((p) => keep(p.person_id)),
    payments: rows.payments.filter((p) => keep(p.person_id)),
    recurring: rows.recurring.filter((r) => keep(r.person_id)),
  };
}

export type ChooserPart = { paidCents: number; pledgedCents: number };
export type Chooser = {
  everyone: ChooserPart;
  people: ({ id: string; name: string } & ChooserPart)[];
  /** "Not tied to a person". */
  rest: ChooserPart;
};

function part(rows: GlanceRows, window: GlanceWindow): ChooserPart {
  return { paidCents: paidBetween(rows.payments, window.from, window.to), pledgedCents: periodTotals(rows, window.from, window.to).pledgedCents };
}

/** What each adult, and the rest, gave in the period. `everyone` is always the sum of the others. */
export function chooserParts(rows: GlanceRows, adults: { id: string; name: string }[], window: GlanceWindow): Chooser {
  const ids = new Set(adults.map((a) => a.id));
  return {
    everyone: part(rows, window),
    people: adults.map((a) => ({ id: a.id, name: a.name, ...part(scopeRows(rows, { kind: "person", personId: a.id }, ids), window) })),
    rest: part(scopeRows(rows, { kind: "rest" }, ids), window),
  };
}

/** One person's rows and everything else in the same rows (the person page: "this person" and "the rest of the household"). */
export function personAndRest(rows: GlanceRows, personId: string): { mine: GlanceRows; rest: GlanceRows } {
  const mine = (id: string | null) => id === personId;
  return {
    mine: { pledges: rows.pledges.filter((p) => mine(p.person_id)), payments: rows.payments.filter((p) => mine(p.person_id)), recurring: rows.recurring.filter((r) => mine(r.person_id)) },
    rest: { pledges: rows.pledges.filter((p) => !mine(p.person_id)), payments: rows.payments.filter((p) => !mine(p.person_id)), recurring: rows.recurring.filter((r) => !mine(r.person_id)) },
  };
}

export function partOf(rows: GlanceRows, window: GlanceWindow): ChooserPart {
  return part(rows, window);
}
