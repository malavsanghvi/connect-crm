// Small text helpers for the draft generator. They only re-shape words and numbers that were already in the data
// (cut at a sentence, write a date out, drop a menu that was read together with a page's text); they never add a fact.

/** What Weaver has always written: used when a community's locale is not known. */
export const DEFAULT_LOCALE = "en-US";

/** A formatter for the locale, or for English (US) when the platform does not know the locale. */
function formatter(locale: string | null | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale || DEFAULT_LOCALE, options);
  } catch {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, options);
  }
}

/**
 * "2026-09-13" written out in the community's locale: "September 13, 2026" in the US, "13 September 2026" in Britain, "13 de septiembre
 * de 2026" in Spanish. Anything that is not a real date comes back as it was.
 */
export function longDate(iso: string, locale?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return iso;
  return formatter(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(d);
}

/** "18:30" as "6:30 PM" in the US, "18:30" in most of the world, in the community's locale. Anything that is not a time comes back as it was. */
export function clockTime(hhmm: string, locale?: string | null): string {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return hhmm;
  const d = new Date(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2])));
  return formatter(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(d).replace(/[  ]/g, " ");
}

/** At most `max` characters, ending at the end of a sentence when there is one in reach, else at a word ("…" added). */
export function cutText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (stop >= max * 0.5) return head.slice(0, stop + 1);
  const space = head.lastIndexOf(" ");
  return `${head.slice(0, space > 0 ? space : max).replace(/[\s,;:.-]+$/, "")}…`;
}

const SEPARATORS = [" — ", " – ", " | ", " - ", " · ", " : "];

/** A page title without the organization's name after it ("Our Story — Grace Church" becomes "Our Story"). */
export function tidyTitle(title: string, names: readonly string[]): string {
  const t = title.replace(/\s+/g, " ").trim();
  const lower = t.toLowerCase();
  for (const name of names) {
    const n = name.replace(/\s+/g, " ").trim().toLowerCase();
    if (n === "") continue;
    for (const sep of SEPARATORS) {
      if (lower.endsWith(`${sep}${n}`) && t.length > sep.length + n.length) return t.slice(0, t.length - sep.length - n.length).trim();
    }
  }
  return t;
}

/** True when the text after a cut begins a new sentence or word (a capital letter, a digit, punctuation), not the middle of a word. */
const beginsNew = (rest: string): boolean => {
  const r = rest.trim();
  return r === "" || /^[\p{Lu}\p{N}\p{P}]/u.test(r);
};

/**
 * Takes the site's menu words off the front of a page's text. The reader sometimes takes the menu as the first words of a
 * page ("HomeOur StoryWhat's OnGive Our Story Grace Church was planted …"); the menu labels are known, so they are dropped.
 */
export function stripMenu(text: string, labels: readonly string[]): string {
  const sorted = labels.filter((l) => l.length >= 2).sort((a, b) => b.length - a.length);
  let t = text.trim();
  for (let guard = 0; guard < 80; guard++) {
    const hit = sorted.find((l) => t.toLowerCase().startsWith(l.toLowerCase()) && beginsNew(t.slice(l.length)));
    if (!hit) break;
    t = t.slice(hit.length).trim();
  }
  return t;
}

/** The text up to where the page's footer begins (its address, phone number, email or a copyright sign), without the organization's name that heads it. */
export function stripFooter(text: string, markers: readonly string[], names: readonly string[]): string {
  let cut = text.length;
  for (const m of [...markers, "©"]) {
    if (m.length < 4 && m !== "©") continue;
    const i = text.indexOf(m);
    if (i >= 40 && i < cut) cut = i;
  }
  let t = text.slice(0, cut).trim();
  for (const n of [...names].sort((x, y) => y.length - x.length)) {
    if (n !== "" && t.toLowerCase().endsWith(n.toLowerCase()) && t.length - n.length >= 40) {
      t = t.slice(0, t.length - n.length).trim();
      break;
    }
  }
  return t;
}

/**
 * An old page's section as text worth keeping: the menu and a repeat of the heading are not at the start, the footer is not at
 * the end, and it is cut to a readable length. Returns "" when too little is left to be worth a block.
 */
export function keepText(heading: string, excerpt: string, opts: { max?: number; menu?: readonly string[]; names?: readonly string[]; footer?: readonly string[] } = {}): string {
  let t = stripMenu(excerpt.replace(/\s+/g, " ").trim(), opts.menu ?? []);
  for (const h of [heading.replace(/\s+/g, " ").trim(), tidyTitle(heading, opts.names ?? [])]) {
    if (h !== "" && t.toLowerCase().startsWith(h.toLowerCase()) && beginsNew(t.slice(h.length))) {
      t = t.slice(h.length).trim();
      break;
    }
  }
  t = stripFooter(t, opts.footer ?? [], opts.names ?? []);
  return t.length < 40 ? "" : cutText(t, opts.max ?? 700);
}

/** Paragraphs of a longer text written with blank lines between them (the profile's "about"). */
export function paragraphsOf(text: string, max = 4): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, max);
}

/** A list in words: "a", "a and b", "a, b and c". */
export function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
