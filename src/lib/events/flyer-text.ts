// Two tiny text helpers the flyer's pure parts share (flyer.ts and flyer-layout.ts), kept apart so neither imports the other.

/** Characters as a person counts them (code points, so a Gujarati letter with its sign counts per symbol, not per UTF-16 unit). */
export function flyerTextLength(s: string): number {
  return Array.from(s).length;
}

/**
 * One line of flyer text: control characters (tabs, line breaks) and no-break spaces (a time such as "5:00 PM" may carry
 * one) become spaces, repeated spaces collapse, the ends are trimmed. The flyer lays out its own lines, and a font may not
 * have the glyph. Anything that is not a string is "".
 */
export function cleanLine(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F\u00A0\u202F]+/g, " ").replace(/ {2,}/g, " ").trim() : "";
}
