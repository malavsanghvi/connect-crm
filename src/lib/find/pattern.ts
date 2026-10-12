// The wide net the database lookup casts before the exact scoring in match.ts decides what really matches. Postgres here has no
// "unaccent", and ILIKE does not see "Sofia" in "Sofía", so a typed Latin word becomes a pattern where each letter also accepts
// its accented forms. Words in other scripts are searched as typed (the fold in match.ts then judges them). Pure.

import { foldName } from "@/lib/commands/name-fold";

const VARIANTS: Readonly<Record<string, string>> = {
  a: "àáâãäåāăąǎ",
  c: "çćčĉċ",
  d: "ďđð",
  e: "èéêëēĕėęěẽ",
  g: "ĝğġģ",
  h: "ĥħ",
  i: "ìíîïĩīĭįıǐ",
  j: "ĵ",
  k: "ķ",
  l: "ĺļľŀł",
  n: "ñńņňŉ",
  o: "òóôõöøōŏőǒ",
  r: "ŕŗř",
  s: "śŝşšș",
  t: "ţťŧț",
  u: "ùúûüũūŭůűųǔ",
  w: "ŵ",
  y: "ýÿŷ",
  z: "źżž",
};

/** Characters that mean something in a regular expression or in a PostgREST filter: never passed on. */
const UNSAFE = /[.^$+?[\]{}|%*,()"\\:;<>=!&]/g;

export const MAX_WORDS = 4;

/** The words typed, cleaned for use in a database filter (at most four). */
export function typedWords(text: string): string[] {
  return text
    .replace(UNSAFE, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, MAX_WORDS);
}

/**
 * A pattern for one typed word that also matches the word with accents (case-insensitive match operator). Letters a-z and digits
 * only are widened; any other word is used as typed, in lower case.
 */
export function accentPattern(word: string): string {
  const folded = foldName(word).replace(/['’]/g, "");
  if (/^[a-z0-9]+$/.test(folded)) {
    return [...folded]
      .map((ch) => {
        const extra = VARIANTS[ch];
        return extra ? `[${ch}${extra}${extra.toUpperCase()}]` : ch;
      })
      .join("");
  }
  return word.toLowerCase();
}

/**
 * The text to pass to `.or(…)` that finds a person whose first, last or preferred name has every typed word in it, in any order:
 * `first_name.imatch.…,last_name.imatch.…,preferred_name.imatch.…` for one word, and `and(or(…),or(…))` for several words.
 * Null when nothing is left to look for.
 */
export function personNameFilter(text: string, columns: readonly string[] = ["first_name", "last_name", "preferred_name"]): string | null {
  const words = typedWords(text);
  if (words.length === 0) return null;
  const groups = words.map((w) => {
    const p = accentPattern(w);
    return columns.map((c) => `${c}.imatch.${p}`).join(",");
  });
  return groups.length === 1 ? groups[0] : `and(${groups.map((g) => `or(${g})`).join(",")})`;
}

/** The same for a column holding a whole name (a household's display name). */
export function nameColumnFilter(text: string, column: string): string | null {
  const words = typedWords(text);
  if (words.length === 0) return null;
  const parts = words.map((w) => `${column}.imatch.${accentPattern(w)}`);
  return parts.length === 1 ? parts[0] : `and(${parts.join(",")})`;
}

/** A person or household identifier kind a viewer may see: the people kinds for anyone who opens People, the finance kinds only for finance readers. */
const FINANCE_KINDS = new Set(["accounting", "bank_payer", "payment_provider"]);
export function hitKindVisible(kind: string, financeReader: boolean): boolean {
  return FINANCE_KINDS.has(kind) ? financeReader : true;
}
