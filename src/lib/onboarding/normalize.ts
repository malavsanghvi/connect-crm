// Normalizers for onboarding's smart matching (pure; no I/O). Each returns a KEY that is equal when two
// spellings mean the same thing, or null when the value is missing or unusable. Keys are for COMPARING only:
// they are never shown or stored as the person's data.

const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "shri", "smt", "sri", "shree", "kum", "pt", "rev", "sir"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "md", "phd", "cpa", "esq"]);
const JOINERS = new Set(["and", "&", "+"]);
/** Household names end in a word that is not a name: "Shah family", "Rahul & Mira Shah Household". */
const FAMILY_WORDS = new Set(["family", "families", "household", "residence", "fam", "hh"]);

/** Common nicknames to one canonical given name, so "Mike" and "Michael" compare equal. */
const NICKNAMES: Record<string, string> = {
  mike: "michael", mick: "michael", bob: "robert", rob: "robert", bobby: "robert", bill: "william", will: "william", billy: "william",
  jim: "james", jimmy: "james", joe: "joseph", joey: "joseph", dave: "david", dan: "daniel", danny: "daniel", tom: "thomas", tommy: "thomas",
  steve: "steven", stephen: "steven", chris: "christopher", nick: "nicholas", matt: "matthew", andy: "andrew", tony: "anthony", rick: "richard",
  dick: "richard", rich: "richard", jeff: "jeffrey", greg: "gregory", ken: "kenneth", ed: "edward", eddie: "edward", sam: "samuel",
  liz: "elizabeth", beth: "elizabeth", betty: "elizabeth", kate: "katherine", katie: "katherine", kathy: "katherine", cathy: "catherine",
  sue: "susan", susie: "susan", jen: "jennifer", jenny: "jennifer", pat: "patricia", patty: "patricia", peggy: "margaret", maggie: "margaret",
  meg: "margaret", becky: "rebecca", debbie: "deborah", deb: "deborah", vicky: "victoria",
};

function ascii(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Digits of a US/Canada number (last 10), or null when fewer than 10 digits. */
export function phoneKey(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let d = String(raw).replace(/(ext|x|extension)\.?\s*\d+\s*$/i, "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length > 11) d = d.slice(-10);
  if (d.length !== 10) return null;
  if (/^(\d)\1{9}$/.test(d) || d.startsWith("000")) return null;
  return d;
}

/** Lower-cased email; Gmail dots and +tags removed (they reach the same inbox). */
export function emailKey(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  const m = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(s);
  if (!m) return null;
  let local = m[1]!;
  let domain = m[2]!;
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.split("+")[0]!.replace(/\./g, "");
  return local ? `${local}@${domain}` : null;
}

const STREET_WORDS: Record<string, string> = {
  street: "st", str: "st", avenue: "ave", av: "ave", road: "rd", drive: "dr", lane: "ln", boulevard: "blvd", court: "ct", circle: "cir",
  place: "pl", terrace: "ter", parkway: "pkwy", highway: "hwy", trail: "trl", way: "way", square: "sq", apartment: "apt", suite: "ste",
  unit: "unit", building: "bldg", floor: "fl", north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw",
  southeast: "se", southwest: "sw",
};

export type AddressKey = { key: string; unit: string | null; zip: string | null };

/** "12 Lotus Lane, Apt 4" + ZIP -> key "77478|12|lotus ln"; the unit is kept apart (two units in one building differ). */
export function addressKey(line1: unknown, line2: unknown, zip: unknown): AddressKey | null {
  const a = line1 === null || line1 === undefined ? "" : ascii(String(line1)).toLowerCase();
  if (!a.trim()) return null;
  const tokens = a.replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean).map((t) => STREET_WORDS[t] ?? t);
  let unit: string | null = null;
  const body: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if ((t === "apt" || t === "ste" || t === "unit" || t === "bldg" || t === "fl") && tokens[i + 1]) {
      unit = tokens[i + 1]!;
      i++;
    } else body.push(t);
  }
  const house = body.find((t) => /^\d+[a-z]?$/.test(t));
  if (!house) return null;
  const street = body.filter((t) => t !== house).join(" ").trim();
  if (!street) return null;
  const l2 = line2 === null || line2 === undefined ? "" : ascii(String(line2)).toLowerCase().replace(/[.,#]/g, " ").trim();
  if (!unit && l2) {
    const m = /(?:apt|ste|suite|unit|apartment)?\s*([a-z0-9-]+)$/.exec(l2);
    unit = m ? m[1]! : null;
  }
  const z = zip === null || zip === undefined ? "" : String(zip).replace(/\D/g, "").slice(0, 5);
  return { key: `${z.length === 5 ? z : ""}|${house}|${street}`, unit, zip: z.length === 5 ? z : null };
}

export type ParsedName = {
  /** Family name (lower-case, ASCII), or null when it cannot be told. */
  surname: string | null;
  /** Given names or initials (lower-case, nicknames folded), in the order written. */
  givens: string[];
};

function cleanToken(t: string): string {
  return ascii(t).toLowerCase().replace(/[^a-z'-]/g, "");
}

/** "Sanghvi, Malav & Palak", "Malav and Palak Sanghvi", "Dr. Malav Sanghvi Jr." -> surname + given names. */
export function parseName(raw: unknown): ParsedName {
  if (raw === null || raw === undefined) return { surname: null, givens: [] };
  const s = ascii(String(raw)).replace(/\s+/g, " ").trim();
  if (!s) return { surname: null, givens: [] };
  let surname: string | null = null;
  let rest = s;
  const comma = s.indexOf(",");
  if (comma > 0) {
    surname = cleanToken(s.slice(0, comma).split(" ").filter(Boolean).pop() ?? "") || null;
    rest = s.slice(comma + 1);
  }
  const words = rest
    .replace(/&/g, " & ")
    .replace(/\+/g, " + ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !TITLES.has(cleanToken(w).replace(/'/g, "")) && !SUFFIXES.has(cleanToken(w)) && !FAMILY_WORDS.has(cleanToken(w)));
  const givens: string[] = [];
  const names = words.filter((w) => !JOINERS.has(w.toLowerCase()));
  if (surname === null) {
    const last = names.pop();
    surname = last ? cleanToken(last) || null : null;
  }
  for (const w of names) {
    const c = cleanToken(w);
    if (c) givens.push(NICKNAMES[c] ?? c);
  }
  return { surname, givens };
}

/** Two given names match when equal, one is the other's initial, or they are the same nickname family. */
export function givenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  return false;
}

/** Surnames match when equal, or one edit apart for names of 5+ letters (Sanghvi/Sanghavi). */
export function surnameMatches(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  return editDistanceAtMost1(a, b);
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
