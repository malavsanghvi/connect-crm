// The masks of "RSVP without signing in" (docs/RSVP_WITHOUT_LOGIN.md section 4), as pure functions.
//
// The real work is in the database (app.mask_name, app.mask_email, app.mask_phone in supabase/migrations/0822): the real value must never reach a
// phone. This file is the TypeScript twin for the portal (what a visitor would see, in a preview) and for tests; tests/mask.test.ts runs it against
// the same table as supabase/tests/822_rsvp_contact_test.sql, so a change to the rule has to change both.
//
// The rule: a UNIT is a letter or digit with the marks that join it (accents, Indic vowel signs and viramas, Hebrew and Arabic points, Thai marks).
// A WORD is a run of units between separators (space, hyphen, apostrophe, period, comma); separators show as they are and are not counted.
// A word of n units shows: n = 1 `*`; n = 2 or 3 the first unit and stars; n >= 4 the first and the last unit and stars between. So at most
// floor(n/2) units show, and at least half of every word is hidden. Stars keep the word's length. Case is kept.

/** The characters that join the unit before them, as code point ranges. The same ranges as app._mask_marks() in the database. */
const MARK_RANGES: readonly (readonly [number, number])[] = [
  [0x300, 0x36f], [0x483, 0x489], [0x591, 0x5bd], [0x5bf, 0x5bf], [0x5c1, 0x5c2], [0x5c4, 0x5c5], [0x5c7, 0x5c7], [0x610, 0x61a], [0x64b, 0x65f],
  [0x670, 0x670], [0x6d6, 0x6dc], [0x6df, 0x6e4], [0x6e7, 0x6e8], [0x6ea, 0x6ed],
  [0x900, 0x903], [0x93a, 0x93c], [0x93e, 0x94f], [0x951, 0x957], [0x962, 0x963], [0x981, 0x983], [0x9bc, 0x9bc], [0x9be, 0x9cd], [0x9d7, 0x9d7], [0x9e2, 0x9e3],
  [0xa01, 0xa03], [0xa3c, 0xa3c], [0xa3e, 0xa4d], [0xa51, 0xa51], [0xa70, 0xa71], [0xa75, 0xa75], [0xa81, 0xa83], [0xabc, 0xabc], [0xabe, 0xacd], [0xae2, 0xae3],
  [0xb01, 0xb03], [0xb3c, 0xb3c], [0xb3e, 0xb57], [0xb62, 0xb63], [0xb82, 0xb82], [0xbbe, 0xbcd], [0xbd7, 0xbd7], [0xc00, 0xc04], [0xc3e, 0xc56], [0xc62, 0xc63],
  [0xc81, 0xc83], [0xcbc, 0xcbc], [0xcbe, 0xcd6], [0xce2, 0xce3], [0xd00, 0xd03], [0xd3b, 0xd3c], [0xd3e, 0xd4d], [0xd57, 0xd57], [0xd62, 0xd63], [0xd81, 0xd83], [0xdca, 0xddf],
  [0xe31, 0xe31], [0xe34, 0xe3a], [0xe47, 0xe4e], [0xeb1, 0xeb1], [0xeb4, 0xebc], [0xec8, 0xecd], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x200c, 0x200d],
  [0x20d0, 0x20ff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f],
];

const hex = (n: number): string => "\\u{" + n.toString(16) + "}";
const MARKS = MARK_RANGES.map(([lo, hi]) => (lo === hi ? hex(lo) : hex(lo) + "-" + hex(hi))).join("");

const UNIT = new RegExp(`[^${MARKS}][${MARKS}]*|[${MARKS}]+`, "gu");
const FIRST_UNIT = new RegExp(`^[^${MARKS}][${MARKS}]*`, "u");
const PIECES = /([^\s'’.,-]+)|([\s'’.,-]+)/gu;

const units = (word: string): string[] => word.match(UNIT) ?? [];

function maskWord(word: string): string {
  const u = units(word);
  const n = u.length;
  if (n === 0) return "";
  if (n === 1) return "*";
  if (n <= 3) return u[0] + "*".repeat(n - 1);
  return u[0] + "*".repeat(n - 2) + u[n - 1];
}

/** "Malav" → "M***v", "Priya Shah" → "P***a S**h", "Jean-Luc" → "J**n-L**". */
export function maskName(name: string | null | undefined): string {
  return (name ?? "").normalize("NFC").replace(PIECES, (_all, word: string | undefined, separator: string | undefined) =>
    word !== undefined ? maskWord(word) : (separator ?? ""),
  );
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "name@gmail.com" → "n***@g***.com"; null when it is not an email. */
export function maskEmail(email: string | null | undefined): string | null {
  const v = (email ?? "").trim().toLowerCase();
  if (!EMAIL.test(v)) return null;
  const at = v.lastIndexOf("@");
  const local = v.slice(0, at);
  const labels = v.slice(at + 1).split(".");
  const first = local.match(FIRST_UNIT)?.[0] ?? "";
  const head = (Array.from(local).length >= 2 ? first : "") + "***@";
  return (
    head +
    labels
      .map((label, i) => (i === labels.length - 1 ? label : Array.from(label).length >= 2 ? Array.from(label)[0] + "***" : "***"))
      .join(".")
  );
}

/** "+13125550187" → "+1 *** *** **87"; other countries: "+" and the last 2 digits; null with fewer than 7 digits. */
export function maskPhone(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 7) return null;
  if (d.length === 10 || (d.length === 11 && d.startsWith("1"))) return `+1 *** *** **${d.slice(-2)}`;
  return `+${"*".repeat(d.length - 2)}${d.slice(-2)}`;
}

/** The label of a child on the masked list: no letters of the name, no age. */
export function childLabel(position: number): string {
  return `Child ${position}`;
}
