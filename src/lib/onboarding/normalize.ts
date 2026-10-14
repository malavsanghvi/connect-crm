// Normalizers for onboarding's smart matching (pure; no I/O). Each returns a KEY that is equal when two
// spellings mean the same thing, or null when the value is missing or unusable. Keys are for COMPARING only:
// they are never shown or stored as the person's data.
//
// Built for every country: phones are read with a calling-code table (a number without a country code takes the
// community's country, passed in), postal codes by country, names with the honorifics, particles and spelling variants of
// many cultures (resolve/names.ts), street types in several languages.

import { GLUED_SUFFIXES, PREFIX_TYPES, SUFFIX_TYPES } from "./intl/address-words";
import { asciiDigits, foldText } from "./intl/fold";
import { nicknameCanonical, spellingCanonical } from "./intl/name-variants";
import { callingCodeFor, parsePhone } from "./intl/phone";
import { parsePostal } from "./intl/postal";
import { normalizeName } from "./resolve/names";

/** Common nicknames and short forms, in several languages, to one canonical given name ("Mike" and "Michael" compare equal). */
export { NICKNAMES } from "./intl/name-variants";

/**
 * A phone number as a comparison key: the 10 digits of a US/Canada number (as before), or the country code plus the national
 * number for any other country. `country` is the community's (an ISO code or a calling code). A caller that does not pass it gets
 * what this always did for a number without a country code: the last 10 digits, which compares two numbers of one file whatever
 * the country, and is never written anywhere.
 */
export function phoneKey(raw: unknown, country?: string | null): string | null {
  if (raw === null || raw === undefined) return null;
  const p = parsePhone(raw, country);
  if (p.ok) return p.callingCode === "1" ? p.national : `${p.callingCode}${p.national}`;
  const text = String(raw);
  if (callingCodeFor(country) || /^\s*\(?\+/.test(text)) return null;
  let d = asciiDigits(text.replace(/(ext|x|extension)\.?\s*\d+\s*$/i, "")).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length > 11) d = d.slice(-10);
  if (d.length !== 10) return null;
  if (/^(\d)\1{9}$/.test(d) || d.startsWith("000")) return null;
  return d;
}

/** Lower-cased email; Gmail dots and +tags removed (they reach the same inbox). */
export function emailKey(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  const m = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(s);
  if (!m) return null;
  let local = m[1]!;
  let domain = m[2]!;
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.split("+")[0]!.replace(/\./g, "");
  return local ? `${local}@${domain}` : null;
}

/** Words that name a unit or a direction, and the street types of several languages, to one short form. */
const STREET_WORDS: Record<string, string> = {
  ...PREFIX_TYPES,
  ...SUFFIX_TYPES,
  apartment: "apt", suite: "ste", building: "bldg", floor: "fl", flat: "apt", apto: "apt", apartamento: "apt", wohnung: "apt",
  north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};
const UNIT_KEYS = new Set(["apt", "ste", "unit", "bldg", "fl"]);

export type AddressKey = { key: string; unit: string | null; zip: string | null };

/** "Hauptstrasse" and "Hauptstr." are one street: the type written onto a one-word name is split off. */
function splitGlued(t: string): string[] {
  const g = GLUED_SUFFIXES.find(([w]) => t.length >= w.length + 3 && t.endsWith(w));
  return g ? [t.slice(0, t.length - g[0].length).replace(/-+$/, ""), g[1]] : [t];
}

/**
 * "12 Lotus Lane, Apt 4" + ZIP -> key "77478|12|lotus ln"; the unit is kept apart (two units in one building differ). The house
 * number may come first or last ("Hauptstrasse 12"), and the postal code is read in the format of `country` ("SW1A 1AA", "400001").
 */
