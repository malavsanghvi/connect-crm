// Keeping a child's name out of an automatic email. The screens use the full name scanner (src/lib/commands/minor-names.ts:
// spelling variants, scripts); this is the plain version the background service can carry: a child's first name is any whole
// word that equals it, ignoring case and accents, and also with a possessive ("Zoya's"). tests/merge-format.test.ts checks that a
// household's name comes out exactly as the screens write it (householdNameWithoutChildren) for the usual shapes.
//
// Pure, no "@/" imports, and safe under the background service's stricter compiler settings.

const WORD = /[\p{L}\p{M}\p{N}'’]+/gu;

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

function baseOf(token: string): string {
  return fold(token).replace(/['’]s?$/u, "");
}

/** The words of `text` that are a child's first name (as listed), removed; and how many were removed. */
export function stripChildNames(text: string, minorFirstNames: readonly string[]): { text: string; count: number } {
  const names = new Set(minorFirstNames.map((n) => fold(n.trim())).filter((n) => n.length >= 2));
  if (names.size === 0 || !text) return { text, count: 0 };
  let count = 0;
  const out = text.replace(WORD, (token) => {
    const parts = token.split(/[-‐]/u);
    if (names.has(baseOf(token)) || parts.some((p) => names.has(baseOf(p)))) {
      count += 1;
      return "";
    }
    return token;
  });
  return { text: out, count };
}

function tidy(s: string): string {
  return s
    .replace(/\(\s*[,&]*\s*\)/g, "")
    .replace(/\s+(?:and|&)\s*(?=[,)]|$)/gi, "")
    .replace(/(?:\s*[,&]\s*){2,}/g, ", ")
    .replace(/\s*[,&]\s*(?=\)|$)/g, "")
    .replace(/^[\s,&]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A household's name without its children's first names ("Shah, Priya, Rahul & Zoya" → "Shah, Priya, Rahul"); null when nothing is left. */
export function householdNameForEmail(name: string | null | undefined, minorFirstNames: readonly string[]): string | null {
  if (!name) return null;
  const stripped = stripChildNames(name, minorFirstNames);
  if (stripped.count === 0) return name;
  return tidy(stripped.text) || null;
}

/** Any other value with a child's first name taken out (a fund or an event named after a child). */
export function withoutChildNames(value: string, minorFirstNames: readonly string[]): string {
  const stripped = stripChildNames(value, minorFirstNames);
  return stripped.count === 0 ? value : tidy(stripped.text.replace(/\s{2,}/g, " "));
}
