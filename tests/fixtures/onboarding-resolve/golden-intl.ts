// SYNTHETIC multicultural golden fixture for the resolve engine. Every person, phone, e-mail and address is invented by a seeded
// generator; nothing comes from a real community. The community is not tied to one tradition or one country: it holds Hispanic,
// Arabic, Chinese, Korean, Japanese, Slavic, Vietnamese, Western and South Asian households, written the way real exports write
// them. The generator knows the truth (who is who) because it makes the people first and then writes MESSY rows about them:
//   * accents and no accents, double surnames (Garcia Lopez), "de la Cruz", Al-Farsi / Al Farsi / Alfarsi, Mohammed / Muhammad,
//   * family name first (Wang Wei / Wei Wang, Kim Min-jun), Cantonese and pinyin spellings of one family name (Cheung / Zhang),
//   * Cyrillic, Arabic, Han and Hangul spellings of a name in a row of its own, Vietnamese order (Nguyen Van An / An Nguyen),
//   * nicknames (Pepe, Bob, Liz, Sasha), McDonald / MacDonald, Mueller / Muller, O'Brien, Soren / Søren, honorifics (Sra., Herr, Dr.),
//   * wives who keep their own family name, two people with one common name, a father and son (Jr), a phone or e-mail shared by
//     two unrelated households, children, and fields missing at random.
// The same seed always gives the same file, so the numbers in the tests are reproducible. The truth is returned with the rows,
// in the same shape as the Indian-heavy fixture (golden.ts), so one set of assertions serves both.

import type { RawRecord } from "@/lib/onboarding/resolve/types";

