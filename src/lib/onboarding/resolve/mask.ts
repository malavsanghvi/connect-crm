// Decision D2: nothing about a child reaches an AI provider. This file is the only door between the resolve engine and a model.
//
//   maskForAi(record)        what a model may see of ONE record: an adult's first name and masked contact details, never
//                            a child's name, birth date, school, grade or notes. A child's record is withheld whole.
//   modelInputForGroup(...)  the input Niva gets to word a question: counts and masked adult examples, nothing for children.
//   assertNoChildLeak(...)   a TEST HELPER that throws if a child's name (or birth date, school, grade, notes) appears in
//                            any string of anything built for a model.
//
// Reused rather than rewritten: the masking of values (import/mask.ts) and the child filter of the command layer
// (commands/child-filter.ts) as a second, independent layer.

import { filterChildren, leakedMinorNames } from "@/lib/commands/child-filter";
import { cleanText } from "@/lib/import/transforms";
import { maskValue } from "@/lib/import/mask";

import type { ResolveConfig } from "./config";
import type { ExceptionGroup } from "./exceptions";
import { foldAscii, normalizeRecord } from "./normalize";
import type { NormalizedRecord, RawRecord } from "./types";

/** What a model may be shown about one record. Nothing here can identify a child. */
export type AiSafeRecord = {
  /** The engine's record id: an opaque label, not data. */
  id: string;
  kind: "person" | "household" | "gift";
  /** An adult's first name only. */
  givenName: string | null;
  /** More people were named on the row; they are not shown. */
  moreNamesOmitted: boolean;
  /** "S•••" */
  surnameMasked: string | null;
  phoneMasked: string | null;
  emailMasked: string | null;
  /** Street masked word by word; the ZIP is kept out. */
  addressMasked: string | null;
  source: string;
  row: number;
  hasGift: boolean;
};

export type MaskResult =
  | { withheld: false; record: AiSafeRecord; removed: string[] }
  | { withheld: true; record: null; reason: "minor" | "unknown_type"; removed: string[] };

function maskPhrase(s: string | null | undefined): string | null {
  const t = cleanText(s);
  return t ? maskValue(t) : null;
}

/** Names listed in a "Kids" column or typed into a note: first names of children as written. */
function listedNames(text: string | null | undefined): string[] {
  return cleanText(text)
    .split(/[,;&/\n]|\band\b/i)
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * Removes everything about a child from a record before any model can see it. A record that is itself about someone under 18
 * (flag, age, birth date, role, school or grade, a title like "Master") is withheld whole: the model is told only that a row
 * exists and was held. For an adult, only the first name and masked contact details are kept; birth date, notes, school, grade
 * and any "Kids" column are never copied.
 */
export function maskForAi(raw: RawRecord, cfg: ResolveConfig): MaskResult {
  const norm = normalizeRecord(raw, 0, cfg);
  const removed: string[] = [];
  if (norm.minor.isMinor) return { withheld: true, record: null, reason: "minor", removed: ["the whole record (it is about someone under 18)"] };
  if (norm.typeUncertain && norm.kind === "unknown") return { withheld: true, record: null, reason: "unknown_type", removed: ["the whole record (its kind is uncertain)"] };

  for (const [field, value] of [
    ["date of birth", raw.dob],
    ["notes", raw.notes],
    ["school", raw.school],
    ["grade", raw.grade],
    ["children listed", raw.children],
  ] as const) {
    if (value !== null && value !== undefined && cleanText(value) !== "") removed.push(field);
  }

  const first = norm.name.people[0];
  const kind = norm.kind === "unknown" ? "person" : norm.kind;
  const given = first?.given ?? null;
  // A child's name written inside an adult's name field ("Rahul, Zoya & Mira Shah") is dropped when the row also lists it.
  const listed = new Set(listedNames(raw.children).map((n) => foldAscii(n.split(/\s+/)[0] ?? "").toLowerCase()));
  const safeGiven = given && !listed.has(given) ? given : null;
  const record: AiSafeRecord = {
    id: raw.id,
    kind,
    givenName: safeGiven,
    moreNamesOmitted: norm.name.people.length > 1,
    surnameMasked: maskPhrase(first?.surname),
    phoneMasked: maskPhrase(raw.mobile ?? raw.phone),
    emailMasked: maskPhrase(raw.email),
    addressMasked: maskPhrase(raw.address1),
    source: raw.source,
    row: raw.row,
    hasGift: !!raw.gift,
  };
  // Second, independent layer: the command layer's child filter, with the names of the children on this row.
  const kids = listedNames(raw.children);
  const filtered = filterChildren(record, { minorNames: kids.filter((n) => n.split(/\s+/).length >= 2), today: cfg.today });
  return { withheld: false, record: filtered.value, removed };
}

/** What Niva is given to word one group's question. Children contribute a count and nothing else. */
export type AiGroupInput = {
  signature: string;
  tier: "C" | "D";
  rows: number;
  /** Masked adults only. Empty for a group about children. */
  examples: AiSafeRecord[][];
  /** Rows left out because they are about someone under 18 or of an uncertain kind. */
  withheld: number;
};

export function modelInputForGroup(group: ExceptionGroup, raws: ReadonlyMap<string, RawRecord>, cfg: ResolveConfig): AiGroupInput {
  const input: AiGroupInput = { signature: group.signature, tier: group.tier, rows: group.subjects.length, examples: [], withheld: 0 };
  if (group.signature === "minor_record") {
    input.withheld = group.subjects.length;
    return input;
  }
  for (const item of group.items.slice(0, 3)) {
    const masked: AiSafeRecord[] = [];
    let blocked = false;
    for (const id of item.recordIds) {
      const raw = raws.get(id);
      if (!raw) continue;
      const m = maskForAi(raw, cfg);
      if (m.withheld) {
        blocked = true;
        input.withheld += 1;
      } else masked.push(m.record);
    }
    if (!blocked && masked.length > 0) input.examples.push(masked);
  }
  return input;
}

// ---------------------------------------------------------------------------
// The test helper
// ---------------------------------------------------------------------------

export type ChildIdentity = {
  first: string;
  last?: string | null;
  dob?: string | null;
  school?: string | null;
  grade?: string | null;
  notes?: string | null;
};

/** Everyone the rows say is a child, as the strings that must never appear in a model's input. */
export function childIdentities(raws: readonly RawRecord[], cfg: ResolveConfig): ChildIdentity[] {
  const out: ChildIdentity[] = [];
  raws.forEach((raw, i) => {
    const norm: NormalizedRecord = normalizeRecord(raw, i, cfg);
    if (!norm.minor.isMinor) return;
    const p = norm.name.people[0];
    const first = cleanText(raw.firstName) || p?.given || cleanText(raw.name).split(/\s+/)[0] || "";
    if (!first) return;
    out.push({
      first,
      last: cleanText(raw.lastName) || p?.surname || null,
      dob: raw.dob === null || raw.dob === undefined ? null : cleanText(raw.dob),
      school: cleanText(raw.school) || null,
      grade: cleanText(raw.grade) || null,
      notes: cleanText(raw.notes) || null,
    });
  });
  // Children named on an adult's "Kids" column.
  for (const raw of raws) {
    for (const n of listedNames(raw.children)) {
      const [first, ...rest] = n.split(/\s+/);
      if (first) out.push({ first, last: rest.length > 0 ? rest.join(" ") : cleanText(raw.lastName) || null });
    }
  }
  return out;
}

/** Every string in a value, keys included, depth first. */
export function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (typeof value === "number" || typeof value === "boolean") into.push(String(value));
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, into);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.push(k);
      collectStrings(v, into);
    }
  }
  return into;
}

