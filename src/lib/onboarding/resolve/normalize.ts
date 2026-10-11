// Normalisers for the resolve engine: names, phones, e-mails, addresses, dates and money.
// Pure. Each function turns messy text into a form that is EQUAL when two spellings mean the same thing, and says
// plainly when it cannot tell (ambiguous dates are flagged, never guessed). The forms are for comparing; the
// person's own text is what gets stored.
//
// Reused rather than rewritten: phones go through `toE164`, money through `toCents`, e-mail keys through `emailKey`,
// nicknames come from the existing smart-matching pass (onboarding/normalize.ts).

import { ageOn } from "@/lib/dates";
import { cleanText, excelSerialToDate, toCents, toE164 } from "@/lib/import/transforms";
import { emailKey, NICKNAMES } from "@/lib/onboarding/normalize";

import type { ResolveConfig } from "./config";
import type {
  Generation,
  MinorReason,
  MoneyProblem,
  NamePart,
  NormalizedGift,
  NormalizedName,
  NormalizedRecord,
  ParsedAddress,
  ParsedDate,
  PhoneValue,
  RawRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Text basics
// ---------------------------------------------------------------------------

/** Accents on Latin letters are dropped ("Ramírez" -> "Ramirez"); other scripts are left alone. */
export function foldAscii(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/(?<=\p{Script=Latin})\p{M}+/gu, "")
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");
}

/** True when the text has letters from a script other than Latin (Gujarati, Devanagari). */
export function hasNonLatinLetters(s: string): boolean {
  for (const ch of s) {
    if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) return true;
  }
  return false;
}

const BLANK_LIKE = /^(?:n\/?a|none|nil|null|unknown|not available|-+|\.+|x+|\?+)$/i;

function isBlankLike(s: string): boolean {
  return s === "" || BLANK_LIKE.test(s);
}

/** A short stable hash (FNV-1a, 32 bit, hex) used to recognise the same record again. Not a secret. */
export function hash32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * A sound-alike key for one name word, so Latin spellings of Gujarati and Hindi names compare equal:
 * Patel = Patil = Pattel, Shah = Saha, Mehta = Metha, Desai = Dessai, Doshi = Dosi, Parekh = Parikh, Thakkar = Thaker.
 * It is deliberately coarse. A key match is never enough to join two records on its own (names alone never join).
 */
export function phoneticKey(token: string): string {
  let s = foldAscii(token).toLowerCase().replace(/[^a-z]/g, "");
  // Applied until nothing changes, so a key of a key is itself.
  for (let pass = 0; pass < 6; pass++) {
    const next = phoneticPass(s);
    if (next === s) break;
    s = next;
  }
  return s;
}

function phoneticPass(word: string): string {
  let s = word.replace(/(.)\1+/g, "$1");
  s = s.replace(/w/g, "v").replace(/q/g, "k").replace(/ph/g, "f").replace(/ck/g, "k");
  s = s.replace(/sh/g, "s").replace(/ch/g, "c").replace(/kh/g, "k").replace(/gh/g, "g").replace(/bh/g, "b");
  s = s.replace(/dh/g, "d").replace(/th/g, "t").replace(/jh/g, "j");
  s = s.replace(/h/g, "");
  s = s.replace(/er$/, "ar");
  s = s.replace(/ou|oo/g, "u");
  s = s.replace(/(?!^)y/g, "i").replace(/e/g, "i");
  return s.replace(/(.)\1+/g, "$1");
}

const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "mx", "dr", "prof", "shri", "shree", "sri", "smt", "shrimati", "kum", "pt", "pandit", "rev", "sir", "sh",
]);
const MINOR_TITLES = new Set(["master", "baby"]);
const FAMILY_WORDS = new Set(["family", "families", "household", "residence", "fam", "hh"]);
const PROFESSIONAL = new Set(["md", "phd", "cpa", "esq", "dds", "rn", "mba", "dvm", "pe"]);
const GENERATIONS: Record<string, Generation> = {
  jr: "jr", junior: "jr", sr: "sr", senior: "sr", ii: "ii", iii: "iii", iv: "iv", "2nd": "ii", "3rd": "iii",
};
/** Words in brackets that are not a name: "Mira (wife)". */
const NOT_A_NAME = new Set(["wife", "husband", "mother", "father", "mom", "dad", "son", "daughter", "home", "work", "cell", "mobile", "jr", "sr", "late", "deceased"]);
/** Stand-alone words that follow a given name and carry no name of their own. */
const STANDALONE_SUFFIX = new Set(["bhai", "bhi", "ben", "behn", "bahen", "bein", "ji", "bhaii"]);