import type { Golden, TruthRow } from "./golden";

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

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** What a person types when the keyboard has no accents. */
function plain(s: string): string {
  return s
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

// ---------------------------------------------------------------------------
// Invented people, by culture. The first form of a name is its canonical spelling; the others are real alternatives.
// ---------------------------------------------------------------------------

type Culture = "hispanic" | "arabic" | "chinese" | "korean" | "japanese" | "slavic" | "vietnamese" | "western" | "south_asian";
type Name = { forms: string[]; nick?: string[] };

const n = (...forms: string[]): Name => ({ forms });

const GIVEN: Record<Culture, { m: Name[]; f: Name[] }> = {
  hispanic: {
    m: [{ forms: ["José"], nick: ["Pepe"] }, n("Juan"), n("Carlos"), n("Luis"), n("Miguel"), n("Jorge"), n("Pedro"), n("Andrés"), n("Javier"), n("Manuel"), n("Ricardo"), n("Diego")],
    f: [n("María"), n("Ana"), n("Carmen"), n("Lucía"), n("Rosa"), n("Sofía"), n("Elena"), n("Isabel"), n("Laura"), n("Marta"), n("Teresa"), n("Pilar")],
  },
  arabic: {
    m: [n("Mohammed", "Muhammad", "Mohamed", "Mohammad"), n("Ahmed", "Ahmad"), n("Omar", "Umar"), n("Hussein", "Hussain", "Husain"), n("Yusuf", "Youssef", "Yousef"), n("Ali"), n("Khalid", "Khaled"), n("Ibrahim", "Ebrahim"), n("Hassan", "Hasan"), n("Mustafa", "Moustafa", "Mostafa"), n("Tariq", "Tarek"), n("Karim", "Kareem"), n("Samir", "Sameer")],
    f: [n("Fatima", "Fatimah", "Fatema"), n("Aisha", "Ayesha", "Aysha"), n("Layla", "Leila", "Laila"), n("Zainab", "Zaynab", "Zeinab"), n("Maryam", "Mariam"), n("Amira", "Ameera"), n("Yasmin", "Yasmine"), n("Noor", "Nour")],
  },
  chinese: {
    m: [n("Wei"), n("Jun"), n("Ming"), n("Lei"), n("Hao"), n("Jian"), n("Tao"), n("Bo"), n("Yang"), n("Xiao Ming")],
    f: [n("Li"), n("Mei"), n("Xiu Ying"), n("Fang"), n("Jing"), n("Ying"), n("Hui"), n("Na"), n("Yan"), n("Lan")],
  },
  korean: {
    m: [n("Min-jun"), n("Seo-jun"), n("Ji-hoon"), n("Hyun-woo"), n("Joon-ho"), n("Dong-hyun")],
    f: [n("Seo-yeon"), n("Ji-woo"), n("Min-ji"), n("Eun-ji"), n("Soo-ah"), n("Ha-eun")],
  },
  japanese: {
    m: [n("Kenji"), n("Hiroshi"), n("Takeshi"), n("Haruto"), n("Ren"), n("Daiki"), n("Shinji")],
    f: [n("Yuki"), n("Sakura"), n("Aiko"), n("Hana"), n("Mika"), n("Rei")],
  },
  slavic: {
    m: [{ forms: ["Sergey", "Sergei", "Sergej"] }, n("Dmitri", "Dmitry", "Dmitriy"), { forms: ["Alexander", "Aleksandr"], nick: ["Sasha"] }, n("Nikolai", "Nikolay"), n("Vladimir"), n("Pavel"), n("Łukasz"), n("Đorđe"), n("Tomasz"), n("Piotr")],
    f: [n("Natalia", "Natalya"), n("Olga"), n("Tatiana", "Tatyana"), n("Irina", "Iryna"), n("Elena", "Yelena"), n("Zofia"), n("Katarzyna"), n("Svetlana", "Svitlana"), n("Anastasia", "Anastasiya")],
  },
  vietnamese: {
    m: [n("Minh"), n("Tuan"), n("Hung"), n("Duc"), n("An"), n("Hieu"), n("Khoa"), n("Thanh")],
    f: [n("Mai"), n("Lan"), n("Ha"), n("Hoa"), n("Anh"), n("Linh"), n("Thao"), n("Trang")],
  },
  western: {
    m: [{ forms: ["Robert"], nick: ["Bob", "Rob"] }, { forms: ["Michael"], nick: ["Mike"] }, { forms: ["William"], nick: ["Bill"] }, { forms: ["James"], nick: ["Jim"] }, { forms: ["David"], nick: ["Dave"] }, { forms: ["Thomas"], nick: ["Tom"] }, n("Søren"), n("Hans"), n("Giuseppe"), n("Jean-Luc"), n("Andrew")],
    f: [{ forms: ["Elizabeth"], nick: ["Liz", "Beth"] }, { forms: ["Katherine", "Catherine"], nick: ["Kate"] }, { forms: ["Jennifer"], nick: ["Jen"] }, { forms: ["Susan"], nick: ["Sue"] }, { forms: ["Margaret"], nick: ["Maggie"] }, n("Sarah", "Sara"), n("Zoë"), n("Chloé"), n("Rebecca")],
  },
  south_asian: {
    m: [n("Rahul"), n("Amit"), n("Vikram"), n("Arjun"), n("Sanjay"), n("Imran"), n("Faisal")],
    f: [n("Priya"), n("Anjali"), n("Kavita"), n("Deepa"), n("Sana"), n("Nadia")],
  },
};

type Family = { forms: string[]; native?: string; pair?: [string, string]; feminine?: string };

const FAMILIES: Record<Culture, Family[]> = {
  hispanic: [
    { forms: ["García López"], pair: ["García", "López"] }, { forms: ["Rodríguez Martínez"], pair: ["Rodríguez", "Martínez"] }, { forms: ["Hernández González"], pair: ["Hernández", "González"] },
    { forms: ["Pérez Sánchez"], pair: ["Pérez", "Sánchez"] }, { forms: ["Ramírez Torres"], pair: ["Ramírez", "Torres"] }, { forms: ["Flores Rivera"], pair: ["Flores", "Rivera"] },
    { forms: ["Díaz Morales"], pair: ["Díaz", "Morales"] }, { forms: ["Gómez Ruiz"], pair: ["Gómez", "Ruiz"] }, { forms: ["Muñoz Vargas"], pair: ["Muñoz", "Vargas"] },
    { forms: ["de la Cruz Reyes"], pair: ["de la Cruz", "Reyes"] }, { forms: ["Álvarez Castillo"], pair: ["Álvarez", "Castillo"] }, { forms: ["Jiménez Ortiz"], pair: ["Jiménez", "Ortiz"] },
  ],
  arabic: [
    { forms: ["Al-Farsi", "Al Farsi", "Alfarsi"], native: "الفارسي" }, { forms: ["Al-Hassan", "Al Hassan"] }, { forms: ["Haddad"] }, { forms: ["Khalil"] }, { forms: ["Nasser", "Naser"] },
    { forms: ["Mansour", "Mansur"] }, { forms: ["Saleh", "Salih"] }, { forms: ["Abdullah"] }, { forms: ["Al-Said", "Al Said"] }, { forms: ["Rahman", "Rehman"] },
    { forms: ["Qureshi", "Quraishi"] }, { forms: ["Siddiqui", "Siddiqi"] }, { forms: ["Chowdhury", "Choudhury"] },
  ],
  chinese: [
    { forms: ["Zhang", "Cheung", "Chang"], native: "张" }, { forms: ["Wang", "Wong"], native: "王" }, { forms: ["Li", "Lee"], native: "李" }, { forms: ["Liu", "Lau"], native: "刘" },
    { forms: ["Chen", "Chan"], native: "陈" }, { forms: ["Yang", "Yeung"], native: "杨" }, { forms: ["Huang"], native: "黄" }, { forms: ["Zhao", "Chao"], native: "赵" },
    { forms: ["Wu", "Woo"], native: "吴" }, { forms: ["Zhou", "Chow"], native: "周" }, { forms: ["Xu", "Hsu"], native: "徐" }, { forms: ["Lin", "Lam"], native: "林" },
  ],
  korean: [{ forms: ["Kim"], native: "김" }, { forms: ["Park"], native: "박" }, { forms: ["Choi"], native: "최" }, { forms: ["Jung", "Jeong", "Chung"], native: "정" }, { forms: ["Kang"], native: "강" }, { forms: ["Cho", "Jo"], native: "조" }, { forms: ["Yoon", "Yun"], native: "윤" }],
  japanese: [{ forms: ["Tanaka"] }, { forms: ["Suzuki"] }, { forms: ["Sato", "Satoh", "Satou"] }, { forms: ["Takahashi"] }, { forms: ["Watanabe"] }, { forms: ["Ito", "Itoh", "Itou"] }, { forms: ["Yamamoto"] }, { forms: ["Nakamura"] }, { forms: ["Kobayashi"] }, { forms: ["Kato", "Katoh"] }],
  slavic: [
    { forms: ["Ivanov", "Ivanoff"], native: "Иванов", feminine: "Ivanova" }, { forms: ["Petrov", "Petroff"], native: "Петров", feminine: "Petrova" }, { forms: ["Smirnov", "Smirnoff"], native: "Смирнов", feminine: "Smirnova" },
    { forms: ["Kuznetsov"], native: "Кузнецов", feminine: "Kuznetsova" }, { forms: ["Popov"], native: "Попов", feminine: "Popova" }, { forms: ["Nowak", "Novak"] }, { forms: ["Kowalski", "Kovalski"], feminine: "Kowalska" },
    { forms: ["Wiśniewski"], feminine: "Wiśniewska" }, { forms: ["Dvořák"] }, { forms: ["Petrović"] }, { forms: ["Shevchenko"], native: "Шевченко" },
  ],
  vietnamese: [{ forms: ["Nguyen", "Nguyễn"] }, { forms: ["Tran", "Trần"] }, { forms: ["Le", "Lê"] }, { forms: ["Pham", "Phạm"] }, { forms: ["Hoang"] }, { forms: ["Vo", "Võ"] }, { forms: ["Dang", "Đặng"] }, { forms: ["Bui", "Bùi"] }],
  western: [
    { forms: ["Smith", "Smyth"] }, { forms: ["Johnson"] }, { forms: ["Brown"] }, { forms: ["Müller", "Mueller"] }, { forms: ["O'Brien", "OBrien"] }, { forms: ["McDonald", "MacDonald"] },
    { forms: ["Schmidt", "Schmitt"] }, { forms: ["Rossi"] }, { forms: ["Dubois"] }, { forms: ["Hansen"] }, { forms: ["Meyer", "Meier"] }, { forms: ["Williams"] },
  ],
  south_asian: [{ forms: ["Sharma"] }, { forms: ["Singh"] }, { forms: ["Iyer", "Iyyer"] }, { forms: ["Reddy", "Reddi"] }, { forms: ["Khan"] }, { forms: ["Gupta"] }, { forms: ["Banerjee", "Bannerjee"] }, { forms: ["Agarwal", "Agrawal"] }],
};

const CULTURES = Object.keys(GIVEN) as Culture[];
const NATIVE_GIVEN: Record<string, string> = { Wei: "伟", Jun: "军", Ming: "明", Mei: "梅", "Min-jun": "민준", "Seo-yeon": "서연", Sergey: "Сергей", Dmitri: "Дмитрий", Olga: "Ольга", Natalia: "Наталья", Mohammed: "محمد", Ahmed: "أحمد", Fatima: "فاطمة" };

const STREETS = ["Lotus Lane", "Maple Court", "Cedar Drive", "Willow Road", "Jasmine Way", "Orchid Street", "Harbor Circle", "Saffron Place", "Birch Trail", "Marigold Avenue", "Garden Boulevard", "Mill Terrace"];
const ZIPS = ["77478", "77479", "77459", "77406", "77099"];
const POSTCODES = ["LS1 4AB", "M1 2WD", "B3 3HN", "SW1A 2AA", "EH1 1YZ", "BS1 4DJ"];
const CITY = { US: "Sugar Land", GB: "Leeds" } as const;

type Person = {
  id: string;
  household: string;
  culture: Culture;
  male: boolean;
  given: Name;
  family: Family;
  role: "head" | "spouse" | "child" | "adult_child";
  generation: "jr" | "sr" | null;
  dob: { y: number; m: number; d: number };
  mobile: string | null;
  email: string | null;
  crmId: string;
  nativeRow: boolean;
};

type Household = {
  id: string;
  kind: string;
  house: { number: string; street: string; unit: string | null; zip: string };
  landline: string | null;
  familyId: string;
  people: Person[];
};

type Pending = { source: string; sourceKind: RawRecord["sourceKind"]; fields: Partial<RawRecord>; truth: TruthRow };

const FILL = { mobile: 0.93, email: 0.88, dirAddress: 0.96, dirLandline: 0.8, crmAddress: 0.92, giveEmail: 0.97, giveAddress: 0.85, giveMobile: 0.7 } as const;
const SOURCE_ORDER = ["directory.xlsx", "crm-export.csv", "giving-export.csv"];
const CHILD_SHARE = 0.05;

export function buildGoldenIntl(opts: { rows: number; seed: number; country?: "US" | "GB" }): Golden {
  const country = opts.country ?? "US";
  const rnd = mulberry32(opts.seed);
  const chance = (p: number) => rnd() < p;
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const usedPhones = new Set<string>();
  const usedEmails = new Set<string>();
  const usedAddresses = new Set<string>();
  const usedNames = new Set<string>();
  let personSeq = 0;
  let householdSeq = 0;
  let kidsMade = 0;
  let nativeRows = 0;
  const kidCap = Math.round(opts.rows * CHILD_SHARE);

  const freshPhone = (): string => {
    for (;;) {
      // US: 555 exchange; UK: the 07700 900xxx range reserved for drama.
      const p = country === "US" ? `${pick(["713", "281", "832"])}555${pad(int(0, 9999), 4)}` : `07700900${pad(int(0, 999), 3)}`;
      if (!usedPhones.has(p) && !/^(\d)\1+$/.test(p)) {
        usedPhones.add(p);
        return p;
      }
    }
  };
  const freshLandline = (): string => {
    for (;;) {
      const p = country === "US" ? `${pick(["713", "281"])}555${pad(int(0, 9999), 4)}` : `0207946${pad(int(0, 999), 3)}0`.slice(0, 11);
      if (!usedPhones.has(p)) {
        usedPhones.add(p);
        return p;
      }
    }
  };
  const freshEmail = (g: string, s: string): string => {
    for (let k = int(1, 90); ; k++) {
      const domain = pick(["example.com", "example.org", "example.net"]);
      const e = `${plain(g).toLowerCase().replace(/[^a-z]/g, "")}.${plain(s).toLowerCase().replace(/[^a-z]/g, "")}${k}@${domain}`;
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
      const zip = country === "US" ? pick(ZIPS) : pick(POSTCODES);
      const k = `${number}|${street}|${zip}`;
      if (!usedAddresses.has(k)) {
        usedAddresses.add(k);
        return { number, street, unit: null, zip };
      }
    }
  };

  const makePerson = (h: Household, culture: Culture, p: Partial<Person> & Pick<Person, "role" | "male" | "given" | "family">): Person => {
    personSeq += 1;
    const adult = p.role !== "child";
    const born = adult ? int(1950, 1992) : int(2011, 2022);
    const given = p.given.forms[0] ?? "";
    const person: Person = {
      id: `P${pad(personSeq, 4)}`,
      household: h.id,
      culture,
      generation: null,
      dob: { y: born, m: int(1, 12), d: int(1, 28) },
      mobile: adult && chance(FILL.mobile) ? freshPhone() : null,
      email: adult && chance(FILL.email) ? freshEmail(given, p.family.forms[0] ?? "x") : null,
      crmId: `C${pad(personSeq * 7 + 100, 5)}`,
      nativeRow: false,
      ...p,
    };
    h.people.push(person);
    return person;
  };
  const newHousehold = (kind: string, house?: Household["house"], landline?: string | null): Household => {
    householdSeq += 1;
    return {
      id: `H${pad(householdSeq, 3)}`,
      kind,
      house: house ?? freshHouse(),
      landline: landline === undefined ? (chance(0.5) ? freshLandline() : null) : landline,
      familyId: `F-${pad(householdSeq * 3 + 1000, 4)}`,
      people: [],
    };
  };

  /** The first household of a culture takes the first given name and family name of its lists, so every culture's best-known spellings are in a file. */
  let canonicalFirst = false;
  let forcedFamily: Family | null = null;
  /** A given name nobody else in the file has with the same family name (two real namesakes are made on purpose). */
  const freshGiven = (culture: Culture, male: boolean, family: Family): Name => {
    const list = GIVEN[culture][male ? "m" : "f"];
    if (canonicalFirst) {
      const g = list[0] as Name;
      usedNames.add(`${g.forms[0]}|${family.forms[0]}`);
      return g;
    }
    for (let tries = 0; tries < 200; tries++) {
      const g = pick(list);
      const k = `${g.forms[0]}|${family.forms[0]}`;
      if (!usedNames.has(k)) {
        usedNames.add(k);
        return g;
      }
    }
    return pick(list);
  };

  const makeCluster = (culture: Culture, force?: string): Household[] => {
    const roll = force ? ({ couple_kids: 0.1, sr_jr: 0.62, namesake: 0.72, shared_phone: 0.78, complex: 0.84, sparse: 0.9 } as Record<string, number>)[force] ?? rnd() : rnd();
    const family = forcedFamily ?? (canonicalFirst ? (FAMILIES[culture][0] as Family) : pick(FAMILIES[culture]));
    const wifeFamily = (): Family => {
      // Hispanic, Arabic, Chinese, Korean and Vietnamese wives often keep their own family name (the fixture's stated assumption: half
      // of them; on a US form many write his); Western, Japanese and South Asian wives mostly take his.
      const keeps = culture === "western" || culture === "south_asian" || culture === "japanese" ? chance(0.15) : chance(0.5);
      return keeps ? pick(FAMILIES[culture].filter((f) => f !== family)) : family;
    };
    const head = (h: Household, male = true, fam = family, role: Person["role"] = "head") => makePerson(h, culture, { role, male, given: freshGiven(culture, male, fam), family: fam });
    if (roll < 0.34) {
      const h = newHousehold("couple_kids");
      head(h);
      head(h, false, wifeFamily(), "spouse");
      for (let k = chance(0.5) ? (chance(0.6) ? 1 : 2) : 0; k > 0 && kidsMade < kidCap; k--) {
        const male = chance(0.5);
        makePerson(h, culture, { role: "child", male, given: freshGiven(culture, male, family), family });
        kidsMade += 1;
      }
      return [h];
    }
    if (roll < 0.52) {
      const h = newHousehold("couple");
      head(h);
      head(h, false, wifeFamily(), "spouse");
      return [h];
    }
    if (roll < 0.66) {
      const h = newHousehold("single");
      head(h, chance(0.5));
      return [h];
    }
    if (roll < 0.7) {
      // Father and son with one name: Sr and Jr (Western and Hispanic households write it).
      const h = newHousehold("sr_jr");
      const g = freshGiven(culture, true, family);
      makePerson(h, culture, { role: "head", male: true, given: g, family, generation: "sr", dob: { y: int(1948, 1958), m: int(1, 12), d: int(1, 28) } });
      makePerson(h, culture, { role: "adult_child", male: true, given: g, family, generation: "jr", dob: { y: int(1978, 1988), m: int(1, 12), d: int(1, 28) } });
      return [h];
    }
    if (roll < 0.76) {
      // Two different people with exactly the same (very common) name: unrelated, different everything.
      const g = pick(GIVEN[culture].m);
      return [0, 1].map((k) => {
        const h = newHousehold(k === 0 ? "namesake" : "namesake_sparse");
        makePerson(h, culture, { role: "head", male: true, given: g, family });
        return h;
      });
    }
    if (roll < 0.82) {
      // Two unrelated households that share one landline.
      const shared = freshLandline();
      const other = pick(FAMILIES[culture].filter((f) => f !== family));
      return [family, other].map((f) => {
        const h = newHousehold("shared_phone", undefined, shared);
        const p = head(h, true, f);
        p.mobile = null;
        p.email = null;
        return h;
      });
    }
    if (roll < 0.88) {
      // Two different families in one apartment complex: different units.
      const street = pick(STREETS);
      const base = String(int(100, 900));
      const zip = country === "US" ? pick(ZIPS) : pick(POSTCODES);
      const other = pick(FAMILIES[culture].filter((f) => f !== family));
      return [family, other].map((f, i) => {
        const h = newHousehold("complex", { number: base, street, unit: String(100 + i * 100 + int(1, 40)), zip }, null);
        head(h, true, f);
        head(h, false, f, "spouse");
        return h;
      });
    }
    if (roll < 0.94) {
      // A sparse row: a name and a town, nothing to compare, of someone who is also known elsewhere.
      const h = newHousehold("sparse", undefined, null);
      const p = head(h, chance(0.5));
      p.mobile = freshPhone();
      p.email = freshEmail(p.given.forms[0] ?? "x", family.forms[0] ?? "x");
      return [h];
    }
    const h = newHousehold("single");
    head(h, chance(0.5));
    return [h];
  };

  // --- messy writers ----------------------------------------------------------------------------------------------------------
  const pending: Pending[] = [];
  const push = (source: string, sourceKind: Pending["sourceKind"], fields: Partial<RawRecord>, t: Omit<TruthRow, "gift" | "isChild" | "note"> & { isChild?: boolean; note?: string | null; protect?: boolean }) => {
    if (!t.protect) for (const f of ["email", "mobile", "phone", "address1"] as const) if (chance(0.02)) delete fields[f];
    pending.push({ source, sourceKind, fields, truth: { person: t.person, household: t.household, gift: null, isChild: t.isChild ?? false, note: t.note ?? null } });
  };

  const surnameOf = (p: Person): Family => p.family;
  /** One spelling of the family name, as a string. Hispanic double surnames come as one or both; Slavic wives take the feminine form. */
  const familyText = (p: Person, form: number): string => {
    const f = surnameOf(p);
    if (p.culture === "slavic" && !p.male && f.feminine) return f.feminine;
    return f.forms[form % f.forms.length] ?? f.forms[0] ?? "";
  };
  const givenText = (p: Person, form: number): string => p.given.forms[form % p.given.forms.length] ?? p.given.forms[0] ?? "";
  const typo = (s: string): string => {
    if (s.length < 5) return s;
    const i = int(1, s.length - 2);
    return s.slice(0, i) + s.slice(i + 1);
  };

  /** The name as a directory or a giving form prints it: one string, in the style of its culture. */
  const nameText = (p: Person, source: "dir" | "giving"): { name: string; note: string | null } => {
    const variant = chance(source === "dir" ? 0.3 : 0.15) ? int(1, 3) : 0;
    const g0 = givenText(p, variant);
    const s0 = familyText(p, variant);
    const mark = p.generation === "jr" ? "Jr." : p.generation === "sr" ? "Sr." : "";
    const withMark = (t: string) => (mark && chance(0.6) ? `${t} ${mark}` : t);
    const note: string | null = variant ? `another spelling (${g0} ${s0})` : null;
    const r = rnd();
    switch (p.culture) {
      case "hispanic": {
        const [a, b] = p.family.pair ?? [s0, ""];
        const full = `${a} ${b}`;
        if (r < 0.28) return { name: withMark(`${g0} ${full}`), note };
        if (r < 0.45) return { name: withMark(`${g0} ${a}`), note: "paternal surname only" };
        if (r < 0.58) return { name: `${full}, ${g0}`, note };
        if (r < 0.7) return { name: plain(`${g0} ${full}`), note: "no accents" };
        if (r < 0.78) return { name: plain(`${g0} ${a}-${b}`), note: "hyphenated double surname" };
        if (r < 0.86) return { name: `${p.male ? "Sr." : "Sra."} ${g0} ${a}`, note: "Spanish honorific" };
        if (r < 0.92 && p.given.nick?.[0]) return { name: `${p.given.nick[0]} ${a}`, note: "nickname" };
        return { name: `${g0} ${a} ${b}`.toUpperCase(), note: "capitals" };
      }
      case "arabic": {
        if (r < 0.45) return { name: `${g0} ${s0}`, note };
        if (r < 0.58) return { name: `${s0}, ${g0}`, note };
        if (r < 0.68) return { name: `${p.male ? "Dr." : "Mrs."} ${g0} ${s0}`, note };
        if (r < 0.78) return { name: `${g0} ${pick(["Ali", "Hassan", "Omar"])} ${s0}`, note: "father's name as a middle name" };
        if (r < 0.86 && s0.startsWith("Al")) return { name: `${g0} ${s0.replace(/^Al[ -]?/, "Al-")}`, note: "Al- written with a hyphen" };
        return { name: `${g0} ${s0}`.toUpperCase(), note: "capitals" };
      }
      case "chinese":
      case "korean":
      case "japanese": {
        const westernOrder = `${g0} ${s0}`;
        const familyFirst = `${s0} ${g0}`;
        if (r < 0.4) return { name: westernOrder, note };
        if (r < 0.65) return { name: familyFirst, note: "family name first" };
        if (r < 0.78) return { name: `${s0}, ${g0}`, note };
        if (r < 0.88 && p.culture === "japanese") return { name: `${s0}-san`, note: "honorific -san" };
        if (r < 0.88 && p.culture === "korean") return { name: `${s0} ${g0.replace("-", "")}`, note: "given name without the hyphen" };
        if (r < 0.88) return { name: `${g0.split(" ").join("")} ${s0}`, note: "given name written together" };
        return { name: westernOrder.toUpperCase(), note: "capitals" };
      }
      case "slavic": {
        if (r < 0.5) return { name: withMark(`${g0} ${s0}`), note };
        if (r < 0.65) return { name: `${s0}, ${g0}`, note };
        if (r < 0.78 && p.given.nick?.[0]) return { name: `${p.given.nick[0]} ${s0}`, note: "nickname" };
        if (r < 0.9) return { name: plain(`${g0} ${s0}`), note: "no diacritics" };
        return { name: `${g0} ${s0}`.toUpperCase(), note: "capitals" };
      }
      case "vietnamese": {
        const middle = p.male ? "Van" : "Thi";
        if (r < 0.35) return { name: `${s0} ${middle} ${g0}`, note: "family name first, with the middle name" };
        if (r < 0.6) return { name: `${g0} ${s0}`, note: "given name first" };
        if (r < 0.75) return { name: `${s0}, ${g0}`, note };
        if (r < 0.88) return { name: `${middle} ${g0} ${s0}`, note: "middle name, given name, family name" };
        return { name: `${s0} ${middle} ${g0}`.toUpperCase(), note: "capitals" };
      }
      case "western": {
        const nick = p.given.nick && chance(0.35) ? pick(p.given.nick) : null;
        if (r < 0.4) return { name: withMark(`${nick ?? g0} ${s0}`), note: nick ? "nickname" : note };
        if (r < 0.55) return { name: `${s0}, ${nick ?? g0}`, note };
        if (r < 0.65) return { name: `${p.male ? "Mr." : "Ms."} ${g0} ${s0}`, note };
        if (r < 0.72) return { name: `${g0[0] ?? ""}. ${s0}`, note: "initial only" };
        if (r < 0.82 && nick) return { name: `${g0} (${nick}) ${s0}`, note: "nickname in brackets" };
        if (r < 0.9) return { name: plain(`${g0} ${s0}`), note: "no accents" };
        return { name: `${g0} ${s0}`.toUpperCase(), note: "capitals" };
      }
      default: {
        if (r < 0.5) return { name: `${g0} ${s0}`, note };
        if (r < 0.65) return { name: `${s0}, ${g0}`, note };
        if (r < 0.75) return { name: `${g0}${p.male ? "bhai" : "ben"} ${s0}`, note: "honorific suffix" };
        if (r < 0.85) return { name: `Shri ${g0} ${s0}`, note };
        return { name: `${g0} ${s0}`.toUpperCase(), note: "capitals" };
      }
    }
  };

  /** The CRM keeps the family name and the given name in columns of their own. */
  const crmColumns = (p: Person): { firstName: string; lastName: string } => {
    const variant = chance(0.12) ? 1 : 0;
    const s = p.culture === "hispanic" ? (p.family.pair ? `${p.family.pair[0]} ${p.family.pair[1]}` : familyText(p, 0)) : familyText(p, variant);
    let first = givenText(p, variant);
    if (chance(0.04)) first = typo(first);
    if (p.culture === "vietnamese") first = `${p.male ? "Van" : "Thi"} ${first}`;
    return { firstName: first, lastName: s };
  };

  const phoneText = (raw: string): string => {
    if (country === "GB") {
      const national = raw;
      return pick([`${national.slice(0, 5)} ${national.slice(5)}`, `+44 ${national.slice(1, 5)} ${national.slice(5)}`, national]);
    }
    const a = raw.slice(0, 3);
    const b = raw.slice(3, 6);
    const c = raw.slice(6);
    return pick([`(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `${a}${b}${c}`, `1-${a}-${b}-${c}`, `+1 ${a} ${b} ${c}`]);
  };
  const emailText = (e: string): string => {
    const r = rnd();
    return r < 0.25 ? e.toUpperCase() : r < 0.35 ? e[0]!.toUpperCase() + e.slice(1) : e;
  };
  const abbrev: Record<string, string> = { Lane: "Ln", Court: "Ct", Drive: "Dr", Road: "Rd", Way: "Way", Street: "St", Circle: "Cir", Place: "Pl", Trail: "Trl", Avenue: "Ave", Boulevard: "Blvd", Terrace: "Ter" };
  const addressFields = (h: Household, missing: number): Partial<RawRecord> => {
    if (chance(missing)) return {};
    const { number, street, unit, zip } = h.house;
    const [name, suffix] = street.split(" ");
    const line = pick([`${number} ${street}`, `${number} ${name} ${abbrev[suffix ?? ""] ?? suffix}`, `${number} ${street.toUpperCase()}`]);
    const unitText = unit ? pick([` Apt ${unit}`, ` #${unit}`, ` Unit ${unit}`]) : "";
    return country === "US"
      ? { address1: `${line}${unitText}`, city: CITY.US, state: "TX", zip: chance(0.12) ? `${zip}-${pad(int(1, 9999), 4)}` : zip }
      : { address1: `${number} ${street}${unitText.replace("Apt", "Flat")}`, city: CITY.GB, zip: chance(0.3) ? zip.replace(" ", "").toLowerCase() : zip };
  };
  const dobText = (p: Person): string => (country === "US" ? `${pad(p.dob.m)}/${pad(p.dob.d)}/${p.dob.y}` : `${pad(p.dob.d)}/${pad(p.dob.m)}/${p.dob.y}`);

  const emitCluster = (cluster: Household[]) => {
    for (const h of cluster) {
      const block = { address: chance(FILL.dirAddress), landline: chance(FILL.dirLandline) || h.kind === "shared_phone" };
      for (const p of h.people) {
        const base = { person: p.id, household: h.id };
        const isChild = p.role === "child";
        const inDir = isChild ? chance(0.92) : chance(0.78) || h.kind === "sr_jr" || h.kind === "shared_phone";
        const inCrm = !isChild && (chance(0.6) || !inDir);
        const inGiving = !isChild && chance(0.4) && h.kind !== "namesake_sparse";
        const protect = h.kind === "shared_phone";

        if (inDir || h.kind === "namesake_sparse") {
          const { name, note } = nameText(p, "dir");
          const fields: Partial<RawRecord> = { name };
          let why = note;
          if (isChild) {
            const r = rnd();
            if (r < 0.65) fields.role = pick(["Child", "Son", "Daughter"]);
            else if (r < 0.85) fields.dob = dobText(p);
            else fields.grade = `Grade ${int(1, 9)}`;
            if (h.landline && block.landline) fields.phone = phoneText(h.landline);
            if (block.address) Object.assign(fields, addressFields(h, 0));
            why = "child";
          } else if (h.kind === "namesake_sparse" || (h.kind === "sparse" && chance(0.5))) {
            fields.city = CITY[country];
            why = "a name and a town only";
          } else {
            if (p.mobile && chance(0.93)) fields.mobile = phoneText(p.mobile);
            if (h.landline && block.landline) fields.phone = phoneText(h.landline);
            if (p.email && chance(0.92)) fields.email = emailText(p.email);
            if (block.address) Object.assign(fields, addressFields(h, 0));
            if (chance(h.kind === "sr_jr" ? 0.5 : 0.25)) fields.dob = dobText(p);
            if (chance(0.85)) fields.ids = { family: h.familyId };
          }
          push("directory.xlsx", "spreadsheet", fields, { ...base, isChild, note: why, protect });
        }
        if (inCrm) {
          const cols = crmColumns(p);
          // A CRM export carries the person's own number and, most of the time, the household (account) number.
          const fields: Partial<RawRecord> = { firstName: cols.firstName, lastName: cols.lastName, ids: chance(0.7) ? { crm: p.crmId, household: h.familyId } : { crm: p.crmId } };
          if (p.mobile && chance(0.94)) fields.mobile = phoneText(p.mobile);
          if (p.email && chance(0.95)) fields.email = emailText(p.email);
          Object.assign(fields, addressFields(h, 1 - FILL.crmAddress));
          if (chance(0.2)) fields.dob = dobText(p);
          push("crm-export.csv", "connector", fields, { ...base, note: "given and family name in columns" });
        }
        if (inGiving) {
          const { name, note } = nameText(p, "giving");
          const fields: Partial<RawRecord> = { name };
          if (p.email && chance(FILL.giveEmail)) fields.email = emailText(p.email);
          if (chance(FILL.giveAddress)) Object.assign(fields, addressFields(h, 0));
          if (p.mobile && chance(FILL.giveMobile)) fields.mobile = phoneText(p.mobile);
          push("giving-export.csv", "spreadsheet", fields, { ...base, note });
        }
        // A name in its own script, linkable only by its phone and e-mail.
        if (!isChild && nativeRows < 8 && inCrm && p.mobile && p.email && NATIVE_GIVEN[p.given.forms[0] ?? ""] && p.family.native && !p.nativeRow) {
          p.nativeRow = true;
          nativeRows += 1;
          const g = NATIVE_GIVEN[p.given.forms[0] ?? ""] ?? "";
          const text = p.culture === "chinese" ? `${p.family.native}${g}` : `${g} ${p.family.native}`;
          push("directory.xlsx", "spreadsheet", { name: text, mobile: phoneText(p.mobile), email: emailText(p.email) }, { ...base, note: `name in its own script (${text})` });
        }
      }
    }
  };

  // A file of a reasonable size always contains every culture and every named mess; the rest is drawn at random.
  if (opts.rows >= 150) {
    for (const c of CULTURES) {
      canonicalFirst = true;
      const cluster = makeCluster(c, "couple_kids");
      canonicalFirst = false;
      emitCluster(cluster);
    }
    // A family name with a particle ("de la Cruz Reyes") is in every file.
    forcedFamily = FAMILIES.hispanic.find((f) => f.pair?.[0] === "de la Cruz") ?? null;
    emitCluster(makeCluster("hispanic", "couple_kids"));
    forcedFamily = null;
    for (const c of ["hispanic", "chinese", "western"] as Culture[]) emitCluster(makeCluster(c, "namesake"));
    (["sr_jr", "shared_phone", "complex", "sparse"] as const).forEach((kind, i) => emitCluster(makeCluster((["western", "hispanic", "arabic", "vietnamese"] as Culture[])[i] ?? "western", kind)));
  }
  while (pending.length < opts.rows) {
    const c = pick([...CULTURES, "hispanic", "arabic", "chinese", "western", "slavic"] as Culture[]);
    emitCluster(makeCluster(c));
  }
  while (pending.length > opts.rows) pending.splice(Math.floor(rnd() * pending.length), 1);

  const records: RawRecord[] = [];
  const truth: Record<string, TruthRow> = {};
  const counts: Record<string, number> = {};
  for (const source of SOURCE_ORDER) {
    for (const row of pending.filter((p) => p.source === source)) {
      counts[source] = (counts[source] ?? 0) + 1;
      const id = `${source.split(/[.-]/)[0]}#${counts[source]}`;
      records.push({ id, source, sourceKind: row.sourceKind, row: counts[source] ?? 0, kind: "person", ...row.fields });
      truth[id] = row.truth;
    }
  }
  return { records, truth, counts };
}
