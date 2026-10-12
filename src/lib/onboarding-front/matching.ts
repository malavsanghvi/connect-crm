// COLUMN MATCHING for "Your own files, read by Niva" (board 2c): each of the file's columns -> the Weaver field Guided
// onboarding would put it in, how sure that is, and the few sample values Niva would be shown, masked. Pure.
//
// Reused, not rewritten: Guided onboarding's own column matching (autoMapPersonColumns, autoMapColumns) and the import
// tool's masking (import/mask.ts). Decision D2 on top: a column about children (or birth dates, which decide who is a minor)
// shows no values at all, and no sample is ever taken from a row about someone under the age of majority.

import { isCategorical, maskValue } from "@/lib/import/mask";
import { normHeader } from "@/lib/import/mapping";
import { ageOnDate, cleanText, toDate, type DateOrder } from "@/lib/import/transforms";
import { MIN_AGE_OF_MAJORITY } from "@/lib/age-of-majority";
import { PAYER_FIELDS, autoMapColumns, type ColumnChoice } from "@/lib/onboarding/donations";
import { PERSON_FIELDS, autoMapPersonColumns, relationshipOf, type PersonChoice } from "@/lib/onboarding/people";

import { normHeading } from "./recognise";

export type Target = "people" | "donations";

/** sure: Weaver's own name for the field · likely: a name Weaver knows for it · check: no field, kept as extra information. */
export type Sureness = "sure" | "likely" | "check" | "left_out" | "own_code" | "chosen";

export type FieldOption = { key: string; label: string; required: boolean };

export type ColumnMatch = {
  index: number;
  header: string;
  /** The Weaver field, "custom" (kept as extra information) or "skip" (left out). */
  choice: string;
  to: string;
  sure: Sureness;
  reason: string;
  /** What Niva would be shown: masked, or a short list of categories. Empty when `hidden` says why. */
  samples: string[];
  hidden: string | null;
  children: boolean;
};

export type Matching = {
  target: Target;
  /** "People and households", "Past donations". */
  targetLabel: string;
  columns: ColumnMatch[];
  fields: FieldOption[];
  /** Required fields no column fills, in plain words. */
  missing: string[];
  /** Rows about someone under 18 (by relationship or birth date): no sample comes from them. */
  minorRows: number;
};

export type MatchOptions = {
  /** Whether past donations can be loaded at all (the community has giving). */
  withDonations: boolean;
  dateOrder: DateOrder;
  /** YYYY-MM-DD. */
  today: string;
  /** The community's age of majority (never below 18). */
  majority?: number;
  /** Force a target instead of choosing one from the headings. */
  target?: Target;
};

export const CUSTOM = "custom";
export const SKIP = "skip";

const CHILD_HEADING = /(child|kid|minor|school|grade|hijo|niñ|nino|enfant|kinder|filho|bambin)/u;

/** A heading about children ("Kids", "Children", "Child DOB", "School", "Hijos" …), in any script it is written in. */
export function isChildHeading(header: string): boolean {
  return CHILD_HEADING.test(normHeading(header));
}

type AnyField = { key: string; label: string; required: boolean; synonyms: readonly string[] };

const FIELDS: Record<Target, readonly AnyField[]> = { people: PERSON_FIELDS, donations: PAYER_FIELDS };

/** Fields whose values identify someone: always masked, whatever they look like. */
const PERSONAL: ReadonlySet<string> = new Set(["firstName", "lastName", "fullName", "familyId", "memberId", "email", "phone", "address1", "address2", "city", "state", "zip", "name", "receipt", "amount", "date"]);
/** Fields whose values are categories when they repeat ("Spouse", "Check"). */
const CATEGORY: ReadonlySet<string> = new Set(["relationship", "gender", "language", "membership", "method"]);

function autoMap(target: Target, headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return target === "people" ? (autoMapPersonColumns(headers, rows) as PersonChoice[]) : (autoMapColumns(headers, rows) as ColumnChoice[]);
}

/** Past donations when the headings name an amount and a date (and the community has giving); people otherwise. */
export function chooseTarget(headers: readonly string[], rows: readonly (readonly string[])[], withDonations: boolean): Target {
  if (!withDonations) return "people";
  const d = autoMapColumns(headers, rows);
  if (!d.includes("amount") || !d.includes("date")) return "people";
  const p = autoMapPersonColumns(headers, rows);
  const known = (xs: readonly string[]) => xs.filter((x) => x !== CUSTOM && x !== SKIP).length;
  return known(d) >= known(p) ? "donations" : "people";
}

function howMatched(target: Target, key: string, header: string): "sure" | "likely" {
  const f = FIELDS[target].find((x) => x.key === key);
  const n = normHeader(header);
  return f && (normHeader(f.label) === n || normHeader(f.key) === n) ? "sure" : "likely";
}