const ATTACHED_SUFFIXES: RegExp[] = [/^(.{3,}?)(?:bhai|bhaai|bhi)$/, /^(.{3,}?)(?:ben|behn|bahen|bein|baen)$/, /^(.{3,}?)(?:kumari|kumar)$/, /^(.{3,}?)ji$/];

/** "Rahulbhai" -> "rahul", "Miraben" -> "mira", "Ashokkumar" -> "ashok", "Hasmukhji" -> "hasmukh". One pass. */
export function stripAttachedSuffix(token: string): string {
  const t = token.toLowerCase();
  for (const re of ATTACHED_SUFFIXES) {
    const m = re.exec(t);
    if (m) return m[1];
  }
  return t;
}

function cleanWord(t: string): string {
  return foldAscii(t).toLowerCase().replace(/[^a-z'-]/g, "").replace(/^[-']+|[-']+$/g, "");
}

function givenKeyOf(word: string): string {
  const folded = NICKNAMES[word] ?? word;
  return phoneticKey(folded);
}

function emptyPart(): NamePart {
  return { given: null, givenKey: null, initial: null, middleKeys: [], surname: null, surnameKey: null, surnameParts: [], maidenKey: null, generation: null };
}

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

function buildPart(segment: Segment, surnameRaw: string | null, maidenRaw: string | null, generation: Generation | null): NamePart {
  const part = emptyPart();
  const words = segment.tokens;
  const givenWords: string[] = [];
  for (const w of words) {
    const c = cleanWord(w);
    if (c) givenWords.push(c);
  }
  if (givenWords.length > 0) {
    const first = givenWords[0];
    if (first.length === 1) {
      part.initial = first;
    } else {
      const stem = stripAttachedSuffix(first);
      part.given = stem;
      part.givenKey = givenKeyOf(stem);
      part.initial = stem[0];
    }
    part.middleKeys = givenWords
      .slice(1)
      .map((w) => (w.length === 1 ? w : givenKeyOf(stripAttachedSuffix(w))))
      .filter(Boolean);
  }
  if (surnameRaw) {
    const parts = cleanWord(surnameRaw)
      .split("-")
      .filter(Boolean);
    if (parts.length > 0) {
      part.surname = parts.join("-");
      part.surnameParts = parts.map(phoneticKey).filter(Boolean);
      part.surnameKey = part.surnameParts[part.surnameParts.length - 1] ?? null;
      // "Shah-Patel": the first half is the maiden name, the last half the name in use.
      if (parts.length > 1) part.maidenKey = part.surnameParts[0] ?? null;
    }
  }
  if (maidenRaw) {
    const k = phoneticKey(cleanWord(maidenRaw));
    if (k) part.maidenKey = k;
  }
  part.generation = generation;
  return part;
}

/**
 * Splits a name into people, given names, middle names, a surname, a maiden name and a generation (Jr/Sr), however it is
 * written: "Last, First", "First Last", "Rahul & Mira Shah", "Dr. Miraben Patel nee Shah", "Mira Shah-Patel", "R. K. Shah".
 * Honorifics (Shri, Smt, Dr), suffixes (-bhai, -ben, -kumar, -ji), family words (Family, Household) are dropped.
 * Names in another script are flagged (`nonLatin`), not guessed.
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
  if ((first || last) && !full) text = first && last ? `${last}, ${first}` : last ? `${last},` : first;
  else text = full;

  let s = foldAscii(text);
  let maiden: string | null = null;
  s = s.replace(/\b(?:nee|maiden(?:\s+name)?)\b\.?\s*[:-]?\s*([A-Za-z][A-Za-z'-]+)/i, (_m, w: string) => {
    maiden = w;
    return " ";
  });
  s = s.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    const w = inner.trim();
    if (/^[A-Za-z][A-Za-z'-]+$/.test(w) && !NOT_A_NAME.has(w.toLowerCase()) && !GENERATIONS[w.toLowerCase()]) maiden = maiden ?? w;
    return " ";
  });
  s = s.replace(/\s+/g, " ").trim();

  let surnameFromComma: string | null = null;
  let body = s;
  const comma = s.indexOf(",");
  if (comma >= 0) {
    const before = s.slice(0, comma).trim();
    const after = s.slice(comma + 1).trim();
    const afterWords = after.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase().replace(/\./g, ""));
    const onlySuffixes = afterWords.length > 0 && afterWords.every((w) => GENERATIONS[w] || PROFESSIONAL.has(w) || HONORIFICS.has(w));
    if (onlySuffixes) body = `${before} ${after}`;
    else if (before) {
      // "Shah Patel, Mira" -> surname parts joined like "Shah-Patel".
      surnameFromComma = before.split(/[\s-]+/).filter(Boolean).join("-");
      body = after;
    } else body = after;
  }

  const spaced = body.replace(/\s*[&+]\s*/g, " & ");
  const rawTokens = splitInitials(spaced.split(/\s+/).filter(Boolean));
  const segments: Segment[] = [{ tokens: [], family: false }];
  let generation: Generation | null = null;
  let minorHint = false;
  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i];
    const lower = tok.toLowerCase().replace(/\.$/, "");
    if (tok === "&" || (lower === "and" && i > 0 && i < rawTokens.length - 1)) {
      segments.push({ tokens: [], family: false });
      continue;
    }
    const seg = segments[segments.length - 1];
    if (lower === "the" && seg.tokens.length === 0) continue;
    if (MINOR_TITLES.has(lower)) {
      minorHint = true;
      continue;
    }
    if (HONORIFICS.has(lower) || PROFESSIONAL.has(lower)) continue;
    if (GENERATIONS[lower] && seg.tokens.length > 0) {
      generation = GENERATIONS[lower];
      continue;
    }
    if (FAMILY_WORDS.has(lower)) {
      seg.family = true;
      continue;
    }
    // "Mira Ben Shah": a stand-alone ben/bhai after a given name is an honorific, not a name.
    if (STANDALONE_SUFFIX.has(lower) && seg.tokens.length > 0) continue;
    seg.tokens.push(tok);
  }

  const live = segments.filter((g) => g.tokens.length > 0);
  if (live.length === 0) {
    // Only a family name was given ("Shah," from a last-name column, or "Shah family").
    if (surnameFromComma) {
      const part = buildPart({ tokens: [], family: false }, surnameFromComma, maiden, generation);
      return { raw, people: [part], nonLatin, minorHint, missing: !part.surnameKey };
    }
    return { ...missing, minorHint };
  }

  // Work out each segment's surname.
  let carried: string | null = surnameFromComma;
  if (carried === null) {
    // The last word of the last segment is the shared surname when that segment has two words or more (or a family word).
    const tail = live[live.length - 1];
    if (tail.tokens.length >= 2 || tail.family) carried = tail.tokens[tail.tokens.length - 1];
  }
  const people: NamePart[] = [];
  live.forEach((g, idx) => {
    let ownSurname: string | null = null;
    const tokens = [...g.tokens];
    if (surnameFromComma !== null) {
      ownSurname = surnameFromComma;
    } else if (tokens.length >= 2 || (g.family && tokens.length === 1)) {
      ownSurname = tokens.pop() ?? null;
    } else if (idx < live.length - 1) {
      // A lone word before the last segment takes the family name that follows ("Rahul & Mira Shah").
      ownSurname = carried;
    }
    const segment: Segment = { tokens, family: g.family };
    people.push(buildPart(segment, ownSurname, idx === 0 ? maiden : null, generation));
  });

  return { raw, people, nonLatin, minorHint, missing: people.every((p) => !p.givenKey && !p.initial && !p.surnameKey) };
}

