// Scoring one candidate against what was typed, and saying why it matched. Pure: the database lookup (src/lib/data/find.ts) only
// fetches candidates with a wide net; this decides which really match and how well.
//
// Names are compared folded (src/lib/commands/name-fold.ts): any case, accents, width, the several ways Arabic letters are
// written, Hangul, Traditional and Simplified Han, so "Sofia" finds "Sofía" and a name in Devanagari, Han or Arabic letters is
// found by what was typed. Phone numbers are compared by their digits in any format. Identifiers are compared without their
// punctuation and, when they are numbers, without leading zeros ("417" finds "0417").
//
// Scores (0 to 100): an exact identifier or a whole phone number 92 to 100; a name 28 to 94, an exact full name highest.
// Identifiers and whole phone numbers always beat names, because they name one record.

import { foldName, isAlphabeticScript, scriptOfCodePoint } from "@/lib/commands/name-fold";
import { formatPhone } from "@/lib/people";

import { idLabel, type IdLabelRules } from "./labels";
import type { Classified, CustomHit, FamilyCandidate, PersonCandidate, Scored, Why } from "./types";

type Reason = { score: number; why: Why };

/** The words of a name, folded. An apostrophe is no break ("O'Brien" and "OBrien" are one word). */
export function foldWords(text: string): string[] {
  return foldName(text)
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean);
}

function isCompactWord(word: string): boolean {
  const cp = word.codePointAt(0) ?? 0;
  return /\p{L}/u.test(String.fromCodePoint(cp)) && !isAlphabeticScript(scriptOfCodePoint(cp));
}

/** 3 the whole word, 2 the start of a word (or anywhere in a word of a script written without spaces), 1 inside a word, 0 not there. */
function wordScore(typed: string, word: string): 0 | 1 | 2 | 3 {
  if (word === typed) return 3;
  if (word.startsWith(typed)) return 2;
  if (isCompactWord(typed)) return word.includes(typed) ? 2 : 0;
  return typed.length >= 3 && word.includes(typed) ? 1 : 0;
}

/**
 * How well the typed words match the words of one name: every typed word must be found, in any order. 0 when one is missing.
 * Whole words score highest, then the start of words, then the inside of a word; two whole words ("Sam Nakamura") score most.
 */
export function nameScore(typedWords: readonly string[], nameWords: readonly string[]): number {
  if (typedWords.length === 0 || nameWords.length === 0) return 0;
  let sum = 0;
  let wholes = 0;
  for (const t of typedWords) {
    let best = 0;
    for (const w of nameWords) best = Math.max(best, wordScore(t, w));
    if (best === 0) return 0;
    if (best === 3) wholes += 1;
    sum += best;
  }
  const avg = sum / (3 * typedWords.length);
  const exactBonus = wholes === typedWords.length ? (typedWords.length >= 2 ? 9 : 5) : 0;
  return Math.min(94, Math.round(avg * 85) + exactBonus);
}

/** An identifier without its punctuation, in capitals; a number also without leading zeros. */
export function canonicalId(value: string): string {
  const compact = value.normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
  return /^\d+$/.test(compact) ? compact.replace(/^0+/, "") || "0" : compact;
}

const hasDigit = (s: string) => /\d/.test(s);
const hasLetter = (s: string) => /\p{L}/u.test(s);

function best(reasons: Reason[]): Reason | null {
  let top: Reason | null = null;
  for (const r of reasons) if (!top || r.score > top.score) top = r;
  return top;
}

/** `variants` are the same name written in the orders it may be typed in (given then family name, and family name then given). */
function nameReason(q: Classified, variants: readonly (readonly string[])[]): Reason | null {
  if (!hasLetter(q.search)) return null;
  if (q.kind === "phone" || q.kind === "email") return null;
  if (q.kind === "identifier" && q.shape !== "payer") return null;
  const typed = foldWords(q.search);
  const score = Math.max(...variants.map((words) => nameScore(typed, words)));
  return score > 0 ? { score, why: { code: "name", label: "Name" } } : null;
}

function numberReason(q: Classified, value: string | null, label: string, code: Why["code"]): Reason | null {
  if (!value || !hasDigit(q.search) || q.kind === "email") return null;
  const typed = canonicalId(q.search);
  const have = canonicalId(value);
  if (!typed || !have) return null;
  if (typed === have) return { score: 100, why: { code, label: `${label} ${value}` } };
  if (typed.length >= 3 && have.startsWith(typed)) return { score: 70, why: { code, label: `${label} ${value}` } };
  return null;
}

/** A custom field's value never outranks a name, an ID or a phone number: it is how a record is found when none of those was typed. */
const CUSTOM_SCORE_CAP = 60;
const CUSTOM_VALUE_SHOWN = 48;

/**
 * The best custom field a typed word is found in, said as "Custom field: <label> · <value>". Only words are matched (a typed name, never
 * an ID, number or email), and every typed word must be in the value. `hideValue` is for a child (D2): the row says which field matched but
 * not what it holds.
 */
