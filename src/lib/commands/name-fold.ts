// One way of comparing text that holds a name, whatever the script: fold it (case, accents, width, invisible characters, the
// several ways Arabic and Hebrew letters are written, Hangul in either form, Traditional and Simplified Han), and describe each
// character (letter, digit, mark, separator; which script) so that a word can be told from the middle of a longer one.
// Pure: no I/O. Used by minor-names.ts, which decides what is a child's name.

import { simplifiedHan } from "./han-variants";

/** Character classes of a folded character. */
export const SEP = 0;
export const LOWER = 1;
export const UPPER = 2;
export const UNCASED = 3;
export const DIGIT = 4;
export const MARK = 5;

/** Scripts, as small numbers (compared, never shown). */
export const S_NONE = 0;
export const S_LATIN = 1;
export const S_CYRILLIC = 2;
export const S_GREEK = 3;
export const S_ARMENIAN = 4;
export const S_GEORGIAN = 5;
export const S_HAN = 6;
export const S_KANA = 7;
export const S_HANGUL = 8;
export const S_THAI = 9;
export const S_ARABIC = 10;
export const S_HEBREW = 11;
export const S_INDIC = 12;
export const S_OTHER = 13;

/** Scripts whose words are written without spaces: a separator between two of their letters is not a word break. */
const COMPACT = new Set([S_HAN, S_KANA, S_HANGUL, S_THAI]);

export function scriptOfCodePoint(cp: number): number {
  if (cp < 0x80) return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) ? S_LATIN : S_NONE;
  if ((cp >= 0xc0 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff) || (cp >= 0x2c60 && cp <= 0x2c7f) || (cp >= 0xa720 && cp <= 0xa7ff) || (cp >= 0x250 && cp <= 0x2af)) return S_LATIN;
  if ((cp >= 0x370 && cp <= 0x3ff) || (cp >= 0x1f00 && cp <= 0x1fff)) return S_GREEK;
  if ((cp >= 0x400 && cp <= 0x52f) || (cp >= 0x1c80 && cp <= 0x1c8f) || (cp >= 0x2de0 && cp <= 0x2dff) || (cp >= 0xa640 && cp <= 0xa69f)) return S_CYRILLIC;
  if (cp >= 0x530 && cp <= 0x58f) return S_ARMENIAN;
  if (cp >= 0x590 && cp <= 0x5ff) return S_HEBREW;
  if ((cp >= 0x600 && cp <= 0x6ff) || (cp >= 0x750 && cp <= 0x77f) || (cp >= 0x8a0 && cp <= 0x8ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) return S_ARABIC;
  if (cp >= 0x900 && cp <= 0xdff) return S_INDIC;
  if (cp >= 0xe00 && cp <= 0xeff) return S_THAI;
  if ((cp >= 0x10a0 && cp <= 0x10ff) || (cp >= 0x1c90 && cp <= 0x1cbf) || (cp >= 0x2d00 && cp <= 0x2d2f)) return S_GEORGIAN;
  if ((cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xac00 && cp <= 0xd7ff) || (cp >= 0xa960 && cp <= 0xa97f)) return S_HANGUL;
  if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff)) return S_KANA;
  if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x2fa1f) || (cp >= 0xf900 && cp <= 0xfaff) || cp === 0x3005 || cp === 0x3007 || (cp >= 0x3100 && cp <= 0x312f)) return S_HAN;
  return S_OTHER;
}

/** Scripts whose words are letters in a row and take endings or particles (so they are matched wherever they sit): all but these five. */
export function isAlphabeticScript(script: number): boolean {
  return script === S_LATIN || script === S_CYRILLIC || script === S_GREEK || script === S_ARMENIAN || script === S_GEORGIAN;
}

