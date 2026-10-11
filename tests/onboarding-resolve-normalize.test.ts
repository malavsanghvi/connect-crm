import { describe, expect, it } from "vitest";

import {
  normalizeAddress,
  normalizeEmails,
  normalizeIdValue,
  normalizeMoney,
  normalizeName,
  normalizePhone,
  normalizePhones,
  normalizeRef,
  normalizeRecord,
  parseDate,
  phoneticKey,
  stripAttachedSuffix,
} from "@/lib/onboarding/resolve/normalize";
import { makeConfig } from "@/lib/onboarding/resolve/config";

const TODAY = "2026-10-11";
const cfg = makeConfig(TODAY);
const date = (s: unknown, order: "mdy" | "dmy" | "unknown" = "unknown", context: "birth" | "event" = "birth") =>
  parseDate(s, { order, today: TODAY, context });

/** A small deterministic random source, so the property tests are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("names: Latin spellings of Gujarati and Hindi names", () => {
  const same = (...spellings: string[]) => {
    const keys = new Set(spellings.map(phoneticKey));
    expect([...keys], spellings.join(" / ")).toHaveLength(1);
  };
  it("folds the usual variants of one surname", () => {
    same("Patel", "Patil", "Pattel", "Patell");
    same("Shah", "Saha", "Sha");
    same("Mehta", "Metha", "Meheta");
    same("Desai", "Dessai", "Desaii", "Desay");
    same("Doshi", "Dosi", "Doshee");
    same("Parekh", "Parikh");
    same("Thakkar", "Thakker", "Thaker");
    same("Gandhi", "Ghandi");
    same("Vora", "Vohra");
    same("Chokshi", "Choksi");
    same("Kapadia", "Kapadiya");
  });
  it("keeps different surnames apart", () => {
    const keys = ["Patel", "Shah", "Mehta", "Desai", "Doshi", "Jain", "Jani", "Parekh", "Kothari", "Trivedi", "Bhatt", "Modi", "Modh"].map(phoneticKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("ignores case, accents and extra spaces", () => {
    const a = normalizeName({ full: "  JOSÉ   RAMÍREZ " });
    const b = normalizeName({ full: "jose ramirez" });
    expect(a.people).toEqual(b.people);
  });
  it("strips bhai / ben / kumar / ji and honorifics", () => {
    for (const s of ["Rahulbhai Shah", "Shri Rahul Shah", "Rahul Bhai Shah", "Mr. Rahul Shah", "Rahul Shah, MD"]) {
      const p = normalizeName({ full: s }).people[0];
      expect([s, p.given, p.surname]).toEqual([s, "rahul", "shah"]);
    }
    expect(normalizeName({ full: "Miraben Patel" }).people[0].given).toBe("mira");
    expect(normalizeName({ full: "Mira Ben Patel" }).people[0].given).toBe("mira");
    expect(normalizeName({ full: "Ashokkumar Mehta" }).people[0].given).toBe("ashok");
    expect(normalizeName({ full: "Hasmukhji Doshi" }).people[0].given).toBe("hasmukh");
    expect(stripAttachedSuffix("raji")).toBe("raji"); // too short to strip
  });
  it("keeps Kumar as a surname and a western Ben as a given name", () => {
    expect(normalizeName({ full: "Rajesh Kumar" }).people[0].surname).toBe("kumar");
    const ben = normalizeName({ full: "Ben Smith" }).people[0];
    expect([ben.given, ben.surname]).toEqual(["ben", "smith"]);
  });
  it("reads 'Last, First' like 'First Last'", () => {
    const a = normalizeName({ full: "Shah, Rahul K." }).people[0];
    const b = normalizeName({ full: "Rahul K. Shah" }).people[0];
    expect([a.givenKey, a.surnameKey, a.middleKeys]).toEqual([b.givenKey, b.surnameKey, b.middleKeys]);
    const c = normalizeName({ first: "Rahul", last: "Shah" }).people[0];
    expect([c.givenKey, c.surnameKey]).toEqual([a.givenKey, a.surnameKey]);
  });
  it("splits a household-style name into people with the shared surname", () => {
    const n = normalizeName({ full: "Rahul & Mira Shah" });
    expect(n.people.map((p) => [p.given, p.surname])).toEqual([["rahul", "shah"], ["mira", "shah"]]);
    const m = normalizeName({ full: "Shah, Rahul and Mira" });
    expect(m.people.map((p) => [p.given, p.surname])).toEqual([["rahul", "shah"], ["mira", "shah"]]);
    expect(normalizeName({ full: "The Shah Family" }).people[0].surname).toBe("shah");
  });
  it("reads initials", () => {
    const p = normalizeName({ full: "R. K. Shah" }).people[0];
    expect([p.given, p.initial, p.middleKeys, p.surname]).toEqual([null, "r", ["k"], "shah"]);
    expect(normalizeName({ full: "R.K. Shah" }).people[0].initial).toBe("r");
  });
  it("finds maiden names: 'nee', brackets, hyphen", () => {
    const shah = phoneticKey("Shah");
    expect(normalizeName({ full: "Dr. Mira Patel nee Shah" }).people[0].maidenKey).toBe(shah);
    expect(normalizeName({ full: "Mira Patel (Shah)" }).people[0].maidenKey).toBe(shah);
    expect(normalizeName({ full: "Mira Patel (wife)" }).people[0].maidenKey).toBeNull();
    const h = normalizeName({ full: "Mira Shah-Patel" }).people[0];
    expect(h.surnameKey).toBe(phoneticKey("Patel"));
    expect(h.maidenKey).toBe(shah);
    expect(h.surnameParts).toEqual([shah, phoneticKey("Patel")]);
  });
  it("reads Jr and Sr and a child's title", () => {
    expect(normalizeName({ full: "Rahul Shah Jr." }).people[0].generation).toBe("jr");
    expect(normalizeName({ full: "Rahul Shah, Sr" }).people[0].generation).toBe("sr");
    expect(normalizeName({ full: "Master Arjun Shah" }).minorHint).toBe(true);
    expect(normalizeName({ full: "Arjun Shah" }).minorHint).toBe(false);
  });
  it("flags names in another script instead of guessing", () => {
    const n = normalizeName({ full: "રાહુલ શાહ" });
    expect(n.nonLatin).toBe(true);
    expect(n.missing).toBe(true);
    const mixed = normalizeName({ full: "रमेश Patel" });
    expect(mixed.nonLatin).toBe(true);
    expect(mixed.people[0].surname).toBe("patel");
  });
  it("handles blanks and a surname-only column", () => {
    expect(normalizeName({ full: "   " }).missing).toBe(true);
    const only = normalizeName({ last: "Shah" });
    expect(only.people[0].surname).toBe("shah");
    expect(only.people[0].given).toBeNull();
  });
  it("property: phoneticKey is idempotent and ignores case and doubled letters", () => {
    const rand = rng(11);
    const letters = "abcdefghijklmnoprstuvy";
    for (let i = 0; i < 300; i++) {
      const len = 3 + Math.floor(rand() * 8);
      let w = "";
      for (let k = 0; k < len; k++) w += letters[Math.floor(rand() * letters.length)];
      const key = phoneticKey(w);
      expect(phoneticKey(key), w).toBe(key);
      expect(phoneticKey(w.toUpperCase()), w).toBe(key);
      // doubling any letter never changes the key
      const at = Math.floor(rand() * w.length);
      expect(phoneticKey(w.slice(0, at + 1) + w[at] + w.slice(at + 1)), w).toBe(key);
    }
  });
});

describe("phones", () => {
  it("writes every US format as E.164", () => {
    for (const s of ["(713) 555-0142", "713-555-0142", "713.555.0142", "7135550142", "1-713-555-0142", "+1 713 555 0142", "(713) 555-0142 ext 12", "713 555 0142 x9"]) {
      expect(normalizePhone(s).value, s).toBe("+17135550142");
    }
    expect(normalizePhone(7135550142).value).toBe("+17135550142");
  });
  it("keeps a number that already has a country code", () => {
    expect(normalizePhone("+44 20 7946 0958").value).toBe("+442079460958");
    expect(normalizePhone("0091 98250 12345").value).toBe("+919825012345");
  });
  it("calls blanks nothing and bad numbers a problem", () => {
    for (const s of ["", "N/A", "none", "-", null, undefined]) expect(normalizePhone(s)).toEqual({ value: null, problem: null });
    for (const s of ["555-0142", "000-000-0000", "111-111-1111", "123", "713-155-0142", "abc"]) expect(normalizePhone(s).problem, s).toBe("phone");
  });
  it("splits a cell with two numbers", () => {
    expect(normalizePhones("713-555-0142 / 281-555-0199").values).toEqual(["+17135550142", "+12815550199"]);
    expect(normalizePhones("713-555-0142; 713-555-0142").values).toEqual(["+17135550142"]);
  });
  it("property: any formatting of a valid number gives the same E.164", () => {
    const rand = rng(21);
    for (let i = 0; i < 200; i++) {
      const area = 200 + Math.floor(rand() * 790);
      const ex = 200 + Math.floor(rand() * 790);
      const line = Math.floor(rand() * 10000);
      const a = String(area);
      const e = String(ex);
      const l = String(line).padStart(4, "0");
      if (/^(\d)\1+$/.test(a + e + l)) continue;
      const want = `+1${a}${e}${l}`;
      for (const f of [`(${a}) ${e}-${l}`, `${a}-${e}-${l}`, `${a}.${e}.${l}`, `${a}${e}${l}`, `1 ${a} ${e} ${l}`, `+1 (${a}) ${e}-${l}`]) {
        expect(normalizePhone(f).value, f).toBe(want);
      }
    }
  });
});

describe("e-mails", () => {
  it("lowercases and folds Gmail dots and plus-tags only", () => {
    expect(normalizeEmails("Malav.Sanghvi+jsh@Gmail.com").keys).toEqual(["malavsanghvi@gmail.com"]);
    expect(normalizeEmails("malavsanghvi@googlemail.com").keys).toEqual(["malavsanghvi@gmail.com"]);
    expect(normalizeEmails("A.B@corp.com").keys).toEqual(["a.b@corp.com"]);
    expect(normalizeEmails("a+x@corp.com").keys).toEqual(["a+x@corp.com"]);
  });
  it("strips brackets and mailto, and splits several addresses", () => {
    expect(normalizeEmails("<Rahul@Example.com>").keys).toEqual(["rahul@example.com"]);
    expect(normalizeEmails("mailto:rahul@example.com").keys).toEqual(["rahul@example.com"]);
    expect(normalizeEmails("a@x.com; b@y.com, A@X.com").keys).toEqual(["a@x.com", "b@y.com"]);
  });
  it("reports unreadable addresses and ignores blanks", () => {
    expect(normalizeEmails("not an email").problems.length).toBeGreaterThan(0);
    expect(normalizeEmails("")).toEqual({ keys: [], problems: [] });
    expect(normalizeEmails("N/A")).toEqual({ keys: [], problems: [] });
  });
});

describe("addresses", () => {
  const key = (line1: string, extra: Record<string, string> = {}) => normalizeAddress({ line1, ...extra })?.streetKey;
  it("treats street words, directions, punctuation and case alike", () => {
    const want = "12|lotus";
    for (const s of ["12 Lotus Lane", "12 lotus ln", "12 LOTUS LN.", "12 N. Lotus Lane", "12 North Lotus Ln", "12 Lotus Ln N", "12 Lotus Lane, Apt 4", "12 Lotus Ln #4", "12 Lotus Lane apartment 4B"]) {
      expect(key(s), s).toBe(want);
    }
  });
  it("pulls the unit out of line 1 or line 2", () => {
    expect(normalizeAddress({ line1: "12 Lotus Lane #4" })?.unit).toBe("4");
    expect(normalizeAddress({ line1: "12 Lotus Ln, Apt 4B" })?.unit).toBe("4b");
    expect(normalizeAddress({ line1: "12 Lotus Ln", line2: "Suite 200" })?.unit).toBe("200");
    expect(normalizeAddress({ line1: "12 Lotus Ln", line2: "#7" })?.unit).toBe("7");
    expect(normalizeAddress({ line1: "12 Lotus Ln 4" })?.unit).toBe("4");
    expect(normalizeAddress({ line1: "12 Lotus Ln", line2: "c/o John" })?.unit).toBeNull();
  });
  it("reads directions, suffixes and ordinals", () => {
    const a = normalizeAddress({ line1: "1600 Pennsylvania Ave NW" })!;
    expect([a.street, a.suffix, a.postdir]).toEqual(["pennsylvania", "ave", "nw"]);
    const b = normalizeAddress({ line1: "100 Fifth Street" })!;
    expect(b.street).toBe("5th");
    expect(normalizeAddress({ line1: "100 5th St" })?.streetKey).toBe(b.streetKey);
    const c = normalizeAddress({ line1: "12 East Ave" })!;
    expect([c.predir, c.street, c.suffix]).toEqual([null, "east", "ave"]);
  });
  it("handles ZIP+4, a lost leading zero and ZIP inside a state field", () => {
    expect(normalizeAddress({ line1: "12 Lotus Ln", zip: "77478-1234" })).toMatchObject({ zip5: "77478", zip4: "1234" });
    expect(normalizeAddress({ line1: "12 Lotus Ln", zip: "774781234" })).toMatchObject({ zip5: "77478", zip4: "1234" });
    expect(normalizeAddress({ line1: "12 Lotus Ln", zip: "77478 1234" })).toMatchObject({ zip5: "77478", zip4: "1234" });
    expect(normalizeAddress({ line1: "12 Lotus Ln", zip: "2134" })?.zip5).toBe("02134");
    expect(normalizeAddress({ line1: "12 Lotus Ln", zip: "TX 77478" })?.zip5).toBe("77478");
  });
  it("reads a PO box and returns null for nothing", () => {
    const po = normalizeAddress({ line1: "P.O. Box 77", zip: "77478" })!;
    expect([po.poBox, po.number]).toEqual([true, "77"]);
    expect(normalizeAddress({ line1: "PO Box 77" })?.poBox).toBe(true);
    expect(normalizeAddress({ line1: "" })).toBeNull();
    expect(normalizeAddress({ line1: "n/a" })).toBeNull();
  });
});

describe("dates", () => {
  it("reads unambiguous dates however they are written", () => {
    for (const s of ["1987-04-13", "1987/4/13", "13/04/1987", "04/13/1987", "13 Apr 1987", "Apr 13, 1987", "April 13th 1987", "13-Apr-87", "19870413"]) {
      expect(date(s).iso, s).toBe("1987-04-13");
    }
  });
  it("flags day/month ambiguity instead of guessing", () => {
    const d = date("03/04/1987");
    expect(d.iso).toBeNull();
    expect(d.ambiguous).toBe(true);
    expect(d.alternatives).toEqual(["1987-03-04", "1987-04-03"]);
    expect(date("05/05/1987").iso).toBe("1987-05-05"); // both readings agree
  });
  it("uses the file's order once it is known", () => {
    expect(date("03/04/1987", "mdy").iso).toBe("1987-03-04");
    expect(date("03/04/1987", "dmy").iso).toBe("1987-04-03");
    expect(date("13/04/1987", "mdy").iso).toBe("1987-04-13"); // 13 cannot be a month
  });
  it("reads two-digit years against today, and keeps both centuries when both are possible for a birth date", () => {
    expect(date("04/13/87").iso).toBe("1987-04-13");
    expect(date("04/13/55").iso).toBe("1955-04-13");
    expect(date("04/13/15").iso).toBe("2015-04-13");
    const twenty = date("04/13/20");
    expect(twenty.alternatives).toEqual(["1920-04-13", "2020-04-13"]);
    expect(twenty.twoDigitYear).toBe(true);
    expect(date("04/13/98", "mdy", "event").iso).toBe("1998-04-13");
    expect(date("04/13/26", "mdy", "event").iso).toBe("2026-04-13");
  });
  it("rejects impossible dates and reads Excel serials", () => {
    expect(date("31/04/1987").problem).toBe("unreadable");
    expect(date("2/30/1987", "mdy").problem).toBe("unreadable");
    expect(date("not a date").problem).toBe("unreadable");
    expect(date("").problem).toBe("blank");
    expect(date(31778).iso).toBe("1987-01-01");
    expect(date(new Date(Date.UTC(1987, 3, 13))).iso).toBe("1987-04-13");
  });
  it("property: every valid y-m-d written as m/d/y or d/m/y gives that date back (or flags it)", () => {
    const rand = rng(33);
    for (let i = 0; i < 300; i++) {
      const y = 1930 + Math.floor(rand() * 90);
      const m = 1 + Math.floor(rand() * 12);
      const d = 1 + Math.floor(rand() * 28);
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const mdy = `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
      const dmy = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
      const a = date(mdy);
      const b = date(dmy);
      for (const r of [a, b]) {
        if (r.ambiguous) expect(r.alternatives, `${mdy} / ${dmy}`).toContain(iso);
        else expect(r.iso).toBe(iso);
      }
      expect(date(mdy, "mdy").iso).toBe(iso);
      expect(date(dmy, "dmy").iso).toBe(iso);
      expect(date(iso).iso).toBe(iso);
    }
  });
});

describe("money, IDs and references", () => {
  it("turns money into integer cents and flags what a person must see", () => {
    expect(normalizeMoney("$1,250.00")).toEqual({ cents: 125000, problem: null });
    expect(normalizeMoney("1250")).toEqual({ cents: 125000, problem: null });
    expect(normalizeMoney(51.1)).toEqual({ cents: 5110, problem: null });
    expect(normalizeMoney("(50.00)")).toEqual({ cents: -5000, problem: "negative" });
    expect(normalizeMoney("0")).toEqual({ cents: 0, problem: "zero" });
    expect(normalizeMoney("12.345").problem).toBe("unreadable");
    expect(normalizeMoney("a lot").problem).toBe("unreadable");
    expect(normalizeMoney("")).toEqual({ cents: null, problem: "blank" });
    expect(normalizeMoney(null).problem).toBe("blank");
  });
  it("property: dollars and cents round-trip through text", () => {
    const rand = rng(44);
    for (let i = 0; i < 300; i++) {
      const cents = 1 + Math.floor(rand() * 5_000_000);
      const dollars = Math.floor(cents / 100);
      const rest = String(cents % 100).padStart(2, "0");
      const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      expect(normalizeMoney(`$${grouped}.${rest}`).cents).toBe(cents);
      expect(normalizeMoney(`${dollars}.${rest}`).cents).toBe(cents);
    }
  });
  it("compares IDs without case, spaces, dashes or leading zeros", () => {
    expect(normalizeIdValue("F-1042")).toBe(normalizeIdValue("f1042"));
    expect(normalizeIdValue("0417")).toBe(normalizeIdValue("417"));
    expect(normalizeIdValue("N/A")).toBeNull();
    expect(normalizeIdValue("")).toBeNull();
  });
  it("reads check numbers", () => {
    expect(normalizeRef("Check #4512")).toBe("4512");
    expect(normalizeRef("004512")).toBe("4512");
    expect(normalizeRef("")).toBeNull();
  });
});

describe("one record", () => {
  const base = { id: "r1", source: "dir.xlsx", sourceKind: "spreadsheet" as const, row: 1, kind: "person" as const };
  it("normalises every field and builds a stable fingerprint", () => {
    const r = normalizeRecord(
      { ...base, name: "Shah, Rahulbhai", mobile: "(713) 555-0142", email: "Rahul.Shah+temple@Gmail.com", address1: "12 Lotus Lane #4", zip: "77478-0001", dob: "04/13/1987", ids: { family: "F-0042" } },
      0,
      cfg,
    );
    expect(r.name.people[0]).toMatchObject({ given: "rahul", surname: "shah" });
    expect(r.phones).toEqual([{ value: "+17135550142", mobile: true }]);
    expect(r.emails).toEqual(["rahulshah@gmail.com"]);
    expect(r.address).toMatchObject({ streetKey: "12|lotus", unit: "4", zip5: "77478" });
    expect(r.dob?.iso).toBe("1987-04-13");
    expect(r.ids).toEqual({ family: "f0042" });
    expect(r.minor.isMinor).toBe(false);
    const again = normalizeRecord({ ...base, id: "other", row: 99, name: "Rahul Shah", phone: "7135550142", email: "rahulshah@gmail.com", address1: "12 Lotus Ln Apt 4", zip: "77478", dob: "1987-04-13", ids: { family: "F0042" } }, 5, cfg);
    expect(again.fingerprint).toBe(r.fingerprint);
  });
  it("marks anyone who may be under 18, on every signal and on every reading of an ambiguous date", () => {
    const minor = (extra: object) => normalizeRecord({ ...base, name: "Zoya Shah", ...extra }, 0, cfg).minor;
    expect(minor({ isChild: true }).reasons).toContain("flag");
    expect(minor({ age: 11 }).reasons).toContain("age");
    expect(minor({ dob: "2014-05-03" }).reasons).toContain("birth_date");
    expect(minor({ dob: "03/04/2009" }).isMinor).toBe(true); // both readings are under 18
    expect(minor({ dob: "11/10/2008" }).isMinor).toBe(true); // 10 Nov 2008 is 17, 11 Oct 2008 is 18: one reading is a minor, so hold
    expect(minor({ dob: "03/04/2008" }).isMinor).toBe(false); // both readings are 18
    expect(minor({ role: "Daughter" }).reasons).toContain("role");
    expect(minor({ grade: "Grade 5" }).reasons).toContain("school_or_grade");
    expect(minor({ school: "Lotus Elementary" }).reasons).toContain("school_or_grade");
    expect(minor({ dob: "1985-02-01" }).isMinor).toBe(false);
    expect(minor({ age: 40, role: "Spouse" }).isMinor).toBe(false);
    expect(normalizeRecord({ ...base, name: "Master Arjun Shah" }, 0, cfg).minor.reasons).toContain("title");
  });
  it("flags a record whose kind cannot be trusted", () => {
    expect(normalizeRecord({ ...base, kind: "unknown" }, 0, cfg).typeUncertain).toBe(true);
    expect(normalizeRecord({ ...base, kind: "gift" }, 0, cfg).typeUncertain).toBe(true);
    expect(normalizeRecord({ ...base, kind: "person", gift: { amount: "10", date: "2026-01-01" } }, 0, cfg).typeUncertain).toBe(true);
    expect(normalizeRecord({ ...base, kind: "gift", gift: { amount: "10", date: "2026-01-01" } }, 0, cfg).typeUncertain).toBe(false);
  });
});