export function customReason(q: Classified, hits: readonly CustomHit[] | undefined, hideValue: boolean): Reason | null {
  if (!hits || hits.length === 0 || q.kind !== "name" || !hasLetter(q.search)) return null;
  const typed = foldWords(q.search);
  let top: Reason | null = null;
  for (const h of hits) {
    const words = foldWords(h.value);
    const raw = nameScore(typed, words);
    if (raw <= 0) continue;
    // Scaled under the cap, with a value that is exactly what was typed ("Evening") ahead of a longer text that contains it.
    const score = Math.round((raw * CUSTOM_SCORE_CAP) / 94) - (words.length === typed.length ? 0 : 4);
    if (top && score <= top.score) continue;
    const value = h.value.length > CUSTOM_VALUE_SHOWN ? `${h.value.slice(0, CUSTOM_VALUE_SHOWN - 1).trimEnd()}…` : h.value;
    top = { score, why: { code: "custom", label: hideValue ? `Custom field: ${h.label}` : `Custom field: ${h.label} · ${value}` } };
  }
  return top;
}

/** Score a person. Null when nothing about them matches what was typed. */
export function scorePerson(q: Classified, p: PersonCandidate, rules: IdLabelRules): Scored<PersonCandidate> | null {
  if (!q.search) return null;
  const reasons: Reason[] = [];

  for (const hit of p.hits) reasons.push({ score: 100, why: { code: "identifier", label: `${idLabel(hit, rules)} ${hit.value}` } });
  const number = numberReason(q, p.memberNumber, "Member no.", "member_number");
  if (number) reasons.push(number);

  // A phone number by its digits: a whole number, or the last digits, or digits from the middle.
  const typedDigits = q.kind === "phone" || (q.kind === "identifier" && q.shape === "number") ? q.digits : "";
  if (typedDigits.length >= 4 && p.phoneE164) {
    const have = p.phoneE164.replace(/\D/g, "");
    const cap = q.kind === "phone" ? 100 : 60;
    if (have.endsWith(typedDigits)) {
      const score = typedDigits.length >= 10 ? 98 : typedDigits.length >= 7 ? 92 : 78;
      reasons.push({ score: Math.min(score, cap), why: { code: "phone", label: typedDigits.length >= 7 ? `Mobile ${formatPhone(p.phoneE164)}` : `Mobile ending ${typedDigits}` } });
    } else if (have.includes(typedDigits)) {
      reasons.push({ score: Math.min(55, cap), why: { code: "phone", label: `Mobile ${formatPhone(p.phoneE164)}` } });
    }
  }

  if (p.email) {
    const email = p.email.toLowerCase();
    if (q.kind === "email") {
      const typed = q.search.toLowerCase();
      if (email === typed) reasons.push({ score: 100, why: { code: "email", label: `Email ${p.email}` } });
      else if (email.startsWith(typed)) reasons.push({ score: 92, why: { code: "email", label: `Email ${p.email}` } });
      else if (email.includes(typed)) reasons.push({ score: 70, why: { code: "email", label: `Email ${p.email}` } });
    } else if (q.kind === "name" && !/\s/.test(q.search) && q.search.length >= 3 && email.split("@")[0].startsWith(q.search.toLowerCase())) {
      reasons.push({ score: 45, why: { code: "email", label: `Email ${p.email}` } });
    }
  }

  const name = nameReason(q, [foldWords([p.firstName, p.preferredName ?? "", p.lastName].join(" ")), foldWords([p.lastName, p.firstName].join(" "))]);
  if (name) reasons.push(name);
  const custom = customReason(q, p.customHits, p.isChild);
  if (custom) reasons.push(custom);

  const top = best(reasons);
  if (!top) return null;
  // A child ranks just under an adult who matches equally; someone who has passed away just under the living.
  const score = Math.max(1, top.score - (p.isChild ? 5 : 0) - (p.isDeceased ? 10 : 0));
  return { item: p, score, why: top.why };
}

/** Score a family on its own facts: its name, its household number and the identifiers it holds. */
export function scoreFamily(q: Classified, f: FamilyCandidate, rules: IdLabelRules): Scored<FamilyCandidate> | null {
  if (!q.search) return null;
  const reasons: Reason[] = [];
  for (const hit of f.hits) reasons.push({ score: 100, why: { code: "identifier", label: `${idLabel(hit, rules)} ${hit.value}` } });
  const number = numberReason(q, f.householdNumber, "Household no.", "household_number");
  if (number) reasons.push(number);
  if (f.displayName) {
    const name = nameReason(q, [foldWords(f.displayName)]);
    if (name) reasons.push(name);
  }
  const custom = customReason(q, f.customHits, false);
  if (custom) reasons.push(custom);
  const top = best(reasons);
  return top ? { item: f, score: top.score, why: top.why } : null;
}

const FAMILY_OFFSET = 12;

/**
 * The family of an ADULT who matched: it is shown too, a little lower than a family that matched on its own, saying who matched
 * ("Adult Sam Nakamura"). A child never brings its family in: the child's own row opens the family.
 */
export function familyOfAdult(person: Scored<PersonCandidate>, family: FamilyCandidate): Scored<FamilyCandidate> | null {
  if (person.item.isChild) return null;
  const who = [person.item.preferredName?.trim() || person.item.firstName, person.item.lastName].filter(Boolean).join(" ");
  const label = person.why.code === "name" ? `Adult ${who}` : `${person.why.label} · ${who}`;
  return { item: family, score: Math.max(1, person.score - FAMILY_OFFSET), why: { code: person.why.code === "name" ? "adult" : person.why.code, label } };
}