// ---------------------------------------------------------------------------
// Phones and e-mails
// ---------------------------------------------------------------------------

export type PhoneResult = { value: string | null; problem: string | null };

/** E.164 with US as the default country. "N/A" and blanks give no value and no problem; a bad number gives a problem. */
export function normalizePhone(raw: unknown, defaultCountry = "1"): PhoneResult {
  const text = cleanText(raw);
  if (isBlankLike(text)) return { value: null, problem: null };
  const t = toE164(text, defaultCountry);
  if (!t.ok) return { value: null, problem: "phone" };
  const v = t.value;
  const digits = v.slice(1);
  if (/^(\d)\1+$/.test(digits)) return { value: null, problem: "phone" };
  if (v.startsWith("+1")) {
    if (digits.length !== 11) return { value: null, problem: "phone" };
    const area = digits.slice(1, 4);
    const exchange = digits.slice(4, 7);
    if (!/^[2-9]/.test(area) || !/^[2-9]/.test(exchange) || area === "000") return { value: null, problem: "phone" };
  }
  return { value: v, problem: null };
}

/** A cell can hold several numbers ("713-555-0142 / 281-555-0199"). */
export function normalizePhones(raw: unknown, defaultCountry = "1"): { values: string[]; problems: string[] } {
  const text = cleanText(raw);
  if (isBlankLike(text)) return { values: [], problems: [] };
  const parts = text.split(/\s*(?:\/|;|\||\bor\b|\band\b)\s*/i).filter(Boolean);
  const values: string[] = [];
  const problems: string[] = [];
  for (const p of parts.length > 0 ? parts : [text]) {
    const r = normalizePhone(p, defaultCountry);
    if (r.value) {
      if (!values.includes(r.value)) values.push(r.value);
    } else if (r.problem) problems.push(r.problem);
  }
  return { values, problems };
}

