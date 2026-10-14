// Text folding for matching names, streets and dates written in any script. Pure, no dependencies, and free of `@/`
// imports so the crawler worker can bundle it too.
//
// The rule: fold what carries no meaning for a match (accents on Latin, Greek, Cyrillic, Arabic and Hebrew letters,
// optional Arabic and Hebrew vowel marks, case) and keep everything else exactly as written. A name in Gujarati, Thai,
// Chinese or Korean is never dropped or guessed: it is compared as it is.

/** Letters whose combining marks are optional decoration. Marks on other scripts (Indic vowel signs) change the word. */
const OPTIONAL_MARK_BASE = "\\p{Script=Latin}\\p{Script=Greek}\\p{Script=Cyrillic}\\p{Script=Arabic}\\p{Script=Hebrew}";
const OPTIONAL_MARKS = new RegExp(`(?<=[${OPTIONAL_MARK_BASE}])\\p{M}+`, "gu");

/**
 * A lookup table with no inherited keys: a name, a street or a word that happens to be "constructor" or "toString" is not
 * found in it. (A plain object literal answers for those with a function.)
 */
export function table<T>(entries: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, entries);
}

/** Plain ASCII except the backtick (which is folded to an apostrophe). */
const ASCII_ONLY = /^[\x00-\x5f\x61-\x7f]*$/;

/** Latin letters that are not an accent on another letter, spelled the way an English keyboard would. */
const TRANSLITERATE: Record<string, string> = {
  "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ð": "d", "Ð": "D", "þ": "th", "Þ": "Th",
  "ß": "ss", "ẞ": "SS", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ı": "i", "ħ": "h", "Ħ": "H", "ŧ": "t", "Ŧ": "T",
  "ŋ": "ng", "Ŋ": "NG", "ſ": "s", "ƒ": "f", "ĸ": "k",
  // Arabic: alef forms, ya, kaf, ta marbuta and heh variants are written inconsistently, so they are one letter each.
  "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ی": "ي", "ک": "ك", "ة": "ه", "ہ": "ه", "ھ": "ه", "ـ": "",
  // Hebrew final forms; Greek final sigma.
  "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ", "ς": "σ",
};
const TRANSLITERATE_RE = new RegExp(`[${Object.keys(TRANSLITERATE).join("")}]`, "g");

/**
 * Folds text for comparing: NFKD, optional marks dropped, extended Latin letters spelled out (ø -> o, ł -> l, đ -> d, ß -> ss),
 * quotes and dashes made plain, then recomposed (NFC) so Hangul and kana stay readable. Case is NOT changed.
 */
export function foldText(s: string): string {
  // Plain ASCII has nothing to fold (quotes, dashes and accents are all outside it): the common case costs one test.
  if (ASCII_ONLY.test(s)) return s;
  return s
    .normalize("NFKD")
    .replace(OPTIONAL_MARKS, "")
    .replace(TRANSLITERATE_RE, (c) => TRANSLITERATE[c] ?? c)
    .replace(/[‘’ʼʻ`´]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .normalize("NFC");
}

/** True when the text has letters from a script other than Latin (Gujarati, Devanagari, Arabic, Cyrillic, Han ...). */
export function hasNonLatinLetters(s: string): boolean {
  if (ASCII_ONLY.test(s)) return false;
  for (const ch of s) {
    if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) return true;
  }
  return false;
}

/** True for a word made only of plain Latin letters (after folding): the words the sound-alike rules apply to. */
export function isPlainLatin(s: string): boolean {
  return /^[a-z]+$/.test(s);
}

/** First letter of the script class, for refusing to compare "R" with a Devanagari letter. */
export function scriptClass(s: string): "latin" | "other" | "none" {
  for (const ch of s) {
    if (!/\p{L}/u.test(ch)) continue;
    return /\p{Script=Latin}/u.test(ch) ? "latin" : "other";
  }
  return "none";
}

/** The first zero of each block of decimal digits that people type phone numbers and dates in. */
const DIGIT_ZEROS = [0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810, 0xff10];

/** Arabic-Indic, Persian, Devanagari, Gujarati, Thai ... digits to 0-9, so a number written in them can be read. */
export function asciiDigits(s: string): string {
  if (!/[^\u0000-\u007f]/.test(s)) return s;
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    let mapped: string | null = null;
    if (cp > 0x7f) {
      for (const zero of DIGIT_ZEROS) {
        if (cp >= zero && cp <= zero + 9) {
          mapped = String(cp - zero);
          break;
        }
      }
    }
    out += mapped ?? ch;
  }
  return out;
}