const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}ـ]/u;
const LETTER = /\p{L}/u;
const NUMBER = /\p{Nd}/u;
const MARK_RE = /\p{M}/u;
/** Scripts whose combining marks are decoration (accents, tone marks, vowel points); in other scripts the marks are letters. */
const MARKS_ARE_DECORATION = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}]/u;
const APOSTROPHES = new Set(["’", "ʼ", "ʻ", "`", "´", "′", "‘"]);
const SPECIAL: Readonly<Record<string, string>> = {
  "đ": "d", "ð": "d", "ø": "o", "ł": "l", "ı": "i", "ß": "ss", "æ": "ae", "œ": "oe", "þ": "th", "ħ": "h", "ŧ": "t", "ŋ": "ng", "ſ": "s",
  // Arabic, Persian and Urdu write the same letter several ways.
  "ک": "ك", "ی": "ي", "ى": "ي", "ة": "ه", "ہ": "ه", "ھ": "ه", "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ؤ": "و", "ئ": "ي", "ٹ": "ت", "ڈ": "د", "ڑ": "ر", "ں": "ن", "ے": "ي", "گ": "ك", "پ": "ب", "چ": "ج", "ژ": "ز",
  // Hebrew final forms; Greek final sigma.
  "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ", "ς": "σ",
  // Malayalam chillu letters are a consonant and a virama, however they are encoded.
  "ൻ": "ന്", "ർ": "ര്", "ൽ": "ല്", "ൾ": "ള്", "ൺ": "ണ്", "ൿ": "ക്",
};
/** The first code point of each run of ten digits in other scripts. */
const DIGIT_ZEROS = [0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810];

function asciiDigit(cp: number): string | null {
  for (const zero of DIGIT_ZEROS) if (cp >= zero && cp <= zero + 9) return String.fromCharCode(0x30 + cp - zero);
  return null;
}

export type Folded = {
  folded: string;
  /** For each UTF-16 unit of `folded`: where its source character starts and ends in the original text. */
  start: number[];
  end: number[];
  /** For each unit: SEP, LOWER, UPPER, UNCASED, DIGIT or MARK, and its script. */
  cls: number[];
  script: number[];
};

function classOf(piece: string, lowered: string): number {
  if (NUMBER.test(piece)) return DIGIT;
  if (MARK_RE.test(piece)) return MARK;
  if (!LETTER.test(piece)) return SEP;
  if (piece !== lowered) return UPPER;
  return piece !== piece.toUpperCase() ? LOWER : UNCASED;
}

/** Hangul written as separate letters (decomposed, as macOS file names are) becomes the syllable. */
function composeHangul(points: string[], i: number): { text: string; used: number } | null {
  const l = (points[i].codePointAt(0) as number) - 0x1100;
  if (l < 0 || l > 18 || i + 1 >= points.length) return null;
  const v = (points[i + 1].codePointAt(0) as number) - 0x1161;
  if (v < 0 || v > 20) return null;
  let t = 0;
  let used = 2;
  if (i + 2 < points.length) {
    const tt = (points[i + 2].codePointAt(0) as number) - 0x11a7;
    if (tt >= 1 && tt <= 27) {
      t = tt;
      used = 3;
    }
  }
  return { text: String.fromCodePoint(0xac00 + (l * 21 + v) * 28 + t), used };
}

const SEPARATOR_CHARS = new Set([" ", "-", "‐", "‑", "·", "•", ".", "_"]);