export type EmailResult = { keys: string[]; problems: string[] };

/**
 * E-mail keys: lower-case; plus-tags and dots removed for Gmail (they reach the same inbox); angle brackets and
 * "mailto:" removed. A cell may hold several addresses.
 */
export function normalizeEmails(raw: unknown): EmailResult {
  const text = cleanText(raw);
  if (isBlankLike(text)) return { keys: [], problems: [] };
  const keys: string[] = [];
  const problems: string[] = [];
  for (const piece of text.split(/[;,\s]+/).filter(Boolean)) {
    const cleaned = piece.replace(/^mailto:/i, "").replace(/^[<(]+|[>).,]+$/g, "");
    const key = emailKey(cleaned);
    if (key) {
      if (!keys.includes(key)) keys.push(key);
    } else problems.push("email");
  }
  return { keys, problems };
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const STREET_SUFFIX: Record<string, string> = {
  street: "st", st: "st", str: "st", avenue: "ave", ave: "ave", av: "ave", road: "rd", rd: "rd", drive: "dr", dr: "dr", lane: "ln", ln: "ln",
  boulevard: "blvd", blvd: "blvd", court: "ct", ct: "ct", circle: "cir", cir: "cir", place: "pl", pl: "pl", terrace: "ter", ter: "ter",
  parkway: "pkwy", pkwy: "pkwy", highway: "hwy", hwy: "hwy", trail: "trl", trl: "trl", way: "way", square: "sq", sq: "sq", loop: "loop",
  path: "path", alley: "aly", crossing: "xing", xing: "xing", pike: "pike", run: "run", row: "row", cove: "cv", cv: "cv", bend: "bnd",
};
const DIRECTION: Record<string, string> = {
  n: "n", north: "n", s: "s", south: "s", e: "e", east: "e", w: "w", west: "w", ne: "ne", northeast: "ne", nw: "nw", northwest: "nw",
  se: "se", southeast: "se", sw: "sw", southwest: "sw",
};
const UNIT_WORDS = new Set(["apt", "apartment", "unit", "ste", "suite", "bldg", "building", "fl", "floor", "rm", "room", "lot", "spc", "space"]);
const ORDINAL_WORDS: Record<string, string> = {
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th", sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
};

function cleanUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  const c = u.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return c || null;
}

