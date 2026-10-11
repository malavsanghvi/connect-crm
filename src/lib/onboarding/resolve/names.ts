// Names for the resolve engine: split a name into people, given names, middle names, a family name, a maiden name and a
// generation, however it is written and in whatever culture. Pure.
//
// What this knows, and what it refuses to guess:
//   * Folding: accents go (José = Jose), extended Latin letters are spelled out (Søren = Soren, Łukasz = Lukasz, Đorđe = Dorde),
//     and a name in another script (Gujarati, Arabic, Cyrillic, Han, Hangul ...) is kept and compared AS WRITTEN, never dropped.
//   * Honorifics, family words and relationship words of English, Spanish, Portuguese, French, German, Italian, Arabic,
//     South Asian, East Asian and Hebrew names are not part of a name (intl/name-words.ts).
//   * Particles belong to the family name: "al-Farsi", "bin Laden", "van der Berg", "de la Cruz", "McDonald" are one family
//     name each. A particle is never read as a second family name or as a maiden name.
//   * Honorific suffixes (-bhai, -ben, -ji, -kumar) are removed only as their own word or after a hyphen, or attached to a
//     name that shows South Asian context. Never inside a word: Kenji and Reuben stay Kenji and Reuben.
//   * Spelling variants (Muhammad / Mohammed) share a key. Translations (Yusuf / Joseph) and other word orders (Wang Wei /
//     Wei Wang, a double surname's halves) are WEAK readings kept beside the main one; they never make two names "the same".
// A name is evidence, never an identifier: nothing here joins two records on its own.

import { cleanText } from "@/lib/import/transforms";

import { foldText, hasNonLatinLetters } from "../intl/fold";
import { givenEquivalentId, nicknameCanonical, spellingCanonical, surnameEquivalentId } from "../intl/name-variants";
import {
  ARABIC_ARTICLES,
  COURTESY_AFTER,
  CREDENTIALS,
  FAMILY_WORDS,
  FAMILY_WORDS_NATIVE,
  GENERATIONS,
  HEBREW_AFTER_BEN,
  HYPHEN_COURTESY,
  MINOR_TITLES,
  NAME_PREFIX_GLUE,
  NOT_A_NAME,
  PARTICLES,
  PREFIX_TITLES,
  SOUTH_ASIAN_SURNAMES,
  SOUTH_ASIAN_TITLES,
  SUFFIX_ALWAYS,
  SUFFIX_SOUTH_ASIAN,
  SUN_ARTICLES,
  TITLES,
  VIETNAMESE_FAMILY,
} from "../intl/name-words";

import type { Generation, NamePart, NameReading, NormalizedName } from "./types";

export { foldText as foldAscii, hasNonLatinLetters };

// ---------------------------------------------------------------------------
// Sound-alike keys
// ---------------------------------------------------------------------------

const NOT_LETTER = /[^\p{L}\p{M}]/gu;
const ASCII_ONLY = /^[\x00-\x7f]*$/;

/** Keys of words already worked out: a file repeats its words, and the sound-alike rules are the costly part. */
const PHONETIC_CACHE = new Map<string, string>();

/**
 * A sound-alike key for one name word, so Latin spellings of names compare equal:
 * Patel = Patil = Pattel, Shah = Saha, Mehta = Metha, Desai = Dessai, Doshi = Dosi, Parekh = Parikh, Thakkar = Thaker,
 * Mueller = Muller, Hernandez = Hernandes, Dmitriy = Dmitri.
 * It is deliberately coarse. A key match is never enough to join two records on its own (names alone never join).
 * A word in another script has no sound rules: its key is the word itself, lower-cased, without spaces or marks of punctuation.
 */
export function phoneticKey(token: string): string {
  const hit = PHONETIC_CACHE.get(token);
  if (hit !== undefined) return hit;
  const letters = lettersOf(foldText(token).toLowerCase());
  let s = letters;
  if (!/^[a-z]*$/.test(letters)) s = letters.normalize("NFC");
  else {
    // Applied until nothing changes, so a key of a key is itself.
    for (let pass = 0; pass < 6; pass++) {
      const next = phoneticPass(s);
      if (next === s) break;
      s = next;
    }
  }
  if (PHONETIC_CACHE.size > 50_000) PHONETIC_CACHE.clear();
  PHONETIC_CACHE.set(token, s);
  return s;
}

