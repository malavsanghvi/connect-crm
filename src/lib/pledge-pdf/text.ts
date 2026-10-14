// Text for the pledge PDF. The PDF uses the built-in Helvetica (no font file ships with it), which draws Western European
// letters (the WinAnsi set). A name or a symbol outside that set cannot be drawn: a letter with an accent that the set lacks
// is drawn as its plain letter ("Łukasz" -> "Lukasz"), anything else as "?". The document says so in a note when it happens
// (src/lib/pledge-pdf/document.ts), so a printed name is never silently wrong.
//
// Pure (no "@/" imports): the background service imports it too.

const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013,
  0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** True when Helvetica can draw this code point. */
export function canDraw(cp: number): boolean {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff && cp !== 0xad) || WIN_ANSI_EXTRA.has(cp);
}

/** A regular expression matching any of these code points (written from numbers, so the source holds no invisible characters). */
function classOf(ranges: [number, number][], plus = false): RegExp {
  const body = ranges.map(([a, b]) => String.fromCodePoint(a) + (b > a ? "-" + String.fromCodePoint(b) : "")).join("");
  return new RegExp("[" + body + "]" + (plus ? "+" : ""), "gu");
}

const SPACES = classOf([[0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000]]);
const INVISIBLE = classOf([[0x200b, 0x200f], [0x2028, 0x2029], [0x2060, 0x2060], [0xfeff, 0xfeff], [0xad, 0xad]]);
const CONTROLS = classOf([[0x0, 0x1f], [0x7f, 0x9f]], true);

export type DrawableText = { text: string; changed: boolean };

/**
 * One line of text the PDF can draw: spaces of every width become a plain space, invisible marks go, control characters become
 * spaces, and each character Helvetica lacks becomes its base letter or "?". `changed` is true when a visible character was
 * replaced (the document then carries a note).
 */
export function drawable(input: unknown, max = 500): DrawableText {
  const raw = (input === null || input === undefined ? "" : String(input)).normalize("NFC");
  const cleaned = raw
    .replace(SPACES, " ")
    .replace(INVISIBLE, "")
    .replace(CONTROLS, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, max);
  let out = "";
  let changed = false;
  for (const ch of cleaned) {
    const cp = ch.codePointAt(0) ?? 0;
    if (canDraw(cp)) {
      out += ch;
      continue;
    }
    // A letter with marks: its base letter, when that can be drawn ("ł" has none and becomes "?").
    const base = ch.normalize("NFD").replace(/\p{M}+/gu, "");
    const baseCp = base.length > 0 ? (base.codePointAt(0) ?? 0) : 0;
    if (base.length > 0 && base !== ch && canDraw(baseCp) && [...base].length === 1) {
      out += base;
    } else {
      out += "?";
    }
    changed = true;
  }
  return { text: out, changed };
}

/** Collects whether any text had to be changed, while turning many values into drawable lines. */
export function drawer(): { line: (v: unknown, max?: number) => string; changed: () => boolean } {
  let any = false;
  return {
    line(v, max) {
      const d = drawable(v, max);
      if (d.changed) any = true;
      return d.text;
    },
    changed: () => any,
  };
}

/** A money text the PDF can draw: the community's own way of writing it, else with the currency code ("INR 1,000.00"). */
export function drawableMoney(format: (currencyDisplay: "symbol" | "code") => string): string {
  const withSymbol = format("symbol").normalize("NFC").replace(SPACES, " ").replace(INVISIBLE, "");
  if ([...withSymbol].every((ch) => canDraw(ch.codePointAt(0) ?? 0))) return withSymbol;
  return format("code").normalize("NFC").replace(SPACES, " ").replace(INVISIBLE, "");
}