export function addressKey(line1: unknown, line2: unknown, zip: unknown, country?: string | null): AddressKey | null {
  const a = line1 === null || line1 === undefined ? "" : foldText(String(line1)).toLowerCase();
  if (!a.trim()) return null;
  const tokens = a
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap(splitGlued)
    .map((t) => STREET_WORDS[t] ?? t);
  let unit: string | null = null;
  const body: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (UNIT_KEYS.has(t) && tokens[i + 1]) {
      unit = tokens[i + 1]!;
      i++;
    } else body.push(t);
  }
  const house = body.find((t) => /^\d+[a-z]?$/.test(t));
  if (!house) return null;
  const street = body.filter((t) => t !== house).join(" ").trim();
  if (!street) return null;
  const l2 = line2 === null || line2 === undefined ? "" : foldText(String(line2)).toLowerCase().replace(/[.,#]/g, " ").trim();
  if (!unit && l2) {
    const m = /(?:apt|ste|suite|unit|apartment|flat)?\s*([\p{L}\p{N}-]+)$/u.exec(l2);
    unit = m ? m[1]! : null;
  }
  const postal = parsePostal(zip, country);
  const z = postal ? postal.code : null;
  return { key: `${z ?? ""}|${house}|${street}`, unit, zip: z };
}

export type ParsedName = {
  /** Family name (lower-case, folded), or null when it cannot be told. A particle belongs to it: "al-Farsi" is "alfarsi". */
  surname: string | null;
  /** Given names or initials (lower-case, nicknames and spelling variants folded), in the order written. */
  givens: string[];
};

function canonicalGiven(word: string): string {
  const plain = word.replace(/[^\p{L}\p{M}]/gu, "");
  return /^[a-z]+$/.test(plain) ? spellingCanonical(nicknameCanonical(plain)) : plain;
}

/**
 * "Sanghvi, Malav & Palak", "Malav and Palak Sanghvi", "Dr. Malav Sanghvi Jr.", "Maria de la Cruz", "Ahmed bin Rashid al-Maktoum",
 * "Garcia Lopez, Maria" -> surname + given names. The honorifics, family words and particles of many cultures are understood. A name
 * of one word is taken as a family name (a household label), as before.
 */
export function parseName(raw: unknown, columns?: { first?: string | null; last?: string | null }): ParsedName {
  if (raw === null || raw === undefined) return { surname: null, givens: [] };
  // When the source has the family name in a column of its own, that column is the family name, in any culture.
  const n = columns?.last ? normalizeName({ first: columns.first, last: columns.last }) : normalizeName({ full: String(raw) });
  const last = n.people[n.people.length - 1];
  if (!last) return { surname: null, givens: [] };
  const givens: string[] = [];
  for (const p of n.people) {
    if (p.given) givens.push(canonicalGiven(p.given));
    else if (p.initial) givens.push(p.initial);
    for (const m of p.middles) givens.push(Array.from(m).length === 1 ? m : canonicalGiven(m));
  }
  let surname: string | null = last.surname ? last.surname.replace(/[\s]+/g, "") : null;
  if (surname && /^[a-z-]+$/.test(surname) && !surname.includes("-")) surname = spellingCanonical(surname);
  if (surname === null && givens.length === 1 && n.people.length === 1) {
    // A single word is a family name ("Shah"), as it always was here.
    surname = givens.pop() ?? null;
  }
  return { surname, givens };
}

/**
 * A name parser that remembers each distinct name it has worked out: a file repeats its names (a household's people, a payer's
 * every gift). Make one per run, so nothing outlives the run.
 */
export function nameParser(): typeof parseName {
  const cache = new Map<string, ParsedName>();
  return (raw, columns) => {
    if (raw === null || raw === undefined) return { surname: null, givens: [] };
    const key = `${String(raw)}\u0000${columns?.first ?? ""}\u0000${columns?.last ?? ""}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const parsed = parseName(raw, columns);
    cache.set(key, parsed);
    return parsed;
  };
}

/** Two given names match when equal, one is the other's initial, or they are the same nickname family. */
export function givenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (Array.from(a).length === 1 || Array.from(b).length === 1) return Array.from(a)[0] === Array.from(b)[0];
  return false;
}

/** Surnames match when equal, or one edit apart for names of 5+ letters (Sanghvi/Sanghavi). */
export function surnameMatches(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  return editDistanceAtMost1(a, b);
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