/** The text folded for comparison, with the positions needed to cut the original at the same place. */
export function foldWithMap(text: string): Folded {
  const points = Array.from(text);
  const chars: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  const cls: number[] = [];
  const script: number[] = [];
  let decoration = false;
  let at = 0;
  for (let i = 0; i < points.length; ) {
    let ch = points[i];
    let used = 1;
    const cp0 = ch.codePointAt(0) as number;
    if (cp0 >= 0x1100 && cp0 <= 0x1112) {
      const composed = composeHangul(points, i);
      if (composed) {
        ch = composed.text;
        used = composed.used;
      }
    }
    let length = 0;
    for (let k = 0; k < used; k += 1) length += points[i + k].length;
    const next = at + length;
    i += used;
    const cp = ch.codePointAt(0) as number;
    // Characters that are not there to the eye (zero-width, soft hyphen, joiners, byte order mark, tatweel ...) are not there.
    if (cp >= 0x80 && INVISIBLE.test(ch)) {
      at = next;
      continue;
    }
    const pieces = cp < 0x80 || (cp >= 0xac00 && cp <= 0xd7a3) ? [ch] : [...ch.normalize("NFKD")];
    for (const piece of pieces) {
      const pcp = piece.codePointAt(0) as number;
      if (pcp >= 0x80 && INVISIBLE.test(piece)) continue;
      let out: string;
      let c: number;
      if (pcp < 0x80) {
        out = piece.toLowerCase();
        if (pcp < 0x20 && pcp !== 0x09 && pcp !== 0x0a && pcp !== 0x0d) out = " ";
        c = classOf(piece, out);
        decoration = /[a-z]/.test(out);
      } else if (APOSTROPHES.has(piece)) {
        out = "'";
        c = SEP;
      } else {
        const digit = asciiDigit(pcp);
        if (digit) {
          out = digit;
          c = DIGIT;
        } else if (MARK_RE.test(piece)) {
          // Accents and tone marks on these scripts are decoration; so are all the combining marks of U+0300 to U+036F.
          if (decoration || (pcp >= 0x300 && pcp <= 0x36f)) continue;
          out = piece;
          c = MARK;
        } else {
          decoration = MARKS_ARE_DECORATION.test(piece);
          const lower = piece.toLowerCase();
          out = SPECIAL[lower] ?? SPECIAL[piece] ?? lower;
          if (pcp >= 0x2e80 && lower === piece) out = simplifiedHan(out);
          c = LETTER.test(piece) ? classOf(piece, lower) : SEP;
          if (/\s/.test(piece) || /[\p{Z}\p{C}]/u.test(piece)) {
            out = " ";
            c = SEP;
          }
        }
      }
      const sc = c === SEP || c === DIGIT ? S_NONE : scriptOfCodePoint(pcp);
      // A Latin "e" after a, o or u is the way of writing an umlaut without one (Juergen, Soeren): Jürgen, Sören and these are one.
      if (out === "e" && sc === S_LATIN && chars.length > 0 && /[aou]/.test(chars[chars.length - 1]) && script[script.length - 1] === S_LATIN) {
        end[end.length - 1] = next;
        continue;
      }
      for (let k = 0; k < out.length; k += 1) {
        chars.push(out[k]);
        start.push(at);
        end.push(next);
        cls.push(c);
        script.push(c === MARK && script.length > 0 ? script[script.length - 1] : sc);
      }
    }
    at = next;
  }

  // A space, dot or hyphen between two letters of a script written without spaces is not a break: "王 伟" is 王伟.
  const keep: boolean[] = chars.map(() => true);
  let any = false;
  for (let k = 1; k < chars.length - 1; k += 1) {
    if (cls[k] !== SEP || !SEPARATOR_CHARS.has(chars[k])) continue;
    let a = k - 1;
    let b = k + 1;
    while (a >= 0 && cls[a] === SEP && SEPARATOR_CHARS.has(chars[a])) a -= 1;
    while (b < chars.length && cls[b] === SEP && SEPARATOR_CHARS.has(chars[b])) b += 1;
    if (a >= 0 && b < chars.length && cls[a] !== SEP && cls[b] !== SEP && COMPACT.has(script[a]) && COMPACT.has(script[b])) {
      keep[k] = false;
      any = true;
    }
  }
  if (!any) return { folded: chars.join(""), start, end, cls, script };
  const pick = <T,>(list: T[]): T[] => list.filter((_, k) => keep[k]);
  return { folded: pick(chars).join(""), start: pick(start), end: pick(end), cls: pick(cls), script: pick(script) };
}

/** The text folded for comparison. */
export function foldName(text: string): string {
  return foldWithMap(text).folded;
}

/**
 * True when index `i` of a folded text is the edge of a word: the start or end, beside a separator, between a letter and a digit,
 * between two scripts, at a lower-to-upper change ("TeamAarav") or before the last capital of a run ("XMLHttp").
 */
export function isBoundary(f: Folded, i: number): boolean {
  const n = f.folded.length;
  if (i <= 0 || i >= n) return true;
  const p = f.cls[i - 1];
  const c = f.cls[i];
  if (c === MARK) return false;
  if (p === SEP || c === SEP) return true;
  if ((p === DIGIT) !== (c === DIGIT)) return true;
  if (p === DIGIT && c === DIGIT) return false;
  if (f.script[i - 1] !== f.script[i]) return true;
  if (p === LOWER && c === UPPER) return true;
  if (p === UPPER && c === UPPER && i + 1 < n && f.cls[i + 1] === LOWER) return true;
  return false;
}