function phoneticPass(word: string): string {
  let s = word.replace(/(.)\1+/g, "$1");
  s = s.replace(/([aeiou])z$/, "$1s").replace(/([aou])e/g, "$1").replace(/ij$/, "i");
  s = s.replace(/w/g, "v").replace(/q/g, "k").replace(/ph/g, "f").replace(/ck/g, "k");
  s = s.replace(/sh/g, "s").replace(/ch/g, "c").replace(/kh/g, "k").replace(/gh/g, "g").replace(/bh/g, "b");
  s = s.replace(/dh/g, "d").replace(/th/g, "t").replace(/jh/g, "j");
  s = s.replace(/h/g, "");
  s = s.replace(/er$/, "ar");
  s = s.replace(/ou|oo/g, "u");
  s = s.replace(/(?!^)y/g, "i").replace(/e/g, "i");
  return s.replace(/(.)\1+/g, "$1");
}

// ---------------------------------------------------------------------------
// Honorific suffixes
// ---------------------------------------------------------------------------

const ATTACHED_ALWAYS: RegExp[] = [/^(.{3,}?)(?:bhai|bhaai|bhaii)$/];
const ATTACHED_SOUTH_ASIAN: RegExp[] = [/^(.{3,}?)bhi$/, /^(.{3,}?)(?:ben|behn|bahen|bein|baen)$/, /^(.{3,}?)(?:kumari|kumar)$/, /^(.{3,}?)ji$/];
/** Names that end like an honorific and are not one. */
const NEVER_STRIPPED = new Set(["reuben", "rueben", "ruben", "eben", "steben", "kenji", "shinji", "koji", "yuji", "reiji", "eiji", "junji", "seiji", "taiji"]);

/**
 * "Rahulbhai" -> "rahul", "Miraben" -> "mira", "Ashokkumar" -> "ashok", "Hasmukhji" -> "hasmukh", "Hasmukh-ji" -> "hasmukh".
 * One pass. "-bhai" is always an honorific; -ben, -ji, -kumar and -bhi only with South Asian context (`southAsian`), so
 * Kenji and Reuben are never cut. After a hyphen ("Mira-ben") the suffix is explicit; "Tanaka-san" loses its -san.
 */
export function stripAttachedSuffix(token: string, southAsian = true): string {
  const t = token.toLowerCase();
  if (t.includes(" ")) return t;
  const hy = t.split("-");
  if (hy.length >= 2) {
    const tail = hy[hy.length - 1] ?? "";
    const stem = hy.slice(0, -1).join("-");
    if (stem.length >= 2 && (SUFFIX_ALWAYS.has(tail) || HYPHEN_COURTESY.has(tail) || (southAsian && SUFFIX_SOUTH_ASIAN.has(tail)))) return stem;
    return t;
  }
  if (NEVER_STRIPPED.has(t)) return t;
  for (const re of ATTACHED_ALWAYS) {
    const m = re.exec(t);
    if (m) return m[1] ?? t;
  }
  if (southAsian) {
    for (const re of ATTACHED_SOUTH_ASIAN) {
      const m = re.exec(t);
      if (m) return m[1] ?? t;
    }
  }
  return t;
}

let southAsianKeys: Set<string> | null = null;
function isSouthAsianSurname(word: string): boolean {
  if (SOUTH_ASIAN_SURNAMES.has(word)) return true;
  if (!southAsianKeys) southAsianKeys = new Set([...SOUTH_ASIAN_SURNAMES].map(phoneticKey));
  return word.length >= 3 && southAsianKeys.has(phoneticKey(word));
}

/** Whether a name shows South Asian context: a common family name there, a title like Shri or Smt, or Indic script. */
const INDIC_SCRIPT = /[\p{Script=Devanagari}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}]/u;

