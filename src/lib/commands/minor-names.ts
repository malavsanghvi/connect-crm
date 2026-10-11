// Finding the names of people under 18 in any text, for any culture. Pure: no I/O.
//
// Decision D2 (nothing about a child reaches an AI provider) needs the names of the community's minors to be found wherever they
// appear in text. The first version assumed "given names, then one family name": it matched a full name written in that order,
// only when it had two words or more. That misses a family-name-first child ("Wang Wei"), a child with one name, a nickname, a
// name with a particle ("Ahmad bin Ali"), two given names and two family names, and every name written without spaces (王伟,
// 김민준) or with endings stuck to it (Gujarati and Hindi suffixes, Russian cases).
//
// What is matched, by name part:
//   - Words that identify a child on their own (the source says which: given names, nicknames, a single name, and any family word
//     that no adult of the household shares) are found anywhere, in any case and with or without accents (Unicode NFKD, so
//     "María" meets "Maria" and a full-width "ＷＡＮＧ" meets "Wang"). Words of two letters or more only.
//   - A family word that adults of the household share ("Shah" for Priya Shah, Rahul Shah and their daughter Zoya) is NOT found on
//     its own, because it names the family, not the child: it is removed only when it stands next to the child's other words, in
//     either order ("Zoya Shah", "Shah, Zoya", "Wang Wei", "Wei Wang"). Otherwise every adult in a family with a child would lose
//     their surname.
//   - Anything that is not a space-separated Latin word is matched as a substring (Chinese, Japanese, Korean, Thai, Indic and
//     Arabic scripts, where words run together or take endings); Cyrillic and Greek words are matched by their start, so an
//     ending ("Зою") does not hide a name; Latin words are matched whole, so "Ann" does not remove "Annual".
//
// The trade-off, on purpose: a word that a child and an adult both have (an adult named Aarav; a family name the household's
// adults do not share) is removed for the adult too. Over-removing is the safe side of D2; leaking a child's name is not.

/** What replaces a child's name wherever it was found. */
export const CHILD_NAME_REPLACEMENT = "[a child: not shown]";

/**
 * One person under 18, as the source of names knows them.
 *   full   the whole name as written ("Zoya Shah", "Wang Wei", "王伟"), with any preferred name ("Zo Shah"). Tokens of these are
 *          only removed when they stand next to a word of `words` (or, for scripts without spaces, as the whole name).
 *   words  every word that identifies the child on its own. Left out, every word of `full` is used (the safe default). An empty
 *          list means none: the child is then only reported by leaked() when the whole name is there (a check, not a filter).
 */
export type MinorName = { readonly full?: readonly string[]; readonly words?: readonly string[] };

/** A bare string is a name whose parts are not known: every word of it counts as identifying (the safe default). */
export type MinorNameEntry = string | MinorName;

// ---------------------------------------------------------------------------
// Folding: one way of comparing names, whatever the script
// ---------------------------------------------------------------------------
const MARK = /\p{M}/u;
/** Scripts whose combining marks are decoration (accents, tone marks, vowel points); in other scripts the marks are letters. */
const MARKS_ARE_DECORATION = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}]/u;
const APOSTROPHES = new Set(["’", "ʼ", "ʻ", "`", "´", "′", "‘"]);
const SPECIAL: Readonly<Record<string, string>> = { "đ": "d", "ð": "d", "ø": "o", "ł": "l", "ı": "i", "ß": "ss", "æ": "ae", "œ": "oe", "þ": "th", "ħ": "h", "ŧ": "t" };

export type Folded = {
  folded: string;
  /** For each UTF-16 unit of `folded`: where its source character starts and ends in the original text. */
  start: number[];
  end: number[];
};

/** The text folded for comparison, with the positions needed to cut the original at the same place. */
export function foldWithMap(text: string): Folded {
  let folded = "";
  const start: number[] = [];
  const end: number[] = [];
  let decoration = false;
  let at = 0;
  for (const ch of text) {
    const next = at + ch.length;
    const cp = ch.codePointAt(0) as number;
    // Hangul syllables are kept whole: decomposing them to jamo would change their length for no gain.
    const pieces = cp < 0x80 || (cp >= 0xac00 && cp <= 0xd7a3) ? [ch] : [...ch.normalize("NFKD")];
    for (const piece of pieces) {
      let out: string;
      if (piece.length === 1 && piece.charCodeAt(0) < 0x80) {
        out = piece.toLowerCase();
        decoration = /[a-z]/.test(out);
      } else if (APOSTROPHES.has(piece)) {
        out = "'";
      } else if (MARK.test(piece)) {
        if (decoration) continue;
        out = piece;
      } else {
        decoration = MARKS_ARE_DECORATION.test(piece);
        const lower = piece.toLowerCase();
        out = SPECIAL[lower] ?? lower;
      }
      for (let k = 0; k < out.length; k += 1) {
        folded += out[k];
        start.push(at);
        end.push(next);
      }
    }
    at = next;
  }
  return { folded, start, end };
}

