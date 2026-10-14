// Finding the names of people under 18 in any text, for any culture. Pure: no I/O.
//
// Decision D2 (nothing about a child reaches an AI provider) needs the names of the community's minors to be found wherever they
// appear in text, however they are written: in any word order, as one name or several, with or without accents, in any script,
// glued to digits, to suffixes, to other words or to the other half of the name, and inside e-mail addresses, web addresses and
// file names ("Aarav12", "aarav2015@gmail.com", "AaravShah_x.pdf", "#TeamAarav", "Aaravni", "Aaravくん", "Aa<zero-width>rav").
//
// How a name is matched (see name-fold.ts for the folding):
//   - Text is folded: case, accents, width, invisible characters, the several ways Arabic and Hebrew letters are written, Hangul
//     in either form, Traditional and Simplified Han, "ue" and "ü" are one. A word is a run of letters of one script; it is also
//     split at digits, underscores, punctuation, a change of script and a lower-to-upper change (TeamAarav).
//   - A name word of five letters or more is found anywhere, inside any longer text. Four letters: where a word starts
//     ("Zoya", "Zoyaa", "ZoyaShah"). Two or three: as a whole word. In scripts written without spaces or with endings stuck on
//     (Chinese, Japanese, Korean, Thai, Indic, Arabic, Hebrew) a word of two characters or more is found anywhere.
//   - A word that is also an everyday English word (Will, Hope, Chase, May, An, My) is found only where it is written with a
//     capital or stands beside the child's other names; never inside a longer word or in plain lower case.
//   - Names that change when a suffix is added are also found in the changed form: Tamil and Malayalam lose the final virama
//     (அர்ஜுன் is அர்ஜுனுக்கு), Russian names lose a vowel or gain a soft sign (Павел is Павла, Лев is Льва), Cyrillic and Greek
//     names lose their last vowel (Зоя is Зою), spelling variants (Muhammad, Mohammed) share a group.
//   - A name written as one word is found when it is written as two ("Abdulrahman" and "Abdul Rahman", "MaryAnn" and "Mary-Ann",
//     "عبدالرحمن" and "عبد الرحمن"), and the other way round: whole words that join up to a name are found as that name.
//   - E-mail addresses, member numbers and phone numbers of the child are found as such.
//   - Whatever is glued to a name inside a word is removed with it ("Aarav12", "Aaravni", the whole address), and so is an age
//     written right after the name ("Zoya (12)", "Zoya, aged 12").
//
// The trade-off, on purpose: a word that a child and an adult both have (an adult named Aarav while a child is named Aarav) is
// removed for the adult too. A family name that adults of the child's household share names the family, not the child, and is not
// removed on its own (the source says so; see child-filter.ts). Over-removing is the safe side of D2; leaking a child is not.

import { spellingVariantsOf } from "../onboarding/intl/name-variants";

import { AhoCorasick } from "./aho-corasick";
import { COMMON_WORDS } from "./common-words";
import {
  DIGIT,
  MARK,
  SEP,
  S_ARMENIAN,
  S_CYRILLIC,
  S_GEORGIAN,
  S_GREEK,
  S_HAN,
  S_HANGUL,
  S_KANA,
  S_LATIN,
  S_THAI,
  UPPER,
  foldName,
  foldWithMap,
  isAlphabeticScript,
  isBoundary,
  scriptOfCodePoint,
  type Folded,
} from "./name-fold";

export { foldName, foldWithMap };

/** What replaces a child's name wherever it was found. */
export const CHILD_NAME_REPLACEMENT = "[a child: not shown]";

/**
 * One person under 18, as the source of names knows them.
 *   full    the whole name as written ("Zoya Shah", "Wang Wei", "王伟"), with any preferred name ("Zo Shah"). Words of these are
 *           only removed when they stand next to a word of `words` (or, for scripts without spaces, as the whole name).
 *   words   every word that identifies the child on its own. Left out, every word of `full` is used (the safe default). An empty
 *           list means none: the child is then only reported by leaked() when the whole name is there (a check, not a filter).
 *   ids     the child's e-mail addresses and member numbers, found as they are written.
 *   phones  the child's phone numbers, found however they are punctuated (the last seven to ten digits).
 */
