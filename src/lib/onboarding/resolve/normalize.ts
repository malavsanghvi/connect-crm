// Normalisers for the resolve engine: names, phones, e-mails, addresses, dates and money.
// Pure. Each function turns messy text into a form that is EQUAL when two spellings mean the same thing, and says
// plainly when it cannot tell (ambiguous dates are flagged, never guessed). The forms are for comparing; the
// person's own text is what gets stored.
//
// Built for every country and script: text is folded, never narrowed to English (intl/fold.ts); names know the honorifics,
// particles and spelling variants of many cultures (names.ts); phones are read with a country calling-code table, and a number
// without a country code takes the community's own country (intl/phone.ts); postal codes, street types and month names are
// those of many countries (intl/postal.ts, intl/address-words.ts).
//
// Reused rather than rewritten: money through `toCents`, e-mail keys through `emailKey`.

import { ageOn } from "@/lib/dates";
import { cleanText, excelSerialToDate, toCents } from "@/lib/import/transforms";
import { emailKey } from "@/lib/onboarding/normalize";

import { GLUED_SUFFIXES, MONTH_NUMBERS, NAME_LINKS, NUMBER_WORDS, PREFIX_TYPES, SUFFIX_TYPES, UNIT_WORDS } from "../intl/address-words";
import { asciiDigits, foldText, table } from "../intl/fold";
import { countryFromText, parsePhone } from "../intl/phone";
import { parsePostal } from "../intl/postal";
import type { ResolveConfig } from "./config";
import type {
  MinorReason,
  MoneyProblem,
  NormalizedGift,
  NormalizedName,
  NormalizedRecord,
  ParsedAddress,
  ParsedDate,
  PhoneValue,
  RawRecord,
} from "./types";
import { normalizeName } from "./names";

// ---------------------------------------------------------------------------
// Text basics
// ---------------------------------------------------------------------------

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

// Names live in ./names.ts (folding, particles, honorifics and spelling variants for many cultures). They are re-exported here so
// callers keep one import.
export { foldAscii, hasNonLatinLetters, normalizeName, phoneticKey, stripAttachedSuffix } from "./names";

// ---------------------------------------------------------------------------
// Phones and e-mails
// ---------------------------------------------------------------------------

export type PhoneResult = { value: string | null; problem: string | null };

/**
 * E.164 for a phone number from any country. A number with a country code (+44, 0044) is read with it; one without takes the
 * community's own country (`defaultCountry`: an ISO code such as "GB" or a calling code such as "44"). When that is not known
 * either, a bare national number is NOT guessed (it is reported as unreadable), so it is never read as American by default.
 * "N/A" and blanks give no value and no problem; a bad number gives a problem.
 */
export function normalizePhone(raw: unknown, defaultCountry?: string | null): PhoneResult {
  const text = cleanText(raw);
  if (isBlankLike(text)) return { value: null, problem: null };
  const r = parsePhone(text, defaultCountry);
  return r.ok ? { value: r.e164, problem: null } : { value: null, problem: "phone" };
}

/** A cell can hold several numbers ("713-555-0142 / 281-555-0199", "98250 12345, 98250 12346"). */
export function normalizePhones(raw: unknown, defaultCountry?: string | null): { values: string[]; problems: string[] } {
  const text = cleanText(raw);
  if (isBlankLike(text)) return { values: [], problems: [] };
  const rough = text.split(/\s*(?:\/|;|\||\n|،|؛|\bor\b|\band\b|\bou\b|\boder\b|\by\b|\bund\b)\s*/i).filter(Boolean);
  const parts: string[] = [];
  for (const piece of rough.length > 0 ? rough : [text]) {
    // A comma separates two numbers only when each side is long enough to be one ("ext. 5" after a comma is not a number).
    const bits = piece.split(/\s*,\s*/).filter(Boolean);
    if (bits.length > 1 && bits.every((b) => b.replace(/\D/g, "").length >= 7)) parts.push(...bits);
    else parts.push(piece);
  }
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

const DIRECTION: Record<string, string> = table({
  n: "n", north: "n", s: "s", south: "s", e: "e", east: "e", w: "w", west: "w", ne: "ne", northeast: "ne", nw: "nw", northwest: "nw",
  se: "se", southeast: "se", sw: "sw", southwest: "sw",
});
const ORDINAL_WORDS: Record<string, string> = table({
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th", sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
});
/** A house number: 12, 12a, 12-14, 12/3, 12/a. */
const HOUSE_NUMBER = /^\d{1,6}[a-z]?(?:[/-]\d{1,4}[a-z]?|\/[a-z])?$/;
const BARE_UNIT = /^[a-z]?\d+[a-z]?$/;
const PO_BOX_WORDS = new Set(["pobox", "postfach", "apdo", "apartado", "bp"]);
/** Countries whose addresses put the house number AFTER the street name ("Hauptstrasse 12", "Calle Mayor 12"). */
const NUMBER_LAST = new Set(["DE", "AT", "CH", "NL", "BE", "LU", "DK", "NO", "SE", "FI", "PL", "CZ", "SK", "HU", "RO", "BG", "GR", "ES", "PT", "IT", "BR", "AR", "MX", "CL", "CO", "PE", "TR", "RU", "UA", "HR", "RS"]);

function cleanUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  const c = u.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, "");
  return c || null;
}