/** A unit written alone on the second line: "Apt 4", "#4", "Suite 200", "4B". */
function unitFromLine2(line2: string): string | null {
  const s = foldAscii(line2).toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const m = /^(?:(?:apt|apartment|unit|ste|suite|bldg|building|fl|floor|rm|room|lot|spc|space|no|number)\s*#?\s*|#\s*)?([a-z0-9][a-z0-9-]{0,5})$/.exec(s);
  return m ? cleanUnit(m[1]) : null;
}

/**
 * Splits a street address into house number, direction, street name, suffix, unit and ZIP (+4), however it is written:
 * "12 N. Lotus Lane #4", "12 Lotus Ln, Apt 4B", "12 north lotus lane apartment 4", "PO Box 77".
 * The `streetKey` (number + street name only) is what records are blocked on; ZIP and unit are compared afterwards.
 */
export function normalizeAddress(input: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): ParsedAddress | null {
  const line1 = foldAscii(cleanText(input.line1)).toLowerCase();
  if (isBlankLike(line1)) return null;

  const zipText = cleanText(input.zip);
  let zip5: string | null = null;
  let zip4: string | null = null;
  const zm = /(\d{5})(?:[-\s]?(\d{4}))?/.exec(zipText.replace(/\s+(?=\d{4}$)/, "-"));
  if (zm) {
    zip5 = zm[1];
    zip4 = zm[2] ?? null;
  } else if (/^\d{4}$/.test(zipText)) {
    zip5 = `0${zipText}`; // a spreadsheet ate the leading zero
  }

  const tokens = line1
    .replace(/#/g, " # ")
    .replace(/[.,;]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const poBox =
    tokens[0] === "pobox" || (tokens[0] === "po" && tokens[1] === "box") || (tokens[0] === "p" && tokens[1] === "o" && tokens[2] === "box");
  let unit: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ((UNIT_WORDS.has(t) || t === "#") && tokens[i + 1] && !poBox) {
      let u = tokens[i + 1];
      if (u === "#" && tokens[i + 2]) {
        u = tokens[i + 2];
        i++;
      }
      unit = cleanUnit(u);
      i++;
    } else rest.push(t);
  }

  let number: string | null = null;
  let predir: string | null = null;
  let postdir: string | null = null;
  let suffix: string | null = null;
  let street: string | null = null;

  if (poBox) {
    const box = tokens.find((t) => /\d/.test(t)) ?? null;
    number = box ? box.replace(/\D/g, "") : null;
    street = "po box";
  } else {
    let body = rest;
    if (body.length > 0 && /^\d+[a-z]?(?:-\d+[a-z]?)?$/.test(body[0])) {
      number = body[0];
      body = body.slice(1);
    }
    // Direction before the street name, only when a real street name follows.
    if (body.length >= 2 && DIRECTION[body[0]] && body.slice(1).some((t) => !STREET_SUFFIX[t] && !DIRECTION[t])) {
      predir = DIRECTION[body[0]];
      body = body.slice(1);
    }
    // A bare unit after the suffix: "12 Lotus Ln 4".
    const sIdx = body.findIndex((t, i) => i > 0 && STREET_SUFFIX[t] !== undefined);
    if (sIdx >= 0 && sIdx < body.length - 1) {
      const after = body.slice(sIdx + 1);
      if (after.length === 1 && DIRECTION[after[0]]) postdir = DIRECTION[after[0]];
      else if (after.length === 1 && /^[a-z]?\d+[a-z]?$/.test(after[0]) && !unit) unit = cleanUnit(after[0]);
      else if (after.length === 2 && DIRECTION[after[0]] && /^[a-z]?\d+[a-z]?$/.test(after[1]) && !unit) {
        postdir = DIRECTION[after[0]];
        unit = cleanUnit(after[1]);
      }
      body = body.slice(0, sIdx + 1);
    } else if (body.length >= 2 && DIRECTION[body[body.length - 1]] && STREET_SUFFIX[body[body.length - 2]] !== undefined) {
      postdir = DIRECTION[body[body.length - 1]];
      body = body.slice(0, -1);
    }
    if (body.length >= 2 && STREET_SUFFIX[body[body.length - 1]] !== undefined) {
      suffix = STREET_SUFFIX[body[body.length - 1]];
      body = body.slice(0, -1);
    }
    street = body.map((t) => ORDINAL_WORDS[t] ?? t).join(" ") || null;
  }

  if (!unit && input.line2) unit = unitFromLine2(cleanText(input.line2));

  const streetKey = number && street ? `${number}|${street}` : "";
  const city = foldAscii(cleanText(input.city)).toLowerCase() || null;
  const state = foldAscii(cleanText(input.state)).toLowerCase().replace(/[^a-z]/g, "") || null;
  if (!streetKey && !zip5) return null;
  return { number, predir, street, suffix, postdir, unit, city, state, zip5, zip4, poBox, streetKey };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1800 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDaysIso(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The years a two-digit year can mean. For a birth date, 17-26 could be 2017-2026 or 1917-1926: both are kept. */
function yearsFor(yy: number, today: string, context: "birth" | "event"): number[] {
  const thisYear = Number(today.slice(0, 4));
  const limit = context === "birth" ? thisYear : thisYear + 1;
  const out: number[] = [];
  if (2000 + yy <= limit) out.push(2000 + yy);
  const old = 1900 + yy;
  if (context === "birth") {
    if (thisYear - old <= 110) out.push(old);
  } else if (out.length === 0) out.push(old);
  return out.length > 0 ? out : [1900 + yy];
}

function parsedFrom(alternatives: string[], twoDigitYear: boolean, ambiguous: boolean): ParsedDate {
  const alts = [...new Set(alternatives)].sort();
  const years = [...new Set(alts.map((a) => Number(a.slice(0, 4))))].sort((a, b) => a - b);
  return {
    iso: alts.length === 1 ? alts[0] : null,
    alternatives: alts,
    ambiguous: alts.length > 1 ? true : ambiguous,
    twoDigitYear,
    years,
    problem: null,
  };
}

const unreadable = (problem: string): ParsedDate => ({ iso: null, alternatives: [], ambiguous: false, twoDigitYear: false, years: [], problem });

/**
 * The day/month order of one file, found the way a person would: a first or second number above 12 can only be a day.
 * "13/04/1987" says day first; "04/13/1987" says month first. Both seen, or neither, means unknown (and every ambiguous
 * date in that file is then flagged instead of guessed).
 */
export function detectDateOrder(samples: readonly unknown[]): { order: "mdy" | "dmy" | "unknown"; mdy: number; dmy: number } {
  let mdy = 0;
  let dmy = 0;
  for (const v of samples) {
    const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\s*$/.exec(cleanText(v));
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy += 1;
    else if (b > 12 && a <= 12) mdy += 1;
  }
  return { order: mdy > 0 && dmy === 0 ? "mdy" : dmy > 0 && mdy === 0 ? "dmy" : "unknown", mdy, dmy };
}

/**
 * Reads a date written many ways. When day and month could be swapped and the file's order is unknown, BOTH readings are
 * returned and `ambiguous` is set: 03/04/1987 is never guessed. "13/04/1987", "1987-04-03" and "4 Mar 1987" are certain.
 * Two-digit years: a birth year is read against today, and kept as two readings when both centuries are possible.
 */
export function parseDate(input: unknown, opts: { order: "mdy" | "dmy" | "unknown"; today: string; context: "birth" | "event" }): ParsedDate {
  if (input instanceof Date) {
    const v = iso(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate());
    return v ? parsedFrom([v], false, false) : unreadable("unreadable");
  }
  if (typeof input === "number") {
    const v = excelSerialToDate(input);
    return v ? parsedFrom([v], false, false) : unreadable("unreadable");
  }
  const s = cleanText(input);
  if (isBlankLike(s)) return unreadable("blank");
  let m: RegExpExecArray | null;

  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s))) {
    const v = iso(Number(m[1]), Number(m[2]), Number(m[3]));
    return v ? parsedFrom([v], false, false) : unreadable("unreadable");
  }
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) {
    const v = iso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (v) return parsedFrom([v], false, false);
  }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const twoDigit = m[3].length === 2;
    const years = twoDigit ? yearsFor(Number(m[3]), opts.today, opts.context) : [Number(m[3])];
    const mdy = (y: number) => iso(y, a, b);
    const dmy = (y: number) => iso(y, b, a);
    const readings: string[] = [];
    for (const y of years) {
      const x = mdy(y);
      const z = dmy(y);
      if (a === b) {
        if (x) readings.push(x);
      } else if (opts.order === "mdy") {
        // The file's order decides, unless the text can only be read the other way (a 13 cannot be a month).
        const pick = x ?? z;
        if (pick) readings.push(pick);
      } else if (opts.order === "dmy") {
        const pick = z ?? x;
        if (pick) readings.push(pick);
      } else {
        if (x) readings.push(x);
        if (z) readings.push(z);
      }
    }
    // A reading in the future is not a birth date or a past gift.
    const sane = readings.filter((r) => (opts.context === "birth" ? r <= opts.today : r <= addDaysIso(opts.today, 366)));
    const usable = sane.length > 0 ? sane : readings;
    return usable.length > 0 ? parsedFrom(usable, twoDigit, false) : unreadable("unreadable");
  }
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[-\s]([A-Za-z]{3,9})\.?,?[-\s]+(\d{2}|\d{4})$/.exec(s))) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) return fromNamed(Number(m[1]), mon, m[3], opts);
  }
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})$/.exec(s))) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon) return fromNamed(Number(m[2]), mon, m[3], opts);
  }
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const v = excelSerialToDate(Number(s));
    if (v) return parsedFrom([v], false, false);
  }
  return unreadable("unreadable");
}

