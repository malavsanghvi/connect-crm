// SYNTHETIC golden fixtures for the resolve engine. Every person, phone, e-mail and address here is invented by a seeded
// generator; nothing comes from a real community. The generator knows the truth (who is who, which gifts are the same gift)
// because it makes the people first and then writes MESSY rows about them, the way real exports are messy:
//   typos, Latin spellings of Gujarati surnames, honorifics (-bhai, -ben, Shri), "Last, First", initials, a name in
//   Gujarati script, shared phones and e-mails, a spouse under a maiden name, father and son with one name, two people
//   with the same name, the same gift in two sources (some off by cents), children, and fields missing at random.
// The same seed always gives the same file, so the numbers in the tests are reproducible.

import type { RawRecord } from "@/lib/onboarding/resolve/types";

export type TruthRow = {
  /** The real person this row is about (children and gift donors included). */
  person: string;
  /** The real household. */
  household: string;
  /** For a gift row: the real gift it records, so two rows with the same value are the same gift. */
  gift: string | null;
  isChild: boolean;
  /** Why this row is interesting, for failure messages. */
  note: string | null;
};

export type Golden = {
  records: RawRecord[];
  truth: Record<string, TruthRow>;
  /** Rows per source file. */
  counts: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Invented people
// ---------------------------------------------------------------------------

const MEN = ["Rahul", "Kiran", "Jignesh", "Nirav", "Dipak", "Hemant", "Chirag", "Sanjay", "Mahesh", "Paresh", "Vipul", "Alpesh", "Tushar", "Manoj", "Jayesh", "Yash", "Bhavin", "Ketan", "Mitul", "Sunil", "Anand", "Dhaval", "Harsh", "Nikhil", "Pratik"];
const WOMEN = ["Mira", "Hetal", "Pooja", "Anita", "Falguni", "Bhavna", "Rekha", "Kalpana", "Nita", "Sejal", "Dhara", "Komal", "Ritu", "Pinal", "Neha", "Priti", "Sonal", "Varsha", "Jhanvi", "Trupti", "Heena", "Minal", "Kruti", "Urvi", "Shilpa"];
const KIDS_M = ["Arjun", "Aarav", "Neel", "Ishaan", "Veer", "Kabir", "Dev", "Rohan"];
const KIDS_F = ["Zoya", "Diya", "Riya", "Anya", "Kavya", "Tara", "Ira", "Myra"];
const SURNAMES = ["Patel", "Shah", "Mehta", "Desai", "Doshi", "Sanghvi", "Parekh", "Gandhi", "Trivedi", "Thakkar", "Kothari", "Jain", "Vora", "Modi", "Joshi", "Bhatt", "Chokshi", "Kapadia", "Zaveri", "Amin"];
/** The other Latin spellings people really use for the same surname. */
const VARIANTS: Record<string, string[]> = {
  Patel: ["Patil", "Pattel"],
  Shah: ["Saha"],
  Mehta: ["Metha"],
  Desai: ["Dessai"],
  Doshi: ["Dosi"],
  Sanghvi: ["Sanghavi"],
  Parekh: ["Parikh"],
  Gandhi: ["Ghandi"],
  Thakkar: ["Thakker"],
  Vora: ["Vohra"],
  Chokshi: ["Choksi"],
  Kapadia: ["Kapadiya"],
};
const STREETS = ["Lotus Lane", "Maple Court", "Cedar Drive", "Temple Road", "Jasmine Way", "Orchid Street", "Banyan Circle", "Saffron Place", "Willow Trail", "Marigold Avenue", "Peacock Boulevard", "Sandal Terrace"];
const ZIPS = ["77478", "77479", "77459", "77406", "77099"];
const COMPLEXES = [
  { number: "4100", street: "Garden Lane", zip: "77099" },
  { number: "900", street: "Vihar Court", zip: "77478" },
  { number: "2250", street: "Palm Drive", zip: "77406" },
];
const SCRIPT_NAMES = ["રાહુલ શાહ", "મીરા પટેલ", "હેતલ મહેતા"];
/** The order of the files, as a person would load them. */
const SOURCE_ORDER = ["directory.xlsx", "neon-export.csv", "zeffy-export.csv", "bank-export.csv", "quickbooks"];

type Person = {
  id: string;
  household: string;
  given: string;
  surname: string;
  /** The surname before marriage, when the person's records may carry it. */
  maiden: string | null;
  role: "head" | "spouse" | "child" | "parent" | "adult_child";
  dob: { y: number; m: number; d: number };
  mobile: string | null;
  email: string | null;
  neonId: string;
  generation: "jr" | "sr" | null;
  father: string | null;
};

type Household = {
  id: string;
  surname: string;
  house: { number: string; street: string; unit: string | null; zip: string };
  landline: string | null;
  familyId: string;
  qboId: string;
  people: Person[];
  kind: string;
};

/**
 * How often each field is filled in, per source. These are the fixture's stated assumptions about real exports: a community
 * directory prints one block per household and is patchy about e-mail; a CRM export is nearly complete; an online-giving export
 * always has an e-mail and usually an address; a bookkeeping export has what the bookkeeper typed. On top of these, any cell
 * of a person row is blanked at random 2% of the time.
 */
const FILL = {
  personHasMobile: 0.93,
  personHasEmail: 0.88,
  dirAddress: 0.96,
  dirLandline: 0.85,
  dirFamilyId: 0.85,
  dirMobile: 0.93,
  dirEmail: 0.92,
  neonMobile: 0.94,
  neonEmail: 0.95,
  neonAddress: 0.92,
  zeffyEmail: 0.98,
  zeffyAddress: 0.88,
  zeffyMobile: 0.7,
  qboEmail: 0.94,
  qboMobile: 0.75,
  qboAddress: 0.8,
} as const;

/** Children as a share of all rows (a person's row in a directory). */
const CHILD_SHARE = 0.05;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

type Pending = { source: string; sourceKind: RawRecord["sourceKind"]; kind: RawRecord["kind"]; fields: Partial<RawRecord>; truth: TruthRow };

export function buildGolden(opts: { rows: number; seed: number }): Golden {
  const rnd = mulberry32(opts.seed);
  const chance = (p: number) => rnd() < p;
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const usedNames = new Set<string>();
  const usedPhones = new Set<string>();
  const usedEmails = new Set<string>();
  const usedAddresses = new Set<string>();
  let personSeq = 0;
  let householdSeq = 0;
  let giftSeq = 0;
  let centsDiffs = 0;
  let scriptRows = 0;
  let kidsMade = 0;
  const kidCap = Math.round(opts.rows * CHILD_SHARE);

  const freshPhone = (): string => {
    for (;;) {
      const p = `${pick(["713", "281", "832"])}555${pad(int(0, 9999), 4)}`;
      if (!usedPhones.has(p) && !/^(\d)\1+$/.test(p)) {
        usedPhones.add(p);
        return p;
      }
    }
  };
  const freshEmail = (given: string, surname: string): string => {
    for (let n = int(1, 90); ; n++) {
      const domain = pick(["example.com", "example.org", "example.net", "gmail.com"]);
      const local = domain === "gmail.com" ? `onb.test.${given.toLowerCase()}.${surname.toLowerCase()}${n}` : `${given.toLowerCase()}.${surname.toLowerCase()}${n}`;
      const e = `${local}@${domain}`;
      if (!usedEmails.has(e)) {
        usedEmails.add(e);
        return e;
      }
    }
  };
  const freshHouse = (): Household["house"] => {
    for (;;) {
      const number = String(int(10, 9899));
      const street = pick(STREETS);
      const zip = pick(ZIPS);
      const k = `${number}|${street}|${zip}`;
      if (!usedAddresses.has(k)) {
        usedAddresses.add(k);
        return { number, street, unit: null, zip };
      }
    }
  };
  const freshName = (men: boolean, surname: string): string => {
    for (let tries = 0; tries < 400; tries++) {
      const g = pick(men ? MEN : WOMEN);
      const k = `${g}|${surname}`;
      if (!usedNames.has(k)) {
        usedNames.add(k);
        return g;
      }
    }
    return pick(men ? MEN : WOMEN);
  };

  const makePerson = (h: Household, p: Partial<Person> & Pick<Person, "given" | "role">): Person => {
    personSeq += 1;
    const adult = p.role !== "child";
    const born = adult ? int(1950, 1992) : int(2011, 2022);
    const person: Person = {
      id: `P${pad(personSeq, 4)}`,
      household: h.id,
      surname: h.surname,
      maiden: null,
      dob: { y: born, m: int(1, 12), d: int(1, 28) },
      mobile: adult && chance(FILL.personHasMobile) ? freshPhone() : null,
      email: adult && chance(FILL.personHasEmail) ? freshEmail(p.given, h.surname) : null,
      neonId: `N${pad(personSeq * 7 + 100, 5)}`,
      generation: null,
      father: adult ? pick(MEN) : null,
      ...p,
    };
    h.people.push(person);
    return person;
  };
  const newHousehold = (surname: string, kind: string, house?: Household["house"], landline?: string | null): Household => {
    householdSeq += 1;
    return {
      id: `H${pad(householdSeq, 3)}`,
      surname,
      house: house ?? freshHouse(),
      landline: landline === undefined ? (chance(0.5) ? freshPhone() : null) : landline,
      familyId: `F-${pad(householdSeq * 3 + 1000, 4)}`,
      qboId: `QB-${pad(householdSeq * 11 + 500, 4)}`,
      people: [],
      kind,
    };
  };

  // --- the households, by archetype (one roll makes one "cluster": a household, or two that interact) ----------------
  /** One roll value inside each archetype's band, so a file can be made to contain every kind. */
  const BAND: Record<string, number> = { couple_kids_maiden: 0.1, sr_jr: 0.79, complex: 0.82, cousins: 0.84, shared_phone: 0.86, shared_email: 0.88, namesake: 0.9, sparse: 0.92 };
  const makeCluster = (force?: string): Household[] => {
    const roll = force ? BAND[force] : rnd();
    const surname = pick(SURNAMES);
    if (roll < 0.34) {
      const h = newHousehold(surname, "couple_kids");
      makePerson(h, { given: freshName(true, surname), role: "head" });
      const wife = makePerson(h, { given: freshName(false, surname), role: "spouse" });
      if (force === "couple_kids_maiden" || chance(0.3)) wife.maiden = pick(SURNAMES.filter((s) => s !== surname));
      // Families list children, but children are held (never decided by code), so the generator keeps them near 5% of the rows.
      for (let k = chance(0.5) ? (chance(0.6) ? 1 : 2) : 0; k > 0 && kidsMade < kidCap; k--) {
        makePerson(h, { given: pick(chance(0.5) ? KIDS_M : KIDS_F), role: "child" });
        kidsMade += 1;
      }
      return [h];
    }
    if (roll < 0.56) {
      const h = newHousehold(surname, "couple");
      makePerson(h, { given: freshName(true, surname), role: "head" });
      makePerson(h, { given: freshName(false, surname), role: "spouse" });
      return [h];
    }
    if (roll < 0.72) {
      const h = newHousehold(surname, "single");
      makePerson(h, { given: freshName(chance(0.5), surname), role: "head" });
      return [h];
    }
    if (roll < 0.79) {
      const h = newHousehold(surname, "seniors");
      makePerson(h, { given: freshName(true, surname), role: "head", dob: { y: int(1938, 1952), m: int(1, 12), d: int(1, 28) } });
      makePerson(h, { given: freshName(false, surname), role: "spouse", dob: { y: int(1938, 1954), m: int(1, 12), d: int(1, 28) } });
      return [h];
    }
    if (roll < 0.805) {
      // Father and son with the same name at one address: Sr and Jr.
      const h = newHousehold(surname, "sr_jr");
      const given = freshName(true, surname);
      makePerson(h, { given, role: "head", generation: "sr", dob: { y: int(1948, 1958), m: int(1, 12), d: int(1, 28) } });
      makePerson(h, { given, role: "adult_child", generation: "jr", dob: { y: int(1978, 1988), m: int(1, 12), d: int(1, 28) } });
      return [h];
    }
    if (roll < 0.835) {
      // Two different families in one apartment complex: different units, different surnames.
      const c = pick(COMPLEXES);
      const other = pick(SURNAMES.filter((s) => s !== surname));
      return ([[surname, String(int(100, 199))], [other, String(int(200, 299))]] as const).map(([s, unit]) => {
        const h = newHousehold(s, "complex", { number: c.number, street: c.street, unit, zip: c.zip }, null);
        makePerson(h, { given: freshName(true, s), role: "head" });
        makePerson(h, { given: freshName(false, s), role: "spouse" });
        return h;
      });
    }
    if (roll < 0.855) {
      // Cousins: the same surname, two units of one complex.
      const c = pick(COMPLEXES);
      return [String(int(100, 149)), String(int(150, 199))].map((unit) => {
        const h = newHousehold(surname, "cousins", { number: c.number, street: c.street, unit, zip: c.zip }, null);
        makePerson(h, { given: freshName(true, surname), role: "head" });
        return h;
      });
    }
    if (roll < 0.875) {
      // Two unrelated households that share one landline.
      const shared = freshPhone();
      const other = pick(SURNAMES.filter((s) => s !== surname));
      return [surname, other].map((s) => {
        const h = newHousehold(s, "shared_phone", undefined, shared);
        const head = makePerson(h, { given: freshName(true, s), role: "head" });
        head.mobile = null;
        head.email = null;
        return h;
      });
    }
    if (roll < 0.89) {
      // Two unrelated households that share one e-mail address (a family business inbox).
      const other = pick(SURNAMES.filter((s) => s !== surname));
      const shared = freshEmail("office", surname);
      return [surname, other].map((s) => {
        const h = newHousehold(s, "shared_email", undefined, null);
        const head = makePerson(h, { given: freshName(true, s), role: "head" });
        head.mobile = null;
        head.email = shared;
        return h;
      });
    }
    if (roll < 0.91) {
      // Two different people with exactly the same name: unrelated, different everything.
      const given = pick(MEN);
      usedNames.add(`${given}|${surname}`);
      return [0, 1].map((k) => {
        const h = newHousehold(surname, k === 0 ? "namesake" : "namesake_sparse");
        makePerson(h, { given, role: "head" });
        return h;
      });
    }
    if (roll < 0.93) {
      // A sparse row: a name and a town, nothing to compare, of someone who is also known elsewhere.
      const sparse = newHousehold(surname, "sparse", undefined, null);
      const who = makePerson(sparse, { given: freshName(true, surname), role: "head" });
      who.mobile = freshPhone();
      who.email = freshEmail(who.given, surname);
      return [sparse];
    }
    const lone = newHousehold(surname, "single");
    makePerson(lone, { given: freshName(chance(0.5), surname), role: "head" });
    return [lone];
  };

  // --- messy writers -------------------------------------------------------------------------------------------------
  const pending: Pending[] = [];
  const push = (
    source: string,
    sourceKind: Pending["sourceKind"],
    kind: RawRecord["kind"],
    fields: Partial<RawRecord>,
    t: Omit<TruthRow, "isChild" | "note"> & { isChild?: boolean; note?: string | null; protect?: boolean },
  ) => {
    if (kind !== "gift" && !t.protect) {
      // Missing fields: blank some cells at random (never the name).
      for (const f of ["email", "mobile", "phone", "address1"] as const) if (chance(0.02)) delete fields[f];
    }
    pending.push({ source, sourceKind, kind, fields, truth: { person: t.person, household: t.household, gift: t.gift, isChild: t.isChild ?? false, note: t.note ?? null } });
  };

  const phoneText = (p: string): string => {
    const a = p.slice(0, 3);
    const b = p.slice(3, 6);
    const c = p.slice(6);
    return pick([`(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `${a}${b}${c}`, `1-${a}-${b}-${c}`, `+1 ${a} ${b} ${c}`]);
  };
  const emailText = (e: string): string => {
    const r = rnd();
    if (r < 0.25) return e.toUpperCase();
    if (r < 0.35) return e[0].toUpperCase() + e.slice(1);
    return e;
  };
  const surnameText = (s: string, variantChance: number): string => {
    const v = VARIANTS[s];
    return v && chance(variantChance) ? pick(v) : s;
  };
  const typo = (s: string): string => {
    if (s.length < 4) return s;
    const i = int(1, s.length - 2);
    const r = rnd();
    if (r < 0.34) return s.slice(0, i) + s.slice(i + 1); // a dropped letter
    if (r < 0.67) return s.slice(0, i) + s[i] + s[i] + s.slice(i + 1); // a doubled letter
    return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2); // swapped neighbours
  };
  const nameText = (p: Person, style: "dir" | "neon", surnameChance: number): { name: string; note: string | null } => {
    const surname = surnameText(p.surname, surnameChance);
    let given = p.given;
    let note: string | null = surname !== p.surname ? `surname spelled ${surname}` : null;
    if (chance(0.05)) {
      given = typo(given);
      note = `given name typo ${given}`;
    }
    const mark = p.generation === "jr" ? "Jr." : p.generation === "sr" ? "Sr." : "";
    if (style === "neon") return { name: `${surname}, ${given}${mark && chance(0.6) ? ` ${mark}` : ""}`, note };
    const r = rnd();
    if (r < 0.62) return { name: `${given} ${surname}${mark && chance(0.6) ? ` ${mark}` : ""}`, note };
    if (r < 0.72) return { name: `${surname}, ${given}`, note };
    if (r < 0.8) return { name: `${given}${WOMEN.includes(p.given) ? "ben" : "bhai"} ${surname}`, note: note ?? "honorific suffix" };
    if (r < 0.85) return { name: `Shri ${given} ${surname}`, note };
    if (r < 0.9) return { name: `${given[0]}. ${surname}`, note: "initial only" };
    return { name: `${given} ${p.father ?? "K"} ${surname}`, note: note ?? "middle name" };
  };
  const abbrev: Record<string, string> = { Lane: "Ln", Court: "Ct", Drive: "Dr", Road: "Rd", Way: "Way", Street: "St", Circle: "Cir", Place: "Pl", Trail: "Trl", Avenue: "Ave", Boulevard: "Blvd", Terrace: "Ter" };
  const addressFields = (h: Household, missing: number): Partial<RawRecord> => {
    if (chance(missing)) return {};
    const { number, street, unit, zip } = h.house;
    const [name, suffix] = street.split(" ");
    const line = pick([`${number} ${street}`, `${number} ${name} ${abbrev[suffix] ?? suffix}`, `${number} ${street.toUpperCase()}`, `${number} N ${street}`]);
    const unitText = unit ? pick([` Apt ${unit}`, ` #${unit}`, ` Unit ${unit}`]) : "";
    return { address1: `${line}${unitText}`, city: "Sugar Land", state: "TX", zip: chance(0.12) ? `${zip}-${pad(int(1, 9999), 4)}` : zip };
  };
  const dobText = (p: Person): string => `${pad(p.dob.m)}/${pad(p.dob.d)}/${p.dob.y}`;
  const dateText = (iso: string, style: "mdy" | "iso"): string => {
    const [y, m, d] = iso.split("-");
    return style === "iso" ? iso : `${m}/${d}/${y}`;
  };
  const shiftIso = (iso: string, days: number): string => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };
  const money = (cents: number, style: number): string => {
    const d = Math.floor(cents / 100);
    const c = pad(cents % 100);
    return style === 0 ? `$${String(d).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${c}` : `${d}.${c}`;
  };

  const emitCluster = (cluster: Household[]) => {
    // Which sources know each person.
    const where = new Map<string, Set<"dir" | "neon">>();
    for (const h of cluster) {
      for (const p of h.people) {
        const s = new Set<"dir" | "neon">();
        if (p.role === "child") {
          if (chance(0.92)) s.add("dir");
        } else {
          const inDir = chance(0.78) || h.kind === "sr_jr" || h.kind === "shared_phone" || h.kind === "shared_email"; // a directory lists both Sr and Jr
          const inNeon = chance(0.6);
          if (inDir) s.add("dir");
          if (inNeon || !inDir) s.add("neon");
        }
        // The second namesake is known only by a name and a town in the directory.
        if (h.kind === "namesake_sparse") {
          s.clear();
          s.add("dir");
        }
        where.set(p.id, s);
      }
    }

    // A directory prints one block per household (address, landline, family number), so the rows of a household agree on
    // them; what varies is who is listed with a mobile or an e-mail.
    const block = new Map(
      cluster.map((h) => [h.id, { address: chance(FILL.dirAddress), landline: chance(FILL.dirLandline) || h.kind === "shared_phone", familyId: chance(FILL.dirFamilyId) }]),
    );
    for (const h of cluster) {
      for (const p of h.people) {
        const has = where.get(p.id)!;
        const dirBlock = block.get(h.id)!;
        const base = { person: p.id, household: h.id, gift: null as string | null };
        if (has.has("dir")) {
          const { name, note } = nameText(p, "dir", 0.18);
          const useMaiden = p.maiden !== null && chance(0.6);
          const fields: Partial<RawRecord> = { name: useMaiden ? `${p.given} ${p.maiden}` : name };
          let why: string | null = useMaiden ? "wife under her maiden name" : note;
          if (p.role === "child") {
            const r = rnd();
            if (r < 0.65) fields.role = pick(["Child", "Son", "Daughter"]);
            else if (r < 0.85) fields.dob = dobText(p);
            else fields.grade = `Grade ${int(1, 9)}`;
            if (h.landline && dirBlock.landline) fields.phone = phoneText(h.landline);
            if (dirBlock.address) Object.assign(fields, addressFields(h, 0));
            if (chance(0.3)) fields.school = "Cedar Elementary";
            why = "child";
          } else if (h.kind === "namesake_sparse" || (h.kind === "sparse" && chance(0.5))) {
            fields.city = "Sugar Land";
            why = "a name and a town only";
          } else {
            if (p.mobile && chance(FILL.dirMobile)) fields.mobile = phoneText(p.mobile);
            if (h.landline && dirBlock.landline) fields.phone = phoneText(h.landline);
            if (p.email && chance(FILL.dirEmail)) fields.email = emailText(p.email);
            if (dirBlock.address) Object.assign(fields, addressFields(h, 0));
            if (chance(h.kind === "sr_jr" ? 0.5 : 0.25)) fields.dob = dobText(p);
            if (dirBlock.familyId) fields.ids = { family: h.familyId };
            // The maiden-name wife often gives only an address: no phone, no e-mail, nothing else to go on.
            if (useMaiden && chance(0.55)) {
              delete fields.mobile;
              delete fields.phone;
              delete fields.email;
              delete fields.ids;
              why = "wife under her maiden name, address only";
            }
          }
          push("directory.xlsx", "spreadsheet", "person", fields, { ...base, isChild: p.role === "child", note: why, protect: h.kind === "shared_phone" || h.kind === "shared_email" });
        }
        if (has.has("neon")) {
          const { name, note } = nameText(p, "neon", 0.12);
          const fields: Partial<RawRecord> = { name, ids: { neon: p.neonId } };
          if (p.mobile && chance(FILL.neonMobile)) fields.mobile = phoneText(p.mobile);
          if (p.email && chance(FILL.neonEmail)) fields.email = emailText(p.email);
          if (p.role !== "child") Object.assign(fields, addressFields(h, 1 - FILL.neonAddress));
          if (chance(0.2)) fields.dob = dobText(p);
          if (p.maiden && chance(0.5)) fields.name = `${p.given} ${p.maiden}-${p.surname}`;
          push("neon-export.csv", "connector", "person", fields, { ...base, isChild: p.role === "child", note });
        }
        // A name in Gujarati script, linkable only by its phone and e-mail.
        if (scriptRows < 2 && h.kind === "couple" && p.role === "head" && p.mobile && p.email && has.has("neon")) {
          push("directory.xlsx", "spreadsheet", "person", { name: SCRIPT_NAMES[scriptRows], mobile: phoneText(p.mobile), email: emailText(p.email) }, { ...base, note: "name in Gujarati script" });
          scriptRows += 1;
        }
      }
    }

    // Gifts.
    for (const h of cluster) {
      for (const p of h.people) {
        if (p.role === "child" || !chance(0.33)) continue;
        for (let k = int(1, 2); k > 0; k--) {
          giftSeq += 1;
          const gid = `G${pad(giftSeq, 4)}`;
          const method = rnd();
          const sources: Array<"zeffy" | "qbo" | "bank"> = method < 0.45 ? ["zeffy"] : method < 0.55 ? ["bank"] : ["qbo"];
          if (sources[0] !== "qbo" && chance(0.42)) sources.push("qbo");
          const cents = pick([2500, 5100, 10000, 10100, 15000, 25000, 50000, 100000]) + (chance(0.3) ? int(1, 20) * 100 : 0);
          const date = `2026-${pad(int(1, 9))}-${pad(int(1, 28))}`;
          const check = sources[0] === "bank" ? String(int(1000, 9999)) : null;
          const fund = pick(["General", "Diwali", "Temple", "Youth"]);
          // A few duplicates disagree by cents (a fee, a typo): money conflicts.
          let secondCents: number | null = null;
          if (sources.length === 2 && (centsDiffs === 0 || (centsDiffs < Math.max(1, Math.round(opts.rows / 150)) && chance(0.2)))) {
            secondCents = cents + pick([-5, -1, 1, 5, 25]);
            centsDiffs += 1;
          }
          const base = { person: p.id, household: h.id, gift: gid };
          for (const where of sources) {
            const second = where !== sources[0];
            const c = second && secondCents !== null ? secondCents : cents;
            const note = secondCents !== null ? "gift whose two sources differ by cents" : second ? "the same gift, seen second" : "gift";
            if (where === "zeffy") {
              const fields: Partial<RawRecord> = { name: `${p.given} ${surnameText(p.surname, 0.1)}`, gift: { amount: money(c, 0), date: dateText(date, "mdy"), fund } };
              if (p.email && chance(FILL.zeffyEmail)) fields.email = emailText(p.email);
              if (chance(FILL.zeffyAddress)) Object.assign(fields, addressFields(h, 0));
              if (p.mobile && chance(FILL.zeffyMobile)) fields.mobile = phoneText(p.mobile);
              push("zeffy-export.csv", "spreadsheet", "gift", fields, { ...base, note });
            } else if (where === "bank") {
              const fields: Partial<RawRecord> = {
                name: `${p.given} ${p.surname}`.toUpperCase(),
                gift: { amount: money(c, 1), date: dateText(date, "mdy"), ref: `Check #${check}`, fund },
              };
              push("bank-export.csv", "spreadsheet", "gift", fields, { ...base, note: `${note}; check deposit, payer name only` });
            } else {
              const fields: Partial<RawRecord> = {
                name: `${surnameText(p.surname, 0.1)}, ${p.given}`,
                ids: { quickbooks: h.qboId },
                gift: { amount: money(c, 1), date: dateText(second ? shiftIso(date, int(0, 2)) : date, "iso"), ref: check, fund },
              };
              if (p.email && chance(FILL.qboEmail)) fields.email = emailText(p.email);
              if (p.mobile && chance(FILL.qboMobile)) fields.mobile = phoneText(p.mobile);
              if (chance(FILL.qboAddress)) Object.assign(fields, addressFields(h, 0));
              push("quickbooks", "connector", "gift", fields, { ...base, note });
            }
          }
        }
      }
    }
  };

  // A file of a reasonable size always contains one of every named mess; the rest is drawn at random.
  if (opts.rows >= 150) for (const kind of Object.keys(BAND)) emitCluster(makeCluster(kind));
  while (pending.length < opts.rows) emitCluster(makeCluster());

  // Trim to the requested size by dropping random rows (a dropped row never changes what the truth says about the others).
  while (pending.length > opts.rows) pending.splice(Math.floor(rnd() * pending.length), 1);

  // Number the rows file by file, in the order a person would load the files.
  const records: RawRecord[] = [];
  const truth: Record<string, TruthRow> = {};
  const counts: Record<string, number> = {};
  for (const source of SOURCE_ORDER) {
    for (const row of pending.filter((p) => p.source === source)) {
      counts[source] = (counts[source] ?? 0) + 1;
      const id = `${source.split(/[.-]/)[0]}#${counts[source]}`;
      records.push({ id, source, sourceKind: row.sourceKind, row: counts[source], kind: row.kind, ...row.fields });
      truth[id] = row.truth;
    }
  }
  return { records, truth, counts };
}