/** The text folded for comparison. */
export function foldName(text: string): string {
  return foldWithMap(text).folded;
}

const NAME_SEPARATORS = /[\s,;:./\\()[\]{}"“”<>|+&_=!?*~#@%^$\-‐‑‒–—―·•]+/u;

/** The words of a name, folded (apostrophes dropped: "D'Souza" is dsouza). */
export function nameTokens(name: string): string[] {
  return foldName(name)
    .split(NAME_SEPARATORS)
    .map((t) => t.replace(/'/g, ""))
    .filter(Boolean);
}

const codePoints = (s: string): number => Array.from(s).length;

type Mode = "word" | "prefix" | "substring";

/** How a word of a name is found in text: whole word, by its start, or anywhere (see the header). */
function modeOf(token: string): Mode {
  if (/(?![\p{Script=Latin}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Cyrillic}\p{Script=Greek}])\p{L}/u.test(token)) return "substring";
  if (/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(token)) return "prefix";
  return "word";
}

/** Particles and suffixes that are part of a name but do not name anyone alone ("bin" in Ahmad bin Ali, "Jr"). */
export function isNameParticle(token: string): boolean {
  return NOT_ALONE.has(token);
}

const NOT_ALONE = new Set([
  "bin", "binti", "bint", "binte", "bte", "ibn", "al", "el", "de", "del", "della", "di", "da", "das", "do", "dos", "du", "la", "le",
  "van", "von", "der", "den", "ter", "ten", "y", "e", "ap", "af", "av", "zu", "jr", "sr", "ii", "iii", "iv",
]);

/**
 * Russian, Ukrainian and Greek names change their last letter with the case ("Зоя" is "Зою" after a verb): the start of the word
 * is compared, without a final vowel. Best effort, and it errs towards removing too much ("Зо" also starts "Зонт"): a name of two
 * letters or fewer is compared whole.
 */
function prefixStem(token: string): string {
  const letters = Array.from(token);
  return letters.length >= 3 && "аяеёиоуыэюйьαεηιουωςν".includes(letters[letters.length - 1]) ? letters.slice(0, -1).join("") : token;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** What may sit between the words of a name written in a script without spaces ("王 伟", "王·伟"), as a pattern and as a run. */
const SEP = "[\\s\\-‐‑·•]*";
const SEP_RUN = /[\s\-‐‑·•]+/gu;
/**
 * What may sit between two words of one name for them to count as one name: spaces, or one hyphen. Never a comma, a full stop, a
 * newline or a dash, which end a name in a list or a sentence ("Priya Shah, Zoya Shah"; "Priya Shah. Zoya Shah is …").
 */
const GAP = /^(?:[ \t\u00a0]+|[-\u2010\u2011])?$/;
const WORD = /[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu;

/** All the orders of these words (every order up to five words; the turns of the list, forwards and back, above that). */
function orders<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  if (items.length > 5) {
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

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------
export type NameHit = { start: number; end: number; child: number };

type Child = {
  label: string;
  /** Every word of the child's whole names, any length: what may stand next to a found word and go with it. */
  tokens: Set<string>;
  /** Whole-name forms as lists of significant words, for the second look at a finished result. */
  forms: string[][];
};

export class CompiledNames {
  readonly children: Child[] = [];
  readonly words = new Map<string, number[]>();
  readonly prefixes = new Map<string, { token: string; child: number }[]>();
  private readonly substrings = new Set<string>();
  readonly substringOwner = new Map<string, number>();
  /** Names written without spaces or with endings, by their first letter: one sticky pattern per letter, so a long text is not run against every name. */
  readonly substringGroups = new Map<string, RegExp>();

  addWord(token: string, child: number): void {
    switch (modeOf(token)) {
      case "word": {
        const list = this.words.get(token) ?? [];
        if (!list.includes(child)) list.push(child);
        this.words.set(token, list);
        return;
      }
      case "prefix": {
        const stem = prefixStem(token);
        const list = this.prefixes.get(stem[0]) ?? [];
        list.push({ token: stem, child });
        this.prefixes.set(stem[0], list);
        return;
      }
      default:
        this.substrings.add(token);
        if (!this.substringOwner.has(token)) this.substringOwner.set(token, child);
    }
  }

  addPhrase(tokens: readonly string[], child: number): void {
    if (tokens.length < 2 || !tokens.some((t) => modeOf(t) === "substring")) return;
    for (const order of orders(tokens)) {
      this.substrings.add(order.join("\u0000"));
      this.substringOwner.set(order.join(""), child);
    }
  }

  finish(): void {
    const byFirst = new Map<string, string[]>();
    for (const s of [...this.substrings].sort((a, b) => b.length - a.length)) {
      const words = s.split("\u0000");
      const list = byFirst.get(words[0][0]) ?? [];
      list.push(words.map(escapeRegExp).join(SEP));
      byFirst.set(words[0][0], list);
    }
    for (const [first, list] of byFirst) this.substringGroups.set(first, new RegExp(list.join("|"), "yu"));
  }
}

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

  private findIn(text: string): NameHit[] {
    const c = this.compiled;
    const { folded, start, end } = foldWithMap(text);
    const spans: { a: number; b: number; child: number }[] = [];

    // Words: whole-word and by-start matches, then whatever stands next to them that belongs to the same child's name.
    const words: { a: number; b: number; key: string }[] = [];
    for (const m of folded.matchAll(WORD)) words.push({ a: m.index as number, b: (m.index as number) + m[0].length, key: m[0].replace(/'/g, "") });
    const marked: (number[] | null)[] = words.map((w) => {
      const found: number[] = [];
      const raw = folded.slice(w.a, w.b);
      for (const cand of raw.includes("'") ? [w.key, ...raw.split("'")] : [w.key]) for (const child of c.words.get(cand) ?? []) found.push(child);
      for (const p of c.prefixes.get(w.key[0]) ?? []) if (w.key.startsWith(p.token)) found.push(p.child);
      return found.length > 0 ? found : null;
    });
    const gap = (i: number, j: number): boolean => GAP.test(folded.slice(words[i].b, words[j].a));
    words.forEach((_, i) => {
      const kids = marked[i];
      if (!kids) return;
      let l = i;
      let r = i;
      const joins = (k: number): boolean => kids.some((child) => c.children[child].tokens.has(words[k].key));
      while (r + 1 < words.length && gap(r, r + 1) && joins(r + 1)) r += 1;
      while (l - 1 >= 0 && gap(l - 1, l) && joins(l - 1)) l -= 1;
      spans.push({ a: words[l].a, b: words[r].b, child: kids[0] });
    });

    // Anything written without spaces or with endings: matched wherever it is.
    if (c.substringGroups.size > 0) {
      for (let i = 0; i < folded.length; ) {
        const re = c.substringGroups.get(folded[i]);
        let m: RegExpExecArray | null = null;
        if (re) {
          re.lastIndex = i;
          m = re.exec(folded);
        }
        if (!m || m[0].length === 0) {
          i += 1;
          continue;
        }
        const compact = m[0].replace(SEP_RUN, "");
        spans.push({ a: i, b: i + m[0].length, child: c.substringOwner.get(compact) ?? c.substringOwner.get(m[0]) ?? 0 });
        i += m[0].length;
      }
    }

    // Back to the original text, then one hit where spans overlap or touch.
    const mapped = spans
      .filter((s) => s.b > s.a)
      .map((s) => ({ start: start[s.a], end: end[s.b - 1], child: s.child }))
      .sort((x, y) => x.start - y.start || y.end - x.end);
    const merged: NameHit[] = [];
    for (const s of mapped) {
      const last = merged[merged.length - 1];
      if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
      else merged.push({ ...s });
    }
    return merged;
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
   * The names of the children still readable in `value` (keys included). Two independent looks: the scanner on every string, then
   * every whole-name form (in any order, as one run of JSON text) against the folded document.
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
    const present = new Set<string>();
    for (const m of document.matchAll(WORD)) present.add(m[0].replace(/'/g, ""));
    this.compiled.children.forEach((child, index) => {
      if (leaked.has(index)) return;
      for (const form of child.forms) {
        if (form.length < 2) continue;
        if (!form.every((t) => (modeOf(t) === "substring" ? document.includes(t) : present.has(t)))) continue;
        const edge = modeOf(form[0]) === "word" ? "(?<![\\p{L}\\p{N}])" : "";
        const tail = modeOf(form[form.length - 1]) === "word" ? "(?![\\p{L}\\p{N}])" : "";
        const re = new RegExp(`${edge}(?:${orders(form).map((o) => o.map(escapeRegExp).join(SEP)).join("|")})${tail}`, "u");
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
    const label = full.find((f) => f.trim()) ?? alone.find((a) => a.trim()) ?? "";
    if (!label) continue;
    const child: Child = { label: label.replace(/\s+/g, " ").trim(), tokens: new Set(), forms: [] };
    const index = compiled.children.push(child) - 1;

    for (const source of alone) {
      const tokens = nameTokens(source);
      for (const t of tokens) {
        if (codePoints(t) >= 2) child.tokens.add(t);
        if (codePoints(t) < 2 || (tokens.length >= 2 && NOT_ALONE.has(t))) continue;
        compiled.addWord(t, index);
      }
    }
    for (const source of full) {
      const tokens = nameTokens(source);
      for (const t of tokens) if (codePoints(t) >= 2) child.tokens.add(t);
      const significant = tokens.length >= 2 ? tokens.filter((t) => !NOT_ALONE.has(t)) : tokens;
      if (significant.length >= 2) {
        child.forms.push(significant);
        compiled.addPhrase(significant, index);
      }
    }
  }
  compiled.finish();
  const scanner = new MinorNameScanner(compiled);
  if (key) cache.set(key, scanner);
  return scanner;
}