function fromNamed(day: number, month: number, yearText: string, opts: { today: string; context: "birth" | "event" }): ParsedDate {
  const twoDigit = yearText.length === 2;
  const years = twoDigit ? yearsFor(Number(yearText), opts.today, opts.context) : [Number(yearText)];
  const readings = years.map((y) => iso(y, month, day)).filter((x): x is string => x !== null);
  return readings.length > 0 ? parsedFrom(readings, twoDigit, false) : unreadable("unreadable");
}

// ---------------------------------------------------------------------------
// Money and identifiers
// ---------------------------------------------------------------------------

/** Money to integer cents. Zero and negative amounts are returned with a problem so a person decides (tier D). */
export function normalizeMoney(raw: unknown): { cents: number | null; problem: MoneyProblem | null } {
  if (raw === null || raw === undefined || cleanText(raw) === "") return { cents: null, problem: "blank" };
  const t = toCents(raw, { allowZero: true, allowNegative: true });
  if (!t.ok) return { cents: null, problem: "unreadable" };
  if (t.value === 0) return { cents: 0, problem: "zero" };
  if (t.value < 0) return { cents: t.value, problem: "negative" };
  return { cents: t.value, problem: null };
}

/** Case, spaces and dashes ignored; all-digit IDs lose leading zeros (a spreadsheet may have eaten them). */
export function normalizeIdValue(v: unknown): string | null {
  const s = cleanText(v).toLowerCase().replace(/[\s_-]+/g, "");
  if (!s || BLANK_LIKE.test(s)) return null;
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s;
}