/** Indexes of the rows about someone under the age of majority: a child by relationship, or a birth date that says so. */
export function minorRowIndexes(rows: readonly (readonly string[])[], choices: readonly string[], opts: Pick<MatchOptions, "dateOrder" | "today" | "majority">): Set<number> {
  const rel = choices.indexOf("relationship");
  const dob = choices.indexOf("dob");
  const majority = Math.max(MIN_AGE_OF_MAJORITY, opts.majority ?? MIN_AGE_OF_MAJORITY);
  const out = new Set<number>();
  rows.forEach((r, i) => {
    if (rel >= 0 && relationshipOf(r[rel] ?? "") === "child") out.add(i);
    if (dob >= 0) {
      const d = toDate(r[dob] ?? "", opts.dateOrder);
      if (d.ok && ageOnDate(d.value, opts.today) < majority) out.add(i);
    }
  });
  return out;
}

/** Up to three different values, masked unless the column is a category; long lists are needed before anything is shown as is. */
export function sampleValues(values: readonly string[], kind: "personal" | "category" | "other", perColumn = 3): string[] {
  const vals = values.map((v) => cleanText(v)).filter(Boolean);
  const unique = [...new Set(vals)].slice(0, perColumn);
  if (kind === "personal") return unique.map(maskValue);
  const categorical = isCategorical(vals) && (kind === "category" || vals.length >= 20);
  return categorical ? unique : unique.map(maskValue);
}

const HIDDEN_DOB = "Not shown: birth dates decide who is under 18, so only Weaver's own code reads them.";
const HIDDEN_CHILD = "Not shown: this column is about children, so only Weaver's own code reads it.";

function describe(target: Target, choice: string, header: string): Pick<ColumnMatch, "to" | "sure" | "reason"> {
  if (choice === SKIP) return { to: "Left out", sure: "left_out", reason: "The column is empty." };
  if (choice === CUSTOM) return { to: "Kept as extra information", sure: "check", reason: "No Weaver field has this name. Nothing is thrown away." };
  const f = FIELDS[target].find((x) => x.key === choice);
  const how = howMatched(target, choice, header);
  return {
    to: f?.label ?? choice,
    sure: how,
    reason: how === "sure" ? "The heading is Weaver's own name for it." : "The heading is a name Weaver knows for it.",
  };
}

/** The matching for the main sheet, with `overrides` (column index -> field, "custom" or "skip") the person chose. */
export function matchColumns(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  opts: MatchOptions,
  overrides: Readonly<Record<number, string>> = {},
): Matching {
  const target = opts.target ?? chooseTarget(headers, rows, opts.withDonations);
  const auto = autoMap(target, headers, rows);
  const choices = headers.map((_, i) => overrides[i] ?? auto[i]!);
  const minors = minorRowIndexes(rows, choices, opts);
  const adultRows = rows.filter((_, i) => !minors.has(i));

  const columns: ColumnMatch[] = headers.map((header, i) => {
    const choice = choices[i]!;
    const children = isChildHeading(header) && choice !== "relationship";
    const base = overrides[i] !== undefined ? { ...describe(target, choice, header), sure: "chosen" as const, reason: "You chose this. It is kept on this page only." } : describe(target, choice, header);
    if (children) {
      return { index: i, header, choice, ...base, to: choice === CUSTOM ? "About children: read by Weaver's own code" : base.to, sure: overrides[i] !== undefined ? "chosen" : "own_code", samples: [], hidden: HIDDEN_CHILD, children: true };
    }
    if (choice === "dob") return { index: i, header, choice, ...base, samples: [], hidden: HIDDEN_DOB, children: false };
    const kind = PERSONAL.has(choice) ? "personal" : CATEGORY.has(choice) ? "category" : "other";
    const samples = choice === SKIP ? [] : sampleValues(adultRows.map((r) => r[i] ?? ""), kind);
    return { index: i, header, choice, ...base, samples, hidden: null, children: false };
  });

  const fields: FieldOption[] = FIELDS[target].map((f) => ({ key: f.key, label: f.label, required: f.required }));
  const chosen = new Set(choices);
  let missing: string[];
  if (target === "people") missing = chosen.has("fullName") || (chosen.has("firstName") && chosen.has("lastName")) ? [] : ["a name (first and last name, or a full name)"];
  else missing = PAYER_FIELDS.filter((f) => f.required && !chosen.has(f.key)).map((f) => f.label.toLowerCase());

  return { target, targetLabel: target === "people" ? "People and households" : "Past donations", columns, fields, missing, minorRows: minors.size };
}