function southAsianContext(text: string): boolean {
  if (!ASCII_ONLY.test(text) && INDIC_SCRIPT.test(text)) return true;
  for (const piece of text.split(/[\s,&+()]+/)) {
    const w = cleanWord(piece);
    if (!w) continue;
    if (SOUTH_ASIAN_TITLES.has(w)) return true;
    for (const h of w.split("-")) if (h && isSouthAsianSurname(h)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** Lower-case, folded, only letters (any script) with inner hyphens and apostrophes kept: "O'Brien", "Shah-Patel". */
function cleanWord(t: string): string {
  const f = foldText(t).toLowerCase();
  return (ASCII_ONLY.test(f) ? f.replace(/[^a-z'-]/g, "") : f.replace(/[^\p{L}\p{M}'-]/gu, "")).replace(/^[-']+|[-']+$/g, "");
}

function lettersOf(w: string): string {
  return ASCII_ONLY.test(w) ? w.replace(/[^A-Za-z]/g, "") : w.replace(NOT_LETTER, "");
}

const IDEOGRAPHIC = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** One letter is an initial ("R."), except in scripts where one character is a whole name (王, 伟, 민). */
function isInitial(letters: string): boolean {
  const chars = Array.from(letters);
  return chars.length === 1 && !IDEOGRAPHIC.test(chars[0] ?? "");
}

function firstChar(w: string): string | null {
  const c = Array.from(lettersOf(w))[0];
  return c ?? null;
}

/** "abdulrahman", "abdelrahman", "abdurrahman" and "abderrahman" are one name; so are Abdullah and Abdallah. */
function abdCanonical(w: string): string {
  if (!w.startsWith("abd") || w.length < 6) return w;
  if (/^abd(?:u|a|ul|al|el)?l{1,2}ah?$/.test(w)) return "abdallah";
  const m = /^abd(?:ul|el|al|ur|us|er|es|u|e|a)?(.{3,})$/.exec(w);
  return m ? `abd${m[1] ?? ""}` : w;
}

function givenKeyOf(word: string): string {
  const plain = lettersOf(word);
  if (!/^[a-z]+$/.test(plain)) return plain.normalize("NFC");
  return phoneticKey(spellingCanonical(abdCanonical(nicknameCanonical(plain))));
}

function givenWeakOf(word: string): string | null {
  const plain = lettersOf(word);
  return /^[a-z]+$/.test(plain) ? givenEquivalentId(abdCanonical(plain)) : null;
}

const SUN_FORM_PARTS = new Set(["al", "el", "ul", "ell"]);

/** The key of one family-name part, particles included: "al Farsi", "de la Cruz", "Mc Donald" are one key each. */
function surnameKeyOf(text: string): string {
  const words = text.split(/[\s-]+/).map(lettersOf).filter(Boolean);
  if (words.length === 0) return "";
  const out = words.map((w, i) => {
    if (i === words.length - 1) return w;
    if (w === "ibn") return "bin";
    if (w === "binti") return "bint";
    if (SUN_FORM_PARTS.has(w)) return "al";
    const sun = SUN_ARTICLES[w];
    const next = words[i + 1] ?? "";
    return sun && next.startsWith(sun) ? "al" : w;
  });
  const core = out[out.length - 1] ?? "";
  out[out.length - 1] = /^[a-z]+$/.test(core) ? spellingCanonical(core) : core;
  const joined = out.join("").replace(/^mc(?=[a-z]{2})/, "mac");
  return phoneticKey(joined);
}

function surnameWeakOf(text: string): string | null {
  const words = text.split(/[\s-]+/).map(lettersOf).filter(Boolean);
  const core = words[words.length - 1] ?? "";
  return /^[a-z]+$/.test(core) ? surnameEquivalentId(core) : null;
}

// ---------------------------------------------------------------------------
// Gluing particles to the family name
// ---------------------------------------------------------------------------

function isParticleWord(p: string, next: string): boolean {
  if (PARTICLES.has(p) || p === "ben" || p === "bat") return true;
  const sun = SUN_ARTICLES[p];
  return !!sun && next.startsWith(sun);
}

/** "al-farsi" -> "al farsi", "van-der-berg" -> "van der berg", "shah-patel" stays; the hyphen after a particle is only a joint. */
function convertHyphenParticles(tok: string): string {
  if (!tok.includes("-")) return tok;
  const parts = tok.split("-").filter(Boolean);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    out += parts[i];
    if (i < parts.length - 1) out += isParticleWord(parts[i] ?? "", parts[i + 1] ?? "") ? " " : "-";
  }
  return out;
}

function isParticleAt(toks: string[], k: number, surnameContext: boolean): boolean {
  const t = toks[k] ?? "";
  if (t === "ben" || t === "bat") return k + 1 < toks.length && HEBREW_AFTER_BEN.has(toks[k + 1] ?? "") && (k > 0 || surnameContext);
  if (!PARTICLES.has(t)) {
    // Before a sun letter the article is written assimilated ("ar Rahman", "ash Shamsi"). Only a text known to be a family name reads it so.
    const sun = SUN_ARTICLES[t];
    return surnameContext && !!sun && (toks[k + 1] ?? "").startsWith(sun);
  }
  if (k === 0 && !surnameContext) return false;
  // "Tran Van Nam": Van after a Vietnamese family name is a middle name.
  if (t === "van" && k > 0 && VIETNAMESE_FAMILY.has(toks[k - 1] ?? "")) return false;
  return true;
}

/**
 * Joins the words that belong together into units: a particle with the family name after it ("de la Cruz"), "Abdul" with the
 * name after it ("Abdul Rahman"). A particle is not glued when it starts a name (Vietnamese "Le", Chinese "Du") unless the
 * text is known to be a family name (`surnameContext`).
 */
function glueTokens(tokens: string[], surnameContext: boolean): string[] {
  const toks = tokens.map(convertHyphenParticles);
  const out: string[] = [];
  for (let i = 0; i < toks.length; ) {
    const t = toks[i] ?? "";
    if (NAME_PREFIX_GLUE.has(t) && i + 1 < toks.length) {
      let j = i + 1;
      let unit = t;
      if (ARABIC_ARTICLES.has(toks[j] ?? "") && j + 1 < toks.length) {
        unit += ` ${toks[j]}`;
        j++;
      }
      out.push(`${unit} ${toks[j] ?? ""}`);
      i = j + 1;
      continue;
    }
    if (isParticleAt(toks, i, surnameContext) && i + 1 < toks.length) {
      let j = i;
      let unit = "";
      while (j + 1 < toks.length && isParticleAt(toks, j, surnameContext)) {
        unit += `${unit ? " " : ""}${toks[j]}`;
        j++;
      }
      out.push(`${unit} ${toks[j] ?? ""}`);
      i = j + 1;
      continue;
    }
    out.push(t);
    i++;
  }
  return out;
}

/** "al-Farsi" -> ["al farsi"]; "Shah-Patel" -> ["shah", "patel"]; "Garcia Lopez" -> ["garcia", "lopez"]; "de la Cruz" -> ["de la cruz"]. */
function splitSurname(raw: string): string[] {
  const toks = raw.split(/\s+/).map(cleanWord).filter(Boolean);
  return glueTokens(toks, true)
    .flatMap((u) => u.split("-"))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

type Ctx = { southAsian: boolean };

function givenFields(unit: string | null, southAsian: boolean): Pick<NameReading, "given" | "givenKey" | "givenWeak" | "initial"> {
  if (!unit) return { given: null, givenKey: null, givenWeak: null, initial: null };
  const letters = lettersOf(unit);
  if (isInitial(letters)) return { given: null, givenKey: null, givenWeak: null, initial: letters };
  const stem = stripAttachedSuffix(unit, southAsian);
  return { given: stem, givenKey: givenKeyOf(stem) || null, givenWeak: givenWeakOf(stem), initial: firstChar(stem) };
}

function readingOf(givenText: string | null, surnameText: string | null, ctx: Ctx): NameReading {
  const g = givenFields(givenText, ctx.southAsian);
  const parts = surnameText ? splitSurname(surnameText) : [];
  const key = surnameText ? surnameKeyOf(surnameText) : "";
  return {
    ...g,
    surname: parts.length > 0 ? parts.join("-") : null,
    surnameKey: key || null,
    surnameWeak: parts.length > 0 ? surnameWeakOf(parts[parts.length - 1] ?? "") : null,
  };
}

function emptyPart(): NamePart {
  return {
    given: null,
    givenKey: null,
    initial: null,
    middleKeys: [],
    middles: [],
    surname: null,
    surnameKey: null,
    surnameParts: [],
    maidenKey: null,
    generation: null,
    givenWeak: null,
    surnameWeak: null,
    alts: [],
  };
}

const MAX_ALTS = 8;

function buildPart(
  units: string[],
  surnameRaw: string | null,
  maidenRaw: string | null,
  generation: Generation | null,
  ctx: Ctx,
  positional: string[] | null,
  nicknames: string[],
  nativeReadings: NameReading[],
): NamePart {
  const part = emptyPart();
  if (units.length > 0) {
    const g = givenFields(units[0] ?? null, ctx.southAsian);
    part.given = g.given;
    part.givenKey = g.givenKey;
    part.givenWeak = g.givenWeak;
    part.initial = g.initial;
    // "Ashok Kumar Mehta": Kumar between the names is an honorific, like "Ashokkumar".
    const middles = units.slice(1).filter((w) => w !== "kumar" && w !== "kumari");
    part.middles = middles.map((w) => lettersOf(stripAttachedSuffix(w, ctx.southAsian))).filter(Boolean);
    part.middleKeys = middles.map((w) => (isInitial(lettersOf(w)) ? lettersOf(w) : givenKeyOf(stripAttachedSuffix(w, ctx.southAsian)))).filter(Boolean);
  }
  if (surnameRaw) {
    const parts = splitSurname(surnameRaw);
    if (parts.length > 0) {
      part.surname = parts.join("-");
      part.surnameParts = parts.map(surnameKeyOf).filter(Boolean);
      part.surnameKey = part.surnameParts[part.surnameParts.length - 1] ?? null;
      part.surnameWeak = surnameWeakOf(parts[parts.length - 1] ?? "");
      // "Shah-Patel": the first half is the maiden name, the last half the name in use. A particle is part of its name, so
      // "al-Farsi" is one part and gives no maiden name.
      if (parts.length > 1) part.maidenKey = part.surnameParts[0] ?? null;
    }
  }
  if (maidenRaw) {
    const k = surnameKeyOf(cleanWord(maidenRaw));
    if (k) part.maidenKey = k;
  }
  part.generation = generation;

  // Weak readings of the same words.
  const alts: NameReading[] = [];
  const read = (g: string | null, s: string | null) => alts.push(readingOf(g, s, ctx));
  if (positional && positional.length >= 2) {
    const U = positional;
    const n = U.length;
    if (n === 2) {
      read(U[1] ?? null, U[0] ?? null);
    } else {
      read(U[0] ?? null, U[n - 2] ?? null);
      read(U[0] ?? null, `${U[n - 2]} ${U[n - 1]}`);
      read(U[1] ?? null, U[n - 1] ?? null);
      read(U[n - 1] ?? null, U[0] ?? null);
      read(U.slice(1).join(" "), U[0] ?? null);
    }
  }
  if (surnameRaw && units.length > 0) {
    const parts = splitSurname(surnameRaw);
    const last = parts[parts.length - 1] ?? "";
    // "de la Cruz" is also "Cruz" to someone filling in a short form.
    if (last.includes(" ")) read(units[0] ?? null, last.split(" ").pop() ?? null);
  }
  for (const nick of nicknames) read(nick, surnameRaw);
  alts.push(...nativeReadings);
  const seen = new Set<string>([`${part.givenKey ?? part.initial ?? ""}|${part.surnameKey ?? ""}`]);
  part.alts = alts
    .filter((a) => {
      if (!(a.givenKey || a.initial) || !a.surnameKey) return false;
      const k = `${a.givenKey ?? a.initial}|${a.surnameKey}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_ALTS);
  return part;
}

// ---------------------------------------------------------------------------
// The name
// ---------------------------------------------------------------------------

type Segment = { tokens: string[]; family: boolean };

/** "R.K." -> "r", "k". Other tokens pass through. */
function splitInitials(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (/^(?:[A-Za-z]\.)+[A-Za-z]?\.?$/.test(t) && t.includes(".")) out.push(...t.split(".").filter(Boolean));
    else out.push(t);
  }
  return out;
}

const HAN_COMPOUND = new Set(["欧阳", "司马", "上官", "诸葛", "东方", "皇甫", "尉迟", "公孙", "慕容", "令狐", "长孙", "宇文", "司徒", "夏侯", "轩辕", "歐陽", "諸葛", "東方", "長孫", "軒轅"]);

/** A Chinese or Korean name written without a space: family name first. Japanese names are not split (their family name has 1 to 3 characters). */
function splitSpaceless(unit: string): { given: string; surname: string } | null {
  const chars = Array.from(unit);
  if (chars.every((c) => /\p{Script=Han}/u.test(c))) {
    if (chars.length >= 3 && HAN_COMPOUND.has(chars.slice(0, 2).join(""))) return { surname: chars.slice(0, 2).join(""), given: chars.slice(2).join("") };
    if (chars.length >= 2 && chars.length <= 3) return { surname: chars[0] ?? "", given: chars.slice(1).join("") };
  }
  if (chars.every((c) => /\p{Script=Hangul}/u.test(c)) && (chars.length === 3 || chars.length === 4)) return { surname: chars[0] ?? "", given: chars.slice(1).join("") };
  return null;
}

const MAIDEN_RE = /(?<![\p{L}])(?:nee|geb|geborene|z\s+domu|de\s+soltera|maiden(?:\s+name)?)(?![\p{L}])\.?\s*[:-]?\s*([\p{L}][\p{L}'-]+)/iu;
const LOWERCASE_ONLY_JOINERS = new Set(["y", "e"]);
const JOINERS = new Set(["and", "und", "et"]);
const LEADING_ARTICLES = new Set(["the", "los", "las"]);
const GENERATION_WORD = /\b(?:jr|sr|ii|iii|iv|md|phd|esq)\b/gi;

function generationOf(lower: string): Generation | null {
  return Object.prototype.hasOwnProperty.call(GENERATIONS, lower) ? (GENERATIONS[lower] ?? null) : null;
}

/** "Kim-san" -> "Kim", "Rahul-bhai" -> "Rahul". Only the courtesy words that are never part of a name. */
function stripHyphenCourtesy(tok: string): string {
  const i = tok.lastIndexOf("-");
  if (i <= 1) return tok;
  const tail = tok.slice(i + 1).toLowerCase().replace(/\./g, "");
  return SUFFIX_ALWAYS.has(tail) || HYPHEN_COURTESY.has(tail) ? tok.slice(0, i) : tok;
}

const CONTENT_SKIP = (w: string) => TITLES.has(w) || PREFIX_TITLES.has(w) || CREDENTIALS.has(w) || generationOf(w) !== null || FAMILY_WORDS.has(w) || MINOR_TITLES.has(w);

function contentWords(s: string): string[] {
  return s
    .split(/[\s,&+]+/)
    .map(cleanWord)
    .filter((w) => w && !CONTENT_SKIP(w))
    .sort();
}

/**
 * Splits a name into people, given names, middle names, a surname, a maiden name and a generation, however it is written:
 * "Last, First", "First Last", "Rahul & Mira Shah", "Dr. Miraben Patel nee Shah", "Mira Shah-Patel", "R. K. Shah",
 * "Maria de la Cruz", "Ahmed bin Rashid al-Maktoum", "García López, María", "Wang Wei".
 * Honorifics (Shri, Smt, Dr, Herr, Sra), suffixes (-bhai, -ben, -kumar, -ji) and family words (Family, Familia) are dropped.
 * Names in another script are kept as written. When the source has family and given name COLUMNS they are used as they are;
 * otherwise the last word is the family name and the other readings (first word, a double surname) are kept as weak alternatives.
 */
export function normalizeName(input: { full?: string | null; first?: string | null; last?: string | null }): NormalizedName {
  const full = cleanText(input.full);
  const first = cleanText(input.first);
  const last = cleanText(input.last);
  const raw = full || [first, last].filter(Boolean).join(" ");
  const nonLatin = hasNonLatinLetters(raw);
  const missing: NormalizedName = { raw, people: [], nonLatin, minorHint: false, missing: true };
  if (!raw) return missing;

  // Columns win when the source has them: "first" may hold several people and middle names, "last" is the family name.
  let text: string;
  if ((first || last) && !full) {
    text = first && last ? `${last}, ${first}` : last ? `${last},` : first;
  } else if (first && last && contentWords(full).join(" ") === contentWords(`${first} ${last}`).join(" ")) {
    // The name column says the same as the two columns: trust the columns for who is the family name, and keep Jr / Sr.
    const marks = full.split(/[\s,]+/).filter((w) => generationOf(w.toLowerCase().replace(/\./g, "")) !== null || MINOR_TITLES.has(w.toLowerCase()));
    text = `${last}, ${first}${marks.length > 0 ? ` ${marks.join(" ")}` : ""}`;
  } else {
    text = full;
  }

  const folded = foldText(text);
  const ctx: Ctx = { southAsian: southAsianContext(folded) };

  let maiden: string | null = null;
  let s = folded.replace(MAIDEN_RE, (_m, w: string) => {
    maiden = w;
    return " ";
  });
  const nicknames: string[] = [];
  const nativeTexts: string[] = [];
  s = s.replace(/\(([^)]*)\)/g, (m: string, inner: string, offset: number, whole: string) => {
    const w = inner.trim();
    if (!w) return " ";
    if (hasNonLatinLetters(w)) {
      nativeTexts.push(w);
      return " ";
    }
    const lowerW = w.toLowerCase();
    if (/^[a-z][a-z'-]+$/i.test(w) && !NOT_A_NAME.has(lowerW) && generationOf(lowerW) === null) {
      // After the whole name it is a maiden name; between the names it is a nickname.
      const atEnd = !/\p{L}/u.test(whole.slice(offset + m.length).replace(GENERATION_WORD, ""));
      if (atEnd) maiden = maiden ?? w;
      else nicknames.push(w);
    }
    return " ";
  });
  s = s.replace(/"([^"]{2,24})"/g, (_m, w: string) => {
    if (/^\p{L}[\p{L}'-]+$/u.test(w.trim())) nicknames.push(cleanWord(w));
    return " ";
  });
  s = s.replace(/\s+/g, " ").trim();

  let surnameFromComma: string | null = null;
  let body = s;
  const comma = s.indexOf(",");
  if (comma >= 0) {
    const before = s.slice(0, comma).trim();
    const after = s.slice(comma + 1).trim();
    const afterWords = after.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase().replace(/[.,]/g, ""));
    const onlySuffixes = afterWords.length > 0 && afterWords.every((w) => generationOf(w) !== null || CREDENTIALS.has(w) || TITLES.has(w));
    if (onlySuffixes) body = `${before} ${after}`;
    else if (before) {
      // "Shah Patel, Mira" and "de la Cruz, Maria": what stands before the comma is the family name, however many words it has.
      surnameFromComma = before;
      body = after;
    } else body = after;
  }

  const spaced = body.replace(/\s*[&+]\s*/g, " & ");
  const rawTokens = splitInitials(spaced.split(/\s+/).filter(Boolean)).map(stripHyphenCourtesy);
  const segments: Segment[] = [{ tokens: [], family: false }];
  let generation: Generation | null = null;
  let minorHint = false;
  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i] ?? "";
    const lower = tok.toLowerCase().replace(/[.,]/g, "");
    const hasNext = i + 1 < rawTokens.length;
    if (tok === "&" || (i > 0 && hasNext && (JOINERS.has(lower) || (LOWERCASE_ONLY_JOINERS.has(lower) && tok === lower)))) {
      segments.push({ tokens: [], family: false });
      continue;
    }
    const seg = segments[segments.length - 1] as Segment;
    if (LEADING_ARTICLES.has(lower) && seg.tokens.length === 0) continue;
    if (MINOR_TITLES.has(lower) && seg.tokens.length === 0 && hasNext) {
      minorHint = true;
      continue;
    }
    // "Sr. Garcia" is Mr; "Rahul Shah Sr." is the father.
    if (lower === "sr" && seg.tokens.length === 0 && hasNext) continue;
    if (TITLES.has(lower) || CREDENTIALS.has(lower)) continue;
    if (PREFIX_TITLES.has(lower) && seg.tokens.length === 0 && hasNext && rawTokens[i + 1] !== "&") continue;
    const gen = generationOf(lower);
    if (gen !== null && seg.tokens.length > 0) {
      generation = gen;
      continue;
    }
    if (FAMILY_WORDS.has(lower) || FAMILY_WORDS_NATIVE.has(lower)) {
      seg.family = true;
      continue;
    }
    if (seg.tokens.length > 0) {
      if (COURTESY_AFTER.has(lower)) continue;
      // "Mira Ben Shah": a stand-alone ben/bhai after a given name is an honorific, not a name. "David Ben Gurion" is not.
      const next = cleanWord(rawTokens[i + 1] ?? "");
      const hebrew = lower === "ben" && HEBREW_AFTER_BEN.has(next);
      if (!hebrew && lower !== "kumar" && lower !== "kumari" && (SUFFIX_ALWAYS.has(lower) || (ctx.southAsian && SUFFIX_SOUTH_ASIAN.has(lower)))) continue;
    }
    seg.tokens.push(tok);
  }

  let live = segments
    .filter((g) => g.tokens.length > 0)
    .map((g) => ({ family: g.family, units: glueTokens(g.tokens.map(cleanWord).filter(Boolean), false) }))
    .filter((g) => g.units.length > 0);
  if (live.length === 1 && surnameFromComma === null && !live[0]?.family && live[0]?.units.length === 1) {
    // A Chinese or Korean name with no space in it: family name first.
    const cut = splitSpaceless(live[0].units[0] ?? "");
    if (cut) live = [{ family: false, units: [cut.given, cut.surname] }];
  }
  if (live.length === 0) {
    // Only a family name was given ("Shah," from a last-name column, or "Shah family").
    if (surnameFromComma) {
      const part = buildPart([], surnameFromComma, maiden, generation, ctx, null, [], []);
      return { raw, people: [part], nonLatin, minorHint, missing: !part.surnameKey };
    }
    return { ...missing, minorHint };
  }

  // Native-script spellings in brackets ("Wei Zhang (张伟)") are weak readings of the first person.
  const nativeReadings: NameReading[] = nativeTexts.flatMap((t) => {
    const p = normalizeName({ full: t }).people[0];
    return p && (p.givenKey || p.initial) && p.surnameKey
      ? [{ given: p.given, givenKey: p.givenKey, givenWeak: p.givenWeak, initial: p.initial, surname: p.surname, surnameKey: p.surnameKey, surnameWeak: p.surnameWeak }]
      : [];
  });

  // Work out each segment's surname.
  let carried: string | null = surnameFromComma;
  if (carried === null) {
    // The last word of the last segment is the shared surname when that segment has two words or more (or a family word).
    const tail = live[live.length - 1] as { family: boolean; units: string[] };
    if (tail.units.length >= 2 || tail.family) carried = tail.units[tail.units.length - 1] ?? null;
  }
  const people: NamePart[] = [];
  live.forEach((g, idx) => {
    let ownSurname: string | null = null;
    const units = [...g.units];
    let positional: string[] | null = null;
    if (surnameFromComma !== null) {
      ownSurname = surnameFromComma;
    } else if (units.length >= 2 || (g.family && units.length === 1)) {
      positional = [...g.units];
      ownSurname = units.pop() ?? null;
    } else if (idx < live.length - 1) {
      // A lone word before the last segment takes the family name that follows ("Rahul & Mira Shah").
      ownSurname = carried;
    }
    people.push(buildPart(units, ownSurname, idx === 0 ? maiden : null, generation, ctx, positional, idx === 0 ? nicknames : [], idx === 0 ? nativeReadings : []));
  });

  return { raw, people, nonLatin, minorHint, missing: people.every((p) => !p.givenKey && !p.initial && !p.surnameKey) };
}

/**
 * For STORING a name typed in one box: "Maria de la Cruz" is first "Maria", last "de la Cruz"; "Ahmed al-Farsi" is first "Ahmed", last
 * "al-Farsi"; "Rahul K. Shah" is first "Rahul K.", last "Shah". "Shah, Rahul" is read as last, first. The particles of many cultures go
 * with the family name. The text keeps the case it was typed in.
 */
export function splitFullName(full: string): { first: string; last: string } {
  const s = cleanText(full);
  const comma = s.indexOf(",");
  if (comma > 0) return { last: s.slice(0, comma).trim(), first: s.slice(comma + 1).trim() };
  const parts = s.split(" ");
  if (parts.length === 1) return { first: "", last: parts[0] ?? "" };
  const toks = parts.map(cleanWord);
  let at = parts.length - 1;
  while (at - 1 >= 1 && isParticleAt(toks, at - 1, false)) at--;
  return { first: parts.slice(0, at).join(" "), last: parts.slice(at).join(" ") };
}