/** A check or transaction number: "Check #4512" and "004512" are the same. */
export function normalizeRef(v: unknown): string | null {
  const s = cleanText(v).toLowerCase().replace(/^(?:check|chk|cheque|ref|txn|trx|transaction|no|number)[\s.:#-]*/i, "").replace(/[^a-z0-9]/g, "");
  if (!s) return null;
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s;
}

// ---------------------------------------------------------------------------
// One record
// ---------------------------------------------------------------------------

const CHILD_ROLE_WORDS = new Set(["child", "son", "daughter", "kid", "minor", "student", "learner", "pupil", "grandchild", "dependent", "boy", "girl", "baby", "infant", "toddler"]);

function minorOf(raw: RawRecord, name: NormalizedName, dob: ParsedDate | null, cfg: ResolveConfig): { isMinor: boolean; reasons: MinorReason[] } {
  const reasons: MinorReason[] = [];
  if (raw.isChild === true) reasons.push("flag");
  if (typeof raw.age === "number" && raw.age >= 0 && raw.age < cfg.minorAge) reasons.push("age");
  if (dob) {
    // Every reading counts: a birth date that could mean a minor holds the record.
    for (const alt of dob.alternatives) {
      const age = ageOn(alt, cfg.today);
      if (age !== null && age < cfg.minorAge) {
        reasons.push("birth_date");
        break;
      }
    }
  }
  const role = cleanText(raw.role).toLowerCase();
  if (role && role.split(/[\s/,&-]+/).some((w) => CHILD_ROLE_WORDS.has(w))) reasons.push("role");
  if (!isBlankLike(cleanText(raw.school)) || !isBlankLike(cleanText(raw.grade))) reasons.push("school_or_grade");
  if (name.minorHint) reasons.push("title");
  return { isMinor: reasons.length > 0, reasons };
}

function fingerprintOf(r: Omit<NormalizedRecord, "fingerprint">): string {
  const p = r.name.people[0];
  const parts = [
    r.kind,
    r.name.people.map((x) => `${x.givenKey ?? x.initial ?? ""}.${x.surnameKey ?? ""}`).join("+"),
    r.phones.map((x) => x.value).sort().join(","),
    [...r.emails].sort().join(","),
    r.address ? `${r.address.streetKey}|${r.address.unit ?? ""}|${r.address.zip5 ?? ""}` : "",
    r.dob ? r.dob.alternatives.join(",") : "",
    Object.entries(r.ids)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(","),
    r.gift ? `${r.gift.cents ?? ""}|${r.gift.date.alternatives.join(",")}|${r.gift.ref ?? ""}` : "",
    p ? p.generation ?? "" : "",
  ];
  return hash32(parts.join("␟"));
}

/** Everything the engine compares, computed once per record. */
export function normalizeRecord(raw: RawRecord, order: number, cfg: ResolveConfig): NormalizedRecord {
  const problems: string[] = [];
  const name = normalizeName({ full: raw.name, first: raw.firstName, last: raw.lastName });
  const dateOrder = cfg.dateOrderBySource[raw.source] ?? cfg.dateOrder;

  const phones: PhoneValue[] = [];
  const addPhones = (value: unknown, mobile: boolean) => {
    const r = normalizePhones(value, cfg.defaultCountry);
    problems.push(...r.problems);
    for (const v of r.values) {
      const existing = phones.find((p) => p.value === v);
      if (existing) existing.mobile = existing.mobile || mobile;
      else phones.push({ value: v, mobile });
    }
  };
  addPhones(raw.mobile, true);
  addPhones(raw.phone, false);
  addPhones(raw.phone2, false);

  const emails: string[] = [];
  for (const e of [raw.email, raw.email2]) {
    const r = normalizeEmails(e);
    problems.push(...r.problems);
    for (const k of r.keys) if (!emails.includes(k)) emails.push(k);
  }

  const address = normalizeAddress({ line1: raw.address1, line2: raw.address2, city: raw.city, state: raw.state, zip: raw.zip });
  if (cleanText(raw.address1) && !address) problems.push("address");

  let dob: ParsedDate | null = null;
  if (raw.dob !== null && raw.dob !== undefined && !isBlankLike(cleanText(raw.dob))) {
    dob = parseDate(raw.dob, { order: dateOrder, today: cfg.today, context: "birth" });
    if (dob.problem) {
      problems.push("date of birth");
      dob = null;
    }
  }

  const ids: Record<string, string> = {};
  for (const [system, value] of Object.entries(raw.ids ?? {})) {
    const v = normalizeIdValue(value);
    if (v) ids[system.toLowerCase()] = v;
  }

  let gift: NormalizedGift | null = null;
  if (raw.gift) {
    const money = normalizeMoney(raw.gift.amount);
    const date = parseDate(raw.gift.date, { order: dateOrder, today: cfg.today, context: "event" });
    if (date.problem) problems.push("gift date");
    gift = { cents: money.cents, problem: money.problem, date, ref: normalizeRef(raw.gift.ref), fund: cleanText(raw.gift.fund) || null };
  }

  const typeUncertain = raw.kind === "unknown" || (raw.kind === "gift" && !raw.gift) || (raw.kind !== "gift" && !!raw.gift);

  const base: Omit<NormalizedRecord, "fingerprint"> = {
    id: raw.id,
    source: raw.source,
    sourceKind: raw.sourceKind,
    row: raw.row,
    order,
    kind: raw.kind,
    readConfidence: typeof raw.readConfidence === "number" ? raw.readConfidence : null,
    name,
    phones,
    emails,
    address,
    dob,
    ids,
    existing: raw.existing ?? null,
    gift,
    minor: minorOf(raw, name, dob, cfg),
    typeUncertain,
    problems: [...new Set(problems)],
  };
  return { ...base, fingerprint: fingerprintOf(base) };
}

export function normalizeRecords(raws: readonly RawRecord[], cfg: ResolveConfig): NormalizedRecord[] {
  return raws.map((r, i) => normalizeRecord(r, i, cfg));
}