export type MinorName = {
  readonly full?: readonly string[];
  readonly words?: readonly string[];
  readonly ids?: readonly string[];
  readonly phones?: readonly string[];
};

/** A bare string is a name whose parts are not known: every word of it counts as identifying (the safe default). */
export type MinorNameEntry = string | MinorName;

// ---------------------------------------------------------------------------
// Words of a name
// ---------------------------------------------------------------------------
const NAME_SEPARATORS = /[\s,;:./\\()[\]{}"“”<>|+&_=!?*~#@%^$\-‐‑‒–—―·•]+/u;

/** The words of a name, folded (apostrophes dropped: "D'Souza" is dsouza; a zero-width joiner inside a word is not a break). */
export function nameTokens(name: string): string[] {
  return name
    .split(NAME_SEPARATORS)
    .map((t) => foldName(t).replace(/'/g, ""))
    .filter(Boolean);
}

const codePoints = (s: string): number => Array.from(s).length;

/** Particles and suffixes that are part of a name but do not name anyone alone ("bin" in Ahmad bin Ali, "Jr"). */
const NOT_ALONE = new Set([
  "bin", "binti", "bint", "binte", "bte", "ibn", "al", "el", "de", "del", "della", "di", "da", "das", "do", "dos", "du", "la", "le",
  "van", "von", "der", "den", "ter", "ten", "y", "e", "ap", "af", "av", "zu", "jr", "sr", "ii", "iii", "iv",
]);

export function isNameParticle(token: string): boolean {
  return NOT_ALONE.has(token);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function scriptOfToken(token: string): number {
  for (const ch of token) {
    const s = scriptOfCodePoint(ch.codePointAt(0) as number);
    if (s !== 0) return s;
  }
  return 0;
}

/** What is attached to a short name in writing: Polish and Czech Jana, Janu, Janovi; Turkish Alinin; Indian Devji, Devbhai, Deva; Russian -ov, -ev, -ova. */
const ATTACHED_ENDINGS = ["a", "u", "y", "ni", "ne", "no", "na", "ji", "ya", "ye", "yi", "nin", "nun", "in", "un", "ov", "ev", "ova", "eva", "owi", "ovi", "bhai", "ben", "bhi", "ski", "ska", "kumar"];

const VOWELS_CYR = "аеиоуыэюя";
const CONSONANTS_CYR = "бвгджзйклмнпрстфхцчшщь";

/** Cyrillic and Greek names change their last letter with the case ("Зоя" is "Зою"): the word without a final vowel. */
function prefixStem(token: string): string {
  const letters = Array.from(token);
  return letters.length >= 3 && "аяеиоуыэюьαεηιουωσ".includes(letters[letters.length - 1]) ? letters.slice(0, -1).join("") : token;
}

/** Russian names that lose or gain a vowel (Павел, Павла; Лев, Льва; Любовь, Любви): the stems the other forms start with. */
function fleetingStems(token: string): string[] {
  const m = new RegExp(`^(.*?)([${VOWELS_CYR}])([${CONSONANTS_CYR}]{1,2})$`, "u").exec(token);
  if (!m) return [];
  const [, head, , tail] = m;
  const bare = tail.replace(/ь$/, "");
  const out = [`${head}${bare}`];
  if (head && CONSONANTS_CYR.includes(head[head.length - 1])) out.push(`${head}ь${bare}`);
  return out.filter((s) => codePoints(s) >= 3);
}

const VIRAMAS = ["्", "্", "੍", "્", "୍", "்", "్", "್", "്", "්"];

/** Tamil, Malayalam and the other Indic scripts drop the final virama when a suffix is added: அர்ஜுன் becomes அர்ஜுனுக்கு. */
function viramaStem(token: string): string | null {
  for (const v of VIRAMAS) if (token.endsWith(v) && codePoints(token) >= 3) return token.slice(0, -v.length);
  return null;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------
const ANY = 0;
const START = 1;
const WHOLE = 2;
const CJK1 = 3;

type Meta = { kind: number; child: number; guard: boolean; len: number };

type Child = {
  label: string;
  /** Every word of the child's whole names (folded, two characters or more): what may stand next to a found word and go with it. */
  tokens: Set<string>;
  /** Whole-name forms as lists of significant words, for the second look at a finished result. */
  forms: string[][];
};

/** All the orders of these words (every order up to four words; the turns of the list, forwards and back, above that). */
function orders<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  if (items.length > 4) {
    const out: T[][] = [];
    for (const list of [[...items], [...items].reverse()]) for (let i = 0; i < list.length; i += 1) out.push([...list.slice(i), ...list.slice(0, i)]);
    return out;
  }
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of orders([...items.slice(0, i), ...items.slice(i + 1)])) out.push([item, ...rest]);
  });
  return out;
}

export class CompiledNames {
  readonly children: Child[] = [];
  readonly metas: Meta[] = [];
  readonly main = new AhoCorasick();
  /** Patterns that may also be found when the text splits them over several whole words ("Abdul Rahman" for Abdulrahman). */
  readonly joined = new AhoCorasick();
  readonly joinedMetas: Meta[] = [];
  readonly phones = new Map<string, number>();
  private readonly seen = new Set<string>();

  private put(text: string, meta: Meta, joinable: boolean): void {
    if (!text) return;
    const key = `${meta.kind}|${meta.guard ? 1 : 0}|${meta.child}|${text}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.main.add(text, this.metas.push({ ...meta, len: text.length }) - 1);
    if (joinable && !meta.guard) this.joined.add(text, this.joinedMetas.push({ ...meta, len: text.length }) - 1);
  }

  /** How a word is looked for, by its script and length (see the header). */
  private kindFor(word: string, script: number): number {
    const n = codePoints(word);
    if (!isAlphabeticScript(script)) return n >= 2 ? ANY : CJK1;
    return n >= 5 ? ANY : n === 4 ? START : WHOLE;
  }

  /** One word of a name that identifies a child on its own, with the other forms it takes. */
  addWord(word: string, child: number): void {
    const script = scriptOfToken(word);
    if (script === 0) return;
    const n = codePoints(word);
    if (n < 2 && !(n === 1 && (script === S_HAN || script === S_KANA || script === S_HANGUL))) return;
    const guard = isAlphabeticScript(script) && COMMON_WORDS.has(word);
    const base = (text: string, joinable: boolean) => this.put(text, { kind: guard ? WHOLE : this.kindFor(text, script), child, guard, len: 0 }, joinable);

    if (script === S_CYRILLIC || script === S_GREEK) {
      base(word, n >= 5);
      const stems = new Set<string>([prefixStem(word), ...(script === S_CYRILLIC ? fleetingStems(word) : [])]);
      for (const stem of stems) {
        if (stem === word || codePoints(stem) < 2) continue;
        this.put(stem, { kind: codePoints(stem) >= 5 ? ANY : START, child, guard: false, len: 0 }, false);
      }
      return;
    }
    if (script === S_ARMENIAN || script === S_GEORGIAN || script === S_LATIN) {
      base(word, n >= 5);
      // A short name (Jan, Ali, Dev) is a whole word; with the endings that attach to names across languages it is still the name.
      if (script === S_LATIN && !guard && n === 3) {
        for (const ending of ATTACHED_ENDINGS) this.put(word + ending, { kind: WHOLE, child, guard: false, len: 0 }, false);
      }
      if (script === S_LATIN && !guard && n >= 3) {
        for (const spelling of spellingVariantsOf(word)) {
          if (spelling === word) continue;
          const sc = codePoints(spelling);
          this.put(spelling, { kind: sc >= 5 ? ANY : sc === 4 ? START : WHOLE, child, guard: COMMON_WORDS.has(spelling), len: 0 }, sc >= 5);
        }
      }
      return;
    }
    // Scripts written without spaces or with endings: found anywhere.
    base(word, n >= 5);
    const bare = viramaStem(word);
    if (bare) this.put(bare, { kind: ANY, child, guard: false, len: 0 }, false);
  }

  /** A whole name of a script written without spaces, in every order of its words ("王伟", "伟王"). */
  addPhrase(words: readonly string[], child: number): void {
    if (words.length < 2) return;
    const compact = words.every((w) => {
      const s = scriptOfToken(w);
      return s === S_HAN || s === S_KANA || s === S_HANGUL || s === S_THAI;
    });
    if (!compact) return;
    for (const order of orders(words)) this.put(order.join(""), { kind: ANY, child, guard: false, len: 0 }, false);
  }

  /** A literal string (an e-mail address, a member number) found as written. */
  addLiteral(text: string, child: number): void {
    const f = foldName(text.trim());
    if (!f) return;
    this.put(f, { kind: f.length >= 6 ? ANY : WHOLE, child, guard: false, len: 0 }, false);
  }

  addPhone(raw: string, child: number): void {
    const digits = foldName(raw).replace(/\D/g, "");
    if (digits.length >= 7) this.phones.set(digits.slice(-10), child);
  }
}

// ---------------------------------------------------------------------------
// Looking at the text around a place
// ---------------------------------------------------------------------------
type Place = { a: number; b: number };

/** The word that starts right after `from`, with nothing, spaces or one hyphen between. */
function wordAfter(f: Folded, from: number): Place | null {
  const n = f.folded.length;
  let i = from;
  if (i >= n) return null;
  if (f.cls[i] !== SEP) {
    if (!isBoundary(f, i)) return null;
  } else {
    if (f.folded[i] === "-") i += 1;
    else {
      let k = 0;
      while (i < n && f.folded[i] === " " && k < 2) {
        i += 1;
        k += 1;
      }
      if (k === 0) return null;
    }
    if (i >= n || f.cls[i] === SEP) return null;
  }
  let j = i + 1;
  while (j < n && f.cls[j] !== SEP && !isBoundary(f, j)) j += 1;
  return { a: i, b: j };
}

/** The word that ends right before `to`, with nothing, spaces or one hyphen between. */
function wordBefore(f: Folded, to: number): Place | null {
  let e = to;
  if (e <= 0) return null;
  if (f.cls[e - 1] !== SEP) {
    if (!isBoundary(f, e)) return null;
  } else {
    let k = e - 1;
    if (f.folded[k] === "-") k -= 1;
    else {
      let c = 0;
      while (k >= 0 && f.folded[k] === " " && c < 2) {
        k -= 1;
        c += 1;
      }
      if (c === 0) return null;
    }
    if (k < 0 || f.cls[k] === SEP) return null;
    e = k + 1;
  }
  let st = e - 1;
  while (st > 0 && f.cls[st - 1] !== SEP && !isBoundary(f, st)) st -= 1;
  return { a: st, b: e };
}

/** The breaks inside f[a..b) are only what sits inside a name: one or two spaces, or a single hyphen, underscore, apostrophe or dot (not a comma or a sentence end). */
function plainGaps(f: Folded, a: number, b: number): boolean {
  let i = a;
  while (i < b) {
    if (f.cls[i] !== SEP) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < b && f.cls[j] === SEP) j += 1;
    const run = f.folded.slice(i, j);
    if (!(/^ {1,2}$/.test(run) || /^[-_'.]$/.test(run))) return false;
    i = j;
  }
  return true;
}

const HONORIFIC_BEFORE = "小阿老大";
const HONORIFIC_AFTER = "同的君桑さくちゃ님씨군양";

/** A one-character given name (伟, 민) is found after 小 or 阿, before 同学 or さん, or standing alone (beside the family name is a phrase). */
function singleCharacterName(f: Folded, a: number, b: number): boolean {
  const cjk = (i: number): boolean => {
    if (i < 0 || i >= f.folded.length || f.cls[i] === SEP) return false;
    const s = f.script[i];
    return s === S_HAN || s === S_KANA || s === S_HANGUL || s === S_THAI;
  };
  if (a > 0 && HONORIFIC_BEFORE.includes(f.folded[a - 1])) return true;
  if (b < f.folded.length && HONORIFIC_AFTER.includes(f.folded[b])) return true;
  return !cjk(a - 1) && !cjk(b);
}

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------
export type NameHit = { start: number; end: number; child: number };

type Span = { a: number; b: number; child: number };

const AGE_AFTER = /^\s*(?:\(\s*\d{1,2}\s*(?:yo|y\/o|(?:yrs?|years?|y)(?:\s*old)?)?\s*\)|\[\s*\d{1,2}\s*\]|,?\s*(?:aged?|age)\s*:?\s*\d{1,2}\b|,?\s*\d{1,2}\s*-?\s*(?:years?|yrs?)[\s-]*old\b|,?\s*\d{1,2}\s*(?:yo|y\/o)\b)/;
const AGE_BEFORE = /(?:\d{1,2}\s*-?\s*(?:years?|yrs?)[\s-]*old|\d{1,2}\s*(?:yo|y\/o))\s*$/;
const CONNECTORS = new Set(["_", ".", "@", "+", "%", "'"]);
const PHONE_RUN = /\+?\d[\d ().\-]{4,}\d/g;

/** Looks for a community's minors in text. Build one with compileMinorNames(). */
export class MinorNameScanner {
  /** How many people under 18 this knows. */
  readonly size: number;

  constructor(private readonly compiled: CompiledNames) {
    this.size = compiled.children.length;
  }

  /** Where in `text` a child's name is (positions in the original text, merged, in order). */
  find(text: string | null | undefined): NameHit[] {
    if (!text || this.size === 0 || text.length < 2) return [];
    if (!text.includes(CHILD_NAME_REPLACEMENT)) return this.findIn(text);
    // What was already replaced is not looked at again (a child called "Not" must not turn the replacement itself into a leak).
    const hits: NameHit[] = [];
    let from = 0;
    while (from <= text.length) {
      let to = text.indexOf(CHILD_NAME_REPLACEMENT, from);
      if (to < 0) to = text.length;
      for (const h of this.findIn(text.slice(from, to))) hits.push({ start: h.start + from, end: h.end + from, child: h.child });
      from = to + CHILD_NAME_REPLACEMENT.length;
      if (to === text.length) break;
    }
    return hits;
  }

  /** True when a word of the same child's names stands right beside this place (the "full-name context" of an everyday-word name). */
  private beside(f: Folded, a: number, b: number, child: number): boolean {
    const tokens = this.compiled.children[child].tokens;
    const next = wordAfter(f, b);
    if (next && tokens.has(f.folded.slice(next.a, next.b))) return true;
    const before = wordBefore(f, a);
    return !!before && tokens.has(f.folded.slice(before.a, before.b));
  }

  private findIn(text: string): NameHit[] {
    const c = this.compiled;
    const f = foldWithMap(text);
    const n = f.folded.length;
    if (n === 0) return [];
    const spans: Span[] = [];

    c.main.search(f.folded, (id, end) => {
      const m = c.metas[id];
      const a = end - m.len;
      if (m.kind === START && !isBoundary(f, a)) return;
      if (m.kind === WHOLE && (!isBoundary(f, a) || !isBoundary(f, end))) return;
      if (m.kind === CJK1 && !singleCharacterName(f, a, end)) return;
      if (m.guard && f.cls[a] !== UPPER && !this.beside(f, a, end, m.child)) return;
      spans.push({ a, b: end, child: m.child });
    });

    // Words that join up to a name when the spaces are taken out: "Abdul Rahman" for Abdulrahman, "Mary-Ann" for MaryAnn.
    if (c.joined.size > 0) {
      const index: number[] = [];
      let compact = "";
      for (let i = 0; i < n; i += 1) {
        if (f.cls[i] === SEP) continue;
        index.push(i);
        compact += f.folded[i];
      }
      if (compact.length < n) {
        c.joined.search(compact, (id, end) => {
          const m = c.joinedMetas[id];
          const a = index[end - m.len];
          const b = index[end - 1] + 1;
          if (b - a <= m.len || b - a > m.len + 8) return;
          if (!isBoundary(f, a) || !isBoundary(f, b) || !plainGaps(f, a, b)) return;
          spans.push({ a, b, child: m.child });
        });
      }
    }

    // Phone numbers, however they are punctuated.
    if (c.phones.size > 0) {
      for (const m of f.folded.matchAll(PHONE_RUN)) {
        const digits = m[0].replace(/\D/g, "");
        for (let k = Math.min(10, digits.length); k >= 7; k -= 1) {
          const child = c.phones.get(digits.slice(-k));
          if (child === undefined) continue;
          spans.push({ a: m.index as number, b: (m.index as number) + m[0].length, child });
          break;
        }
      }
    }
    if (spans.length === 0) return [];

    // Whatever is glued to the name inside a word goes with it; so do the other names of the same child beside it; so does an age.
    for (const s of spans) {
      this.widen(f, s);
      this.join(f, s);
      const after = AGE_AFTER.exec(f.folded.slice(s.b, s.b + 60));
      if (after) s.b += after[0].length;
      const before = AGE_BEFORE.exec(f.folded.slice(Math.max(0, s.a - 30), s.a));
      if (before) s.a -= before[0].length;
    }

    // Back to the original text, then one hit where spans overlap or touch.
    const mapped = spans
      .filter((s) => s.b > s.a)
      .map((s) => ({ start: f.start[s.a], end: f.end[s.b - 1], child: s.child }))
      .sort((x, y) => x.start - y.start || y.end - x.end);
    const merged: NameHit[] = [];
    for (const s of mapped) {
      const last = merged[merged.length - 1];
      if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
      else merged.push({ ...s });
    }
    return merged;
  }

  /** In Latin, Cyrillic, Greek, Armenian and Georgian text: the whole word, address or file name the name sits in. */
  private widen(f: Folded, s: Span): void {
    const script = f.script[s.a];
    if (!isAlphabeticScript(script)) return;
    const blob = (i: number): boolean => i >= 0 && i < f.folded.length && f.cls[i] !== SEP && (f.cls[i] === DIGIT || f.script[i] === script || f.cls[i] === MARK);
    const connector = (i: number): boolean => i >= 0 && i < f.folded.length && f.cls[i] === SEP && CONNECTORS.has(f.folded[i]);
    for (;;) {
      if (blob(s.a - 1)) s.a -= 1;
      else if (connector(s.a - 1) && blob(s.a - 2)) s.a -= 2;
      else break;
    }
    for (;;) {
      if (blob(s.b)) s.b += 1;
      else if (connector(s.b) && blob(s.b + 1)) s.b += 2;
      else break;
    }
  }

  /** The other names of the same child that stand right beside it ("Zoya Shah", "Shah Zoya", "Wang-Wei") join it. */
  private join(f: Folded, s: Span): void {
    if (!isAlphabeticScript(f.script[s.a])) return;
    const tokens = this.compiled.children[s.child].tokens;
    for (let round = 0; round < 6; round += 1) {
      let moved = false;
      const next = wordAfter(f, s.b);
      if (next && tokens.has(f.folded.slice(next.a, next.b))) {
        s.b = next.b;
        moved = true;
      }
      const before = wordBefore(f, s.a);
      if (before && tokens.has(f.folded.slice(before.a, before.b))) {
        s.a = before.a;
        moved = true;
      }
      if (!moved) break;
    }
  }

  /** True when the text uses a child's name. */
  mentions(text: string | null | undefined): boolean {
    return this.find(text).length > 0;
  }

  /** The text with every child's name replaced, and how many were replaced. */
  redact(text: string): { text: string; count: number } {
    const hits = this.find(text);
    if (hits.length === 0) return { text, count: 0 };
    let out = "";
    let at = 0;
    for (const h of hits) {
      out += text.slice(at, h.start) + CHILD_NAME_REPLACEMENT;
      at = h.end;
    }
    return { text: out + text.slice(at), count: hits.length };
  }

  /** The text with every child's name taken out (no replacement), for a list of names that is tidied afterwards. */
  strip(text: string): { text: string; count: number } {
    const hits = this.find(text);
    if (hits.length === 0) return { text, count: 0 };
    let out = "";
    let at = 0;
    for (const h of hits) {
      out += text.slice(at, h.start);
      at = h.end;
    }
    return { text: out + text.slice(at), count: hits.length };
  }

  /**
   * The names of the children still readable in `value` (keys included). Two looks: the scanner on every string, then every
   * whole-name form (in any order, as one run of JSON text) against the folded document.
   */
  leaked(value: unknown): string[] {
    if (this.size === 0) return [];
    const leaked = new Set<number>();
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
          strings.push(k);
          walk(item);
        }
      }
    };
    walk(value);
    for (const s of strings) for (const h of this.find(s)) leaked.add(h.child);

    const document = foldName(strings.join("\n").split(CHILD_NAME_REPLACEMENT).join("\n"));
    const present = new Set<string>(document.split(/[^\p{L}\p{M}\p{N}]+/u));
    this.compiled.children.forEach((child, index) => {
      if (leaked.has(index)) return;
      for (const form of child.forms) {
        if (form.length < 2) continue;
        if (!form.every((t) => (isAlphabeticScript(scriptOfToken(t)) ? present.has(t) : document.includes(t)))) continue;
        const edge = isAlphabeticScript(scriptOfToken(form[0])) ? "(?<![\\p{L}\\p{N}])" : "";
        const tail = isAlphabeticScript(scriptOfToken(form[form.length - 1])) ? "(?![\\p{L}\\p{N}])" : "";
        const re = new RegExp(`${edge}(?:${orders(form).map((o) => o.map(escapeRegExp).join("[\\s\\-]*")).join("|")})${tail}`, "u");
        if (re.test(document)) {
          leaked.add(index);
          break;
        }
      }
    });
    return [...leaked].sort((a, b) => a - b).map((i) => this.compiled.children[i].label);
  }
}

// ---------------------------------------------------------------------------
// Building one
// ---------------------------------------------------------------------------
const cache = new WeakMap<object, MinorNameScanner>();

/** A scanner for these people under 18. Built once per list (the same array gives the same scanner). */
export function compileMinorNames(entries: Iterable<MinorNameEntry> | null | undefined): MinorNameScanner {
  const list = entries ? (Array.isArray(entries) ? (entries as MinorNameEntry[]) : [...entries]) : [];
  const key = entries && Array.isArray(entries) ? (entries as object) : null;
  const cached = key ? cache.get(key) : undefined;
  if (cached) return cached;

  const compiled = new CompiledNames();
  for (const entry of list) {
    const full = typeof entry === "string" ? [entry] : [...(entry.full ?? [])];
    const alone = typeof entry === "string" ? [entry] : entry.words ? [...entry.words] : full;
    const ids = typeof entry === "string" ? [] : [...(entry.ids ?? [])];
    const phones = typeof entry === "string" ? [] : [...(entry.phones ?? [])];
    const label = full.find((f) => f.trim()) ?? alone.find((a) => a.trim()) ?? ids.find((i) => i.trim()) ?? phones.find((p) => p.trim()) ?? "";
    if (!label) continue;
    const child: Child = { label: label.replace(/\s+/g, " ").trim(), tokens: new Set(), forms: [] };
    const index = compiled.children.push(child) - 1;

    for (const source of alone) {
      const tokens = nameTokens(source);
      for (const t of tokens) {
        if (codePoints(t) >= 2) child.tokens.add(t);
        if (tokens.length >= 2 && NOT_ALONE.has(t)) continue;
        compiled.addWord(t, index);
      }
      // A name written as two words is also written as one ("Mary Ann" and "MaryAnn"): the words joined, next to each other.
      const real = tokens.filter((t) => !(tokens.length >= 2 && NOT_ALONE.has(t)));
      if (real.length >= 2 && real.length <= 4) {
        if (codePoints(real.join("")) >= 5) compiled.addWord(real.join(""), index);
        if (real.length > 2) {
          for (let i = 0; i + 1 < real.length; i += 1) if (codePoints(real[i] + real[i + 1]) >= 5) compiled.addWord(real[i] + real[i + 1], index);
        }
      }
    }
    for (const source of full) {
      const tokens = nameTokens(source);
      for (const t of tokens) if (codePoints(t) >= 2) child.tokens.add(t);
      const significant = tokens.length >= 2 ? tokens.filter((t) => !NOT_ALONE.has(t)) : tokens;
      if (significant.length >= 2) {
        child.forms.push(significant);
        compiled.addPhrase(significant, index);
        // "ZoyaShah", "shahzoya": the words of a whole name run together, in either order (a family name shared with the household
        // is not matched alone, but it is matched glued to the child's given name).
        if (significant.length <= 3) {
          for (const order of orders(significant)) {
            const joined = order.join("");
            if (codePoints(joined) >= 5 && isAlphabeticScript(scriptOfToken(joined))) compiled.addWord(joined, index);
          }
        }
      }
    }
    for (const id of ids) {
      compiled.addLiteral(id, index);
      const at = id.indexOf("@");
      if (at >= 5) compiled.addLiteral(id.slice(0, at), index);
    }
    for (const phone of phones) compiled.addPhone(phone, index);
  }
  const scanner = new MinorNameScanner(compiled);
  if (key) cache.set(key, scanner);
  return scanner;
}