const UNIT_PREFIX = new RegExp(`^(?:(?:${[...UNIT_WORDS, ...NUMBER_WORDS].join("|")})\\s*#?\\s*|#\\s*)?([\\p{L}\\p{N}][\\p{L}\\p{N}-]{0,5})$`, "u");

/** A unit written alone on the second line: "Apt 4", "#4", "Suite 200", "4B", "Flat 3", "Piso 2". */
function unitFromLine2(line2: string): string | null {
  const s = foldText(line2).toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const m = UNIT_PREFIX.exec(s);
  return m ? cleanUnit(m[1]) : null;
}

/**
 * Splits a street address into house number, direction, street name, street type, unit and postal code, however it is
 * written and in what country: "12 N. Lotus Lane #4", "12 Lotus Ln, Apt 4B", "PO Box 77", "Hauptstrasse 12a", "12 rue de la Paix",
 * "Calle Mayor 12, 3 B", "Flat 4, 12 Lotus Road". The postal code is read in the format of the country (US ZIP and ZIP+4,
 * Canadian, British, Indian PIN, German, French ...); `country` is the address's own country, else the community's.
 * The `streetKey` (number + street name only) is what records are blocked on; postal code and unit are compared afterwards.
 */
export function normalizeAddress(
  input: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    country?: string | null;
  },
  opts: { country?: string | null } = {},
): ParsedAddress | null {
  const line1 = foldText(cleanText(input.line1)).toLowerCase();
  if (isBlankLike(line1)) return null;
  const iso = countryFromText(cleanText(input.country)) ?? countryFromText(cleanText(opts.country));

  const postal = parsePostal(input.zip, iso);
  const zip5 = postal ? postal.code : null;
  const zip4 = postal ? postal.plus4 : null;

  const tokens = asciiDigits(line1)
    .replace(/\bc\/(?!o\b)/g, "calle ")
    .replace(/#/g, " # ")
    .replace(/[.,;]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const poBox =
    (PO_BOX_WORDS.has(tokens[0] ?? "") && /\d/.test(tokens[1] ?? "")) ||
    (tokens[0] === "po" && tokens[1] === "box") ||
    (tokens[0] === "p" && tokens[1] === "o" && tokens[2] === "box");
  let unit: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? "";
    if ((UNIT_WORDS.has(t) || t === "#") && tokens[i + 1] && !poBox) {
      let u = tokens[i + 1] ?? "";
      if (u === "#" && tokens[i + 2]) {
        u = tokens[i + 2] ?? "";
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
    // "No. 12 Lotus Lane", "Nr 12".
    if (body.length >= 2 && NUMBER_WORDS.has(body[0] ?? "") && HOUSE_NUMBER.test(body[1] ?? "")) body = body.slice(1);
    // A flat before the house: "Flat 4, 12 Lotus Road" has lost "flat 4" above and starts with the number.
    if (body.length > 0 && HOUSE_NUMBER.test(body[0] ?? "")) {
      number = body[0] ?? null;
      body = body.slice(1);
    } else {
      // Street name first, number after it (German, Dutch, Spanish, Italian, Portuguese ...): "Hauptstrasse 12a", "Calle Mayor 12".
      const named = (t: string) => PREFIX_TYPES[t] !== undefined || GLUED_SUFFIXES.some(([w]) => t.length > w.length + 2 && t.endsWith(w)) || SUFFIX_TYPES[t] === "st";
      const numberLast = (iso !== null && NUMBER_LAST.has(iso)) || (body.length >= 2 && named(body[0] ?? "")) || named(body[body.length - 2] ?? "");
      if (numberLast) {
        const at = body.findIndex((t, i) => i >= 1 && HOUSE_NUMBER.test(t) && !/^\d+(?:st|nd|rd|th)$/.test(t));
        if (at >= 1) {
          number = body[at] ?? null;
          const after = body.slice(at + 1);
          body = body.slice(0, at);
          // "Calle Mayor 12 3 B": what follows the number is the floor and door, when it is short.
          if (!unit && after.length > 0 && after.length <= 2 && after.every((t) => t.length <= 4)) unit = cleanUnit(after.join(""));
        }
      }
    }
    // Direction before the street name, only when a real street name follows.
    if (body.length >= 2 && DIRECTION[body[0] ?? ""] && body.slice(1).some((t) => SUFFIX_TYPES[t] === undefined && !DIRECTION[t])) {
      predir = DIRECTION[body[0] ?? ""] ?? null;
      body = body.slice(1);
    }
    // A bare unit after the suffix: "12 Lotus Ln 4".
    const sIdx = body.findIndex((t, i) => i > 0 && SUFFIX_TYPES[t] !== undefined);
    if (sIdx >= 0 && sIdx < body.length - 1) {
      const after = body.slice(sIdx + 1);
      const d0 = DIRECTION[after[0] ?? ""];
      if (after.length === 1 && d0) postdir = d0;
      else if (after.length === 1 && BARE_UNIT.test(after[0] ?? "") && !unit) unit = cleanUnit(after[0]);
      else if (after.length === 2 && d0 && BARE_UNIT.test(after[1] ?? "") && !unit) {
        postdir = d0;
        unit = cleanUnit(after[1]);
      }
      body = body.slice(0, sIdx + 1);
    } else if (body.length >= 2 && DIRECTION[body[body.length - 1] ?? ""] && SUFFIX_TYPES[body[body.length - 2] ?? ""] !== undefined) {
      postdir = DIRECTION[body[body.length - 1] ?? ""] ?? null;
      body = body.slice(0, -1);
    }
    if (body.length >= 2 && SUFFIX_TYPES[body[body.length - 1] ?? ""] !== undefined) {
      suffix = SUFFIX_TYPES[body[body.length - 1] ?? ""] ?? null;
      body = body.slice(0, -1);
    } else if (body.length >= 2 && PREFIX_TYPES[body[0] ?? ""] !== undefined) {
      // "Calle Mayor", "Rue de la Paix", "Via Roma": the type comes first, and "de la" links it to the name.
      suffix = PREFIX_TYPES[body[0] ?? ""] ?? null;
      body = body.slice(1);
      while (body.length >= 2 && NAME_LINKS.has(body[0] ?? "")) body = body.slice(1);
    } else if (body.length === 1) {
      // "Hauptstrasse", "Kerkstraat": the type is written onto the name.
      const only = body[0] ?? "";
      const glued = GLUED_SUFFIXES.find(([w]) => only.length >= w.length + 3 && only.endsWith(w));
      if (glued) {
        suffix = glued[1];
        body = [only.slice(0, only.length - glued[0].length).replace(/-+$/, "")];
      }
    }
    street =
      body
        .flatMap((t) => t.split("-"))
        .filter(Boolean)
        .map((t) => ORDINAL_WORDS[t] ?? t)
        .join(" ") || null;
  }

  if (!unit && input.line2) unit = unitFromLine2(cleanText(input.line2));

  const streetKey = number && street ? `${number}|${street}` : "";
  const city = foldText(cleanText(input.city)).toLowerCase() || null;
  const state = foldText(cleanText(input.state)).toLowerCase().replace(/[^\p{L}]/gu, "") || null;
  if (!streetKey && !zip5) return null;
  return { number, predir, street, suffix, postdir, unit, city, state, zip5, zip4, poBox, streetKey };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

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
  const s = asciiDigits(cleanText(input));
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
  // Chinese, Japanese and Korean: 1987年4月3日, 1987년 4월 3일, 1987. 4. 3.
  if ((m = /^(\d{4})\s*(?:年|년|\.)\s*(\d{1,2})\s*(?:月|월|\.)\s*(\d{1,2})\s*(?:日|일|\.)?$/.exec(s))) {
    const v = iso(Number(m[1]), Number(m[2]), Number(m[3]));
    return v ? parsedFrom([v], false, false) : unreadable("unreadable");
  }
  // "3 March 1987", "3rd of March 1987", "3 de marzo de 1987", "3. März 1987", "3 mars 1987", "3 марта 1987".
  if ((m = /^(\d{1,2})(?:st|nd|rd|th|er|º|\.)?[-\s]*(?:de\s+|del\s+|of\s+)?([\p{L}\p{M}]{3,14})\.?,?[-\s]*(?:de\s+|del\s+)?(\d{2}|\d{4})$/u.exec(s))) {
    const mon = monthNumber(m[2]);
    if (mon) return fromNamed(Number(m[1]), mon, m[3], opts);
  }
  // "March 3, 1987", "Marzo 3 1987".
  if ((m = /^([\p{L}\p{M}]{3,14})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})$/u.exec(s))) {
    const mon = monthNumber(m[1]);
    if (mon) return fromNamed(Number(m[2]), mon, m[3], opts);
  }
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const v = excelSerialToDate(Number(s));
    if (v) return parsedFrom([v], false, false);
  }
  return unreadable("unreadable");
}

/** A month written as a word in English, Spanish, Portuguese, French, German, Italian, Dutch, Polish, Turkish, Russian, Hindi or Arabic. */
function monthNumber(word: string | undefined): number | null {
  if (!word) return null;
  return MONTH_NUMBERS.get(foldText(word).toLowerCase().replace(/\.$/, "")) ?? null;
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

  // A row that names its own country reads a bare local number in that country; otherwise the community's country applies.
  const homeCountry = countryFromText(cleanText(raw.country)) ?? (cfg.defaultCountry || cfg.country || null);
  const phones: PhoneValue[] = [];
  const addPhones = (value: unknown, mobile: boolean) => {
    const r = normalizePhones(value, homeCountry);
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

  const address = normalizeAddress(
    { line1: raw.address1, line2: raw.address2, city: raw.city, state: raw.state, zip: raw.zip, country: raw.country },
    { country: cfg.country || cfg.defaultCountry || null },
  );
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