export class ChildLeakError extends Error {
  constructor(public readonly leaks: string[]) {
    super(`A child's details reached a model input: ${leaks.join("; ")}`);
    this.name = "ChildLeakError";
  }
}

function dobVariants(dob: string): string[] {
  const out = new Set<string>([dob]);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (m) {
    const [, y, mo, d] = m;
    for (const sep of ["/", "-", "."]) {
      out.add(`${mo}${sep}${d}${sep}${y}`);
      out.add(`${d}${sep}${mo}${sep}${y}`);
      out.add(`${Number(mo)}${sep}${Number(d)}${sep}${y}`);
    }
  }
  return [...out];
}

function foldLower(s: string): string {
  return foldAscii(s).toLowerCase();
}

/**
 * TEST HELPER. Throws a ChildLeakError if a child's first name, full name, birth date, school, grade or notes appears in any
 * string of `modelInput` (keys included), compared without case or accents. Use it on every builder that produces text or
 * JSON for a model.
 */
export function assertNoChildLeak(modelInput: unknown, children: readonly ChildIdentity[]): void {
  const strings = collectStrings(modelInput);
  const haystack = strings.map(foldLower).join("\n");
  const leaks: string[] = [];
  const fullNames = children.filter((c) => c.last && cleanText(c.last)).map((c) => `${c.first} ${c.last}`);
  for (const name of leakedMinorNames(strings, fullNames)) leaks.push(`full name "${name}"`);
  for (const c of children) {
    const first = cleanText(c.first);
    if (first.length >= 2) {
      // A whole-word search for the first name alone.
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${foldLower(first).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");
      if (re.test(haystack)) leaks.push(`first name "${first}"`);
    }
    for (const dob of c.dob ? dobVariants(c.dob) : []) if (haystack.includes(foldLower(dob))) leaks.push(`birth date "${dob}"`);
    for (const [label, v] of [["school", c.school], ["grade", c.grade], ["notes", c.notes]] as const) {
      const t = v ? foldLower(cleanText(v)) : "";
      if (t.length >= 3 && haystack.includes(t)) leaks.push(`${label} "${v}"`);
    }
  }
  if (leaks.length > 0) throw new ChildLeakError([...new Set(leaks)]);
}
