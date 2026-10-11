import { describe, expect, it } from "vitest";

import { compareNames } from "@/lib/onboarding/resolve/link";
import { makeConfig } from "@/lib/onboarding/resolve/config";
import { foldAscii, normalizeAddress, normalizeName, normalizePhone, normalizePhones, parseDate, phoneticKey, stripAttachedSuffix } from "@/lib/onboarding/resolve/normalize";
import { parsePostal } from "@/lib/onboarding/intl/postal";
import { splitFullName } from "@/lib/onboarding/resolve/names";
import { parseName } from "@/lib/onboarding/normalize";
import { givenEquivalentId, nicknameCanonical, spellingCanonical, surnameEquivalentId } from "@/lib/onboarding/intl/name-variants";
import { rec, run, pairOf } from "./fixtures/onboarding-resolve/helpers";

const cfg = makeConfig("2026-10-11", { country: "US" });
const one = (full: string) => normalizeName({ full }).people[0]!;
const level = (a: string, b: string) => compareNames(normalizeName({ full: a }), normalizeName({ full: b }), cfg);

describe("folding: letters of every script are kept, accents are not meaningful", () => {
  it("spells out the Latin letters that are not accents (o-slash, l-stroke, d-stroke, sharp s)", () => {
    expect(foldAscii("Søren Łukasz Đorđe Straße")).toBe("Soren Lukasz Dorde Strasse");
    expect(one("Søren Kierkegaard").given).toBe("soren");
    expect(one("Łukasz Nowak").given).toBe("lukasz");
    const d = one("Đorđe Petrović");
    expect([d.given, d.surname]).toEqual(["dorde", "petrovic"]);
  });
  it("compares an accented and an unaccented spelling as the same name", () => {
    for (const [a, b] of [["José García", "Jose Garcia"], ["Søren Hansen", "Soren Hansen"], ["Nguyễn Văn An", "Nguyen Van An"], ["Müller, Zoë", "Muller, Zoe"], ["Dvořák Petr", "Dvorak Petr"]] as const) {
      const na = normalizeName({ full: a });
      const nb = normalizeName({ full: b });
      expect(na.people.map((p) => [p.givenKey, p.surnameKey]), `${a} / ${b}`).toEqual(nb.people.map((p) => [p.givenKey, p.surnameKey]));
    }
  });
  it("Mueller and Muller, Hernandez and Hernandes, Dmitriy and Dmitri share a key", () => {
    expect(phoneticKey("Mueller")).toBe(phoneticKey("Müller"));
    expect(phoneticKey("Hernández")).toBe(phoneticKey("Hernandes"));
    expect(phoneticKey("Dmitriy")).toBe(phoneticKey("Dmitri"));
  });
  it("never drops a name in another script: it is kept and compared as written", () => {
    for (const [text, given, surname] of [
      ["રાહુલ શાહ", "રાહુલ", "શાહ"],
      ["Иван Петров", "иван", "петров"],
      ["Ιωάννης Παπαδόπουλος", "ιωαννησ", "παπαδοπουλοσ"],
      ["דוד כהן", "דוד", "כהנ"], // the final nun is the same letter as the ordinary one
    ] as const) {
      const n = normalizeName({ full: text });
      expect(n.missing, text).toBe(false);
      expect(n.nonLatin, text).toBe(true);
      expect([n.people[0]!.given, n.people[0]!.surname], text).toEqual([given, surname]);
    }
    // Chinese and Korean names written without a space: the family name comes first.
    const zh = one("王伟");
    expect([zh.given, zh.initial, zh.surname]).toEqual(["伟", "伟", "王"]);
    const ko = one("김민준");
    expect([ko.given, ko.surname]).toEqual(["민준", "김"]);
    const zh2 = one("欧阳明");
    expect(zh2.surname).toBe("欧阳");
  });
  it("two names in one script agree; a name in one script says nothing about a name in another", () => {
    expect(level("Иван Петров", "Иван Петров").level).toBe("match");
    expect(level("Иван Петров", "Ivan Petrov").level).toBe("unknown");
    expect(level("محمد الفارسي", "Mohammed Al-Farsi").level).toBe("unknown");
    expect(level("રાહુલ શાહ", "રાહુલ શાહ").level).toBe("match");
    expect(level("王伟", "王伟").level).toBe("match");
  });
  it("reads an Arabic name with or without vowel marks and the alternative forms of the same letter", () => {
    expect(one("مُحَمَّد").given).toBe(one("محمد").given);
    expect(one("أحمد").given).toBe(one("احمد").given);
  });
});

describe("titles, family words and relationship words of many cultures", () => {
  const givenSurname = (s: string) => {
    const p = one(s);
    return [p.given, p.surname];
  };
  it("drops honorifics in English, Spanish, Portuguese, French, German, Italian, Arabic, South Asian and Hebrew names", () => {
    for (const [text, want] of [
      ["Sra. Ana Pérez", ["ana", "perez"]],
      ["Sr. Juan Pérez", ["juan", "perez"]],
      ["Herr Hans Müller", ["hans", "muller"]],
      ["Frau Anna Schmidt", ["anna", "schmidt"]],
      ["Mme Marie Dubois", ["marie", "dubois"]],
      ["Monsieur Pierre Martin", ["pierre", "martin"]],
      ["Sig. Marco Rossi", ["marco", "rossi"]],
      ["Dott. Luca Bianchi", ["luca", "bianchi"]],
      ["Sheikh Ahmed Hassan", ["ahmed", "hassan"]],
      ["Haji Abdul Karim Khan", ["abdul karim", "khan"]],
      ["Rabbi David Cohen", ["david", "cohen"]],
      ["Smt. Mira Patel", ["mira", "patel"]],
      ["Prof. Dr. Wei Zhang", ["wei", "zhang"]],
      ["Capt. John Smith", ["john", "smith"]],
    ] as const) {
      expect(givenSurname(text), text).toEqual(want);
    }
  });
  it("keeps a word that is also a surname or a given name when it stands in a name", () => {
    expect(givenSurname("John Herr")).toEqual(["john", "herr"]);
    expect(givenSurname("Don Smith")).toEqual(["don", "smith"]);
    expect(givenSurname("Rav Moshe Cohen")).toEqual(["moshe", "cohen"]);
    expect(givenSurname("Min Sheikh")).toEqual(["min", "sheikh"]);
    expect(givenSurname("Sheikh")).toEqual(["sheikh", null]); // a title with nothing after it is all there is
  });
  it("reads a household word of any language as 'this is a family name'", () => {
    for (const text of ["Familia García", "Famille Dubois", "Familie Müller", "Famiglia Rossi", "Rodzina Nowak", "Shah Parivar", "Nowak family"]) {
      const p = normalizeName({ full: text }).people[0]!;
      expect(p.given, text).toBeNull();
      expect(p.surnameKey, text).not.toBeNull();
    }
  });
  it("does not take a relationship word in brackets for a maiden name, in any language", () => {
    for (const text of ["Ana García (esposa)", "Marta Silva (mae)", "Marie Dubois (epouse)", "Anna Müller (Ehefrau)", "Layla Haddad (zawja)", "Mira Patel (patni)", "Dan Cohen (isha)", "Aiko Tanaka (tsuma)", "Soo-ah Kim (eomma)", "Mei Zhang (qizi)"]) {
      expect(normalizeName({ full: text }).people[0]!.maidenKey, text).toBeNull();
    }
    expect(one("Mira Patel (Shah)").maidenKey).toBe(phoneticKey("Shah"));
    expect(one("Maria Smith geb. Müller").maidenKey).toBe(phoneticKey("Müller"));
    expect(one("Anna Kowalska z domu Nowak").maidenKey).toBe(phoneticKey("Nowak"));
  });
  it("Jr, Sr and their equivalents, and Spanish 'Sr.' as a title", () => {
    expect(one("Juan Pérez Jr.").generation).toBe("jr");
    expect(one("Pierre Dupont fils").generation).toBe("jr");
    expect(one("John Smith Sr").generation).toBe("sr");
    expect(one("Sr. Juan García").surname).toBe("garcia");
    expect(one("Sr. Juan García").generation).toBeNull();
  });
});

describe("suffixes are removed only when they stand apart, never inside a word", () => {
  it("leaves Kenji, Reuben, Shinji and the like alone", () => {
    expect(one("Kenji Tanaka").given).toBe("kenji");
    expect(one("Reuben Cohen").given).toBe("reuben");
    expect(one("Reuben Patel").given).toBe("reuben");
    expect(one("Shinji Ito").given).toBe("shinji");
    expect(one("Yuji Sato").given).toBe("yuji");
    expect(stripAttachedSuffix("kenji", false)).toBe("kenji");
    expect(stripAttachedSuffix("reuben", false)).toBe("reuben");
  });
  it("keeps a Korean 'ji' (Min Ji, Min-ji, Eun Ji) and a Hebrew 'Ben'", () => {
    expect(one("Min Ji Kim").middles).toEqual(["ji"]);
    expect(one("Min-ji Kim").given).toBe("min-ji");
    expect(one("Eun Ji Lee").middles).toEqual(["ji"]);
    expect(one("David Ben Gurion").surname).toBe("ben gurion");
    expect(one("David Ben-Gurion").surname).toBe("ben gurion");
  });
  it("still removes -bhai, -ben, -ji and -kumar from South Asian names, as separate words, with a hyphen, or attached to such a name", () => {
    for (const text of ["Rahulbhai Shah", "Rahul Bhai Shah", "Rahul-bhai Shah", "Rahulbhai Patel"]) expect(one(text).given, text).toBe("rahul");
    for (const text of ["Miraben Patel", "Mira Ben Patel", "Mira-ben Patel"]) expect(one(text).given, text).toBe("mira");
    for (const text of ["Hasmukhji Doshi", "Hasmukh Ji Doshi", "Hasmukh-ji Doshi"]) expect(one(text).given, text).toBe("hasmukh");
    expect(one("Ashokkumar Mehta").given).toBe("ashok");
    // Kumar between the names is an honorific, so the two spellings agree.
    expect(one("Ashok Kumar Mehta").middleKeys).toEqual([]);
    expect(level("Ashok Kumar Mehta", "Ashokkumar Mehta").level).toBe("match");
    // Kumar as a family name stays.
    expect(one("Rajesh Kumar").surname).toBe("kumar");
    // -bhai is an honorific anywhere; -ben needs the South Asian context of the name.
    expect(one("Rahulbhai").given).toBe("rahul");
    expect(one("Miraben").given).toBe("miraben");
    expect(one("Tanaka-san Hiroshi").givenKey).not.toBeNull();
    expect(one("Hiroshi Tanaka-san").surname).toBe("tanaka");
  });
});

describe("particles belong to the family name and are never a maiden name", () => {
  it("al-, el-, bin, ibn, bint, van, von, de, da, di, du, la, le, mac, mc", () => {
    const fam = (text: string) => {
      const p = one(text);
      return [p.surname, p.surnameParts.length, p.maidenKey];
    };
    expect(fam("Ahmed Al-Farsi")).toEqual(["al farsi", 1, null]);
    expect(fam("Ahmed Al Farsi")).toEqual(["al farsi", 1, null]);
    expect(fam("Ahmed El-Sayed")).toEqual(["el sayed", 1, null]);
    expect(fam("Maria de la Cruz")).toEqual(["de la cruz", 1, null]);
    expect(fam("Jan van der Berg")).toEqual(["van der berg", 1, null]);
    expect(fam("Ludwig von Beethoven")).toEqual(["von beethoven", 1, null]);
    expect(fam("Marco Di Maria")).toEqual(["di maria", 1, null]);
    expect(fam("Pierre Le Roux")).toEqual(["le roux", 1, null]);
    expect(fam("Marie Du Pont")).toEqual(["du pont", 1, null]);
    expect(fam("Ahmed bin Rashid al-Maktoum")).toEqual(["al maktoum", 1, null]);
    expect(fam("Aisha Ibn-Saud")).toEqual(["ibn saud", 1, null]);
    expect(fam("Ian Mac Donald")).toEqual(["mac donald", 1, null]);
    expect(fam("Ian Mc Donald")).toEqual(["mc donald", 1, null]);
  });
  it("a family name written with or without the particle, the hyphen or the space is one key", () => {
    const key = (s: string) => one(`Ahmed ${s}`).surnameKey;
    expect(new Set(["Al-Farsi", "Al Farsi", "Alfarsi", "El-Farsi", "AlFarsi", "al-Farsi"].map(key)).size).toBe(1);
    expect(one("Ian McDonald").surnameKey).toBe(one("Ian MacDonald").surnameKey);
    expect(one("Ian Mc Donald").surnameKey).toBe(one("Ian MacDonald").surnameKey);
    expect(one("Ana de la Cruz").surnameKey).toBe(one("Ana De La Cruz").surnameKey);
    expect(one("Ana de la Cruz").surnameKey).toBe(one("Ana Delacruz").surnameKey);
    expect(one("Sean O'Brien").surnameKey).toBe(one("Sean OBrien").surnameKey);
    expect(one("Ahmed ar-Rahman").surnameKey).toBe(one("Ahmed Al-Rahman").surnameKey);
  });
  it("two families that only share 'al-' are different families (the old code called them one family under a maiden name)", () => {
    const c = level("Ahmed Al-Farsi", "Omar Al-Hassan");
    expect(c.surname).toBe("differ");
    expect(c.level).not.toBe("maiden");
    expect(c.level).not.toBe("match");
    expect(level("Fatima Van Berg", "Fatima Van Dijk").level).not.toBe("maiden");
    expect(level("Maria De la Cruz", "Maria De Silva").level).not.toBe("maiden");
    // a real double name is still explained by either half
    expect(level("Mira Shah-Patel", "Mira Shah").level).toBe("maiden");
    expect(level("Mira Shah-Patel", "Mira Patel").level).toBe("match");
  });
  it("two records that share only the 'al-' of their family names do not link, with any one identifier", () => {
    const a = rec({ name: "Ahmed Al-Farsi", email: "a@x.example", address1: "5 Oak St", zip: "77478" });
    const b = rec({ name: "Omar Al-Hassan", email: "a@x.example", address1: "9 Elm St", zip: "77478" });
    const pair = pairOf(run([a, b]), a.id, b.id);
    expect(pair?.nameLevel).not.toBe("maiden");
    expect(pair?.relation).toBe("same_household");
  });
  it("the particle is glued in a name typed in one box for storing", () => {
    expect(splitFullName("Maria de la Cruz")).toEqual({ first: "Maria", last: "de la Cruz" });
    expect(splitFullName("Jan van der Berg")).toEqual({ first: "Jan", last: "van der Berg" });
    expect(splitFullName("Ahmed bin Rashid al-Maktoum")).toEqual({ first: "Ahmed bin Rashid", last: "al-Maktoum" });
    expect(splitFullName("Rahul K. Shah")).toEqual({ first: "Rahul K.", last: "Shah" });
    expect(splitFullName("Tran Van Nam")).toEqual({ first: "Tran Van", last: "Nam" });
    expect(splitFullName("García López, María")).toEqual({ last: "García López", first: "María" });
  });
});

describe("spelling variants, nicknames and translations", () => {
  const same = (...names: string[]) => {
    const keys = new Set(names.map((n) => normalizeName({ full: `${n} Khan` }).people[0]!.givenKey));
    expect([...keys], names.join(" / ")).toHaveLength(1);
  };
  it("Muhammad, Mohammed, Mohamed, Muhammed and Mohd are one name; so are Ahmed and Ahmad, Hussein and Hussain, Yusuf and Youssef", () => {
    same("Muhammad", "Mohammed", "Mohamed", "Muhammed", "Mohammad", "Mohd");
    same("Ahmed", "Ahmad");
    same("Hussein", "Hussain", "Husain");
    same("Yusuf", "Youssef", "Yousef");
    same("Fatima", "Fatimah", "Fatema");
    same("Aisha", "Ayesha", "Aysha");
    same("Sergey", "Sergei", "Sergej");
    same("Alexander", "Aleksandr", "Oleksandr");
    same("Dmitri", "Dmitry", "Dmitriy");
    same("Katherine", "Catherine", "Kathryn");
    same("Abdul Rahman", "Abdulrahman", "Abdurrahman", "Abd al-Rahman", "Abdelrahman");
    same("Abdullah", "Abdallah", "Abdulla");
  });
  it("different names stay different", () => {
    for (const [a, b] of [["Omar", "Ali"], ["Hasan", "Hussein"], ["Yusuf", "Ibrahim"], ["Sergey", "Dmitri"], ["Mohammed", "Ahmed"]] as const) {
      expect(normalizeName({ full: `${a} Khan` }).people[0]!.givenKey, `${a} / ${b}`).not.toBe(normalizeName({ full: `${b} Khan` }).people[0]!.givenKey);
    }
  });
  it("a spelling variant matches as the same name; a translation is only a weak signal", () => {
    expect(level("Mohammed Khan", "Muhammad Khan").level).toBe("match");
    expect(level("Yusuf Haddad", "Joseph Haddad").level).toBe("weak");
    expect(level("Juan Lopez", "John Lopez").level).toBe("weak");
    expect(level("Pepe Garcia", "José Garcia").level).toBe("match");
    expect(level("Sasha Ivanov", "Alexander Ivanov").level).toBe("match");
    expect(level("Paco Ruiz", "Francisco Ruiz").level).toBe("match");
    expect(level("Gianni Rossi", "Giovanni Rossi").level).toBe("match");
    expect(level("Zhang Wei", "Cheung Wei").level).toBe("weak");
    expect(level("Kim Min-jun", "Gim Min-jun").level).toBe("weak");
    expect(level("Sato Ken", "Satoh Ken").level).toBe("match");
  });
  it("the tables answer for single words", () => {
    expect(spellingCanonical("mohammed")).toBe("muhammad");
    expect(nicknameCanonical("pepe")).toBe("jose");
    expect(givenEquivalentId("yusuf")).toBe(givenEquivalentId("joseph"));
    expect(givenEquivalentId("jose")).toBe(givenEquivalentId("yusuf"));
    expect(givenEquivalentId("omar")).toBeNull();
    expect(surnameEquivalentId("cheung")).toBe(surnameEquivalentId("zhang"));
    expect(surnameEquivalentId("lee")).toBe(surnameEquivalentId("yi"));
    expect(surnameEquivalentId("smith")).not.toBe(surnameEquivalentId("jones"));
  });
  it("a variant or a translation never joins two records on its own", () => {
    const a = rec({ name: "Yusuf Haddad" });
    const b = rec({ name: "Joseph Haddad" });
    expect(pairOf(run([a, b]), a.id, b.id)).toBeUndefined();
    const c = rec({ name: "Mohammed Khan" });
    const d = rec({ name: "Muhammad Khan" });
    const p = pairOf(run([c, d]), c.id, d.id);
    // The same name alone is at most a question; it is never an automatic link.
    expect(p === undefined || (p.tier !== "A" && p.nameOnly)).toBe(true);
  });
});

describe("which word is the family name", () => {
  it("uses the family and given name columns exactly as they are", () => {
    const zh = normalizeName({ first: "Wei", last: "Zhang" }).people[0]!;
    expect([zh.given, zh.surname]).toEqual(["wei", "zhang"]);
    const es = normalizeName({ first: "María José", last: "García López" }).people[0]!;
    expect(es.surname).toBe("garcia-lopez");
    expect(es.surnameParts).toHaveLength(2);
    expect(es.given).toBe("maria");
    expect(es.middles).toEqual(["jose"]);
    const vi = normalizeName({ first: "Van An", last: "Nguyen" }).people[0]!;
    expect([vi.given, vi.surname]).toEqual(["van", "nguyen"]);
    // A name column that only repeats the two columns changes nothing; Jr from the name column is kept.
    const both = normalizeName({ full: "Wei Zhang Jr.", first: "Wei", last: "Zhang" }).people[0]!;
    expect([both.given, both.surname, both.generation]).toEqual(["wei", "zhang", "jr"]);
    const flipped = normalizeName({ full: "Zhang Wei", first: "Wei", last: "Zhang" }).people[0]!;
    expect([flipped.given, flipped.surname]).toEqual(["wei", "zhang"]);
  });
  it("without columns the last word is the family name and the other readings are kept as weak alternatives", () => {
    const p = one("Maria Garcia Lopez");
    expect(p.surname).toBe("lopez");
    const alts = p.alts.map((a) => `${a.givenKey}/${a.surnameKey}`);
    expect(alts).toContain(`${p.givenKey}/${phoneticKey("Garcia")}`); // the paternal surname alone
    expect(alts).toContain(`${p.givenKey}/${phoneticKey("GarciaLopez")}`); // the double surname
    expect(alts).toContain(`${phoneticKey("Lopez")}/${p.givenKey}`); // family name first
  });
  it("a double surname's halves, family-name-first order and Vietnamese order are weak matches, not matches", () => {
    expect(level("Maria Garcia Lopez", "Maria Garcia").level).toBe("weak");
    expect(level("Maria Garcia Lopez", "Maria Lopez").level).toBe("match");
    expect(level("Wang Wei", "Wei Wang").level).toBe("weak");
    expect(level("Kim Min-jun", "Min-jun Kim").level).toBe("weak");
    expect(level("Nguyen Van An", "An Nguyen").level).toBe("weak");
    expect(level("Nguyen Van An", "Nguyen Van An").level).toBe("match");
    expect(level("Garcia Lopez, Maria", "Maria Garcia").level).toBe("maiden");
    expect(level("Rahul Shah", "Mira Shah").level).toBe("surname_only");
    expect(level("Anna Maria", "Peter Smith").level).toBe("different");
  });
  it("brackets: after the name it is a maiden name, between the names a nickname, in another script a native spelling", () => {
    expect(one("Mira Patel (Shah)").maidenKey).toBe(phoneticKey("Shah"));
    const nick = one("Robert (Bob) Smith");
    expect([nick.given, nick.maidenKey]).toEqual(["robert", null]);
    const native = one("Wei Zhang (张伟)");
    expect(native.alts.some((a) => a.surnameKey === "张")).toBe(true);
    // the native spelling in brackets is a weak way to recognise the same person written only in that script
    expect(level("Wei Zhang (张伟)", "张伟").level).toBe("weak");
  });
  it("splits several people, joined by &, 'and', 'und', 'et', 'y'", () => {
    for (const text of ["Juan y María García", "Hans und Anna Müller", "Jean et Marie Dubois", "Rahul & Mira Shah", "Rahul and Mira Shah"]) {
      expect(normalizeName({ full: text }).people, text).toHaveLength(2);
    }
    // A middle initial is not a joiner.
    expect(normalizeName({ full: "John E Smith" }).people).toHaveLength(1);
    expect(normalizeName({ full: "John Y Smith" }).people).toHaveLength(1);
  });
});

describe("the older matcher reads names the same way", () => {
  it("parseName: particles are part of the family name, nicknames and variants fold, columns win", () => {
    expect(parseName("Maria de la Cruz")).toEqual({ surname: "delacruz", givens: ["maria"] });
    expect(parseName("Ahmed Al-Farsi")).toEqual({ surname: "alfarsi", givens: ["ahmed"] });
    expect(parseName("Pepe Garcia")).toEqual({ surname: "garcia", givens: ["jose"] });
    expect(parseName("Mohammed Khan").givens).toEqual(parseName("Muhammad Khan").givens);
    expect(parseName("Herr Hans Müller")).toEqual({ surname: "muller", givens: ["hans"] });
    expect(parseName("x", { first: "María", last: "García López" }).surname).toBe("garcia-lopez");
    expect(parseName("Shah")).toEqual({ surname: "shah", givens: [] });
  });
});

describe("odd and hostile text is just text", () => {
  it("a name, street or word called constructor, toString or __proto__ is an ordinary word", () => {
    for (const w of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      const p = one(`${w} Smith`);
      expect(p.given, w).toBe(w.toLowerCase().replace(/[^a-z]/g, ""));
      expect(p.surname).toBe("smith");
      expect(p.generation).toBeNull();
      expect(parseName(`${w} Smith`).surname).toBe("smith");
      const a = normalizeAddress({ line1: `12 ${w} Street`, zip: "77478" });
      expect(a?.street).toBe(w.toLowerCase());
      expect(a?.suffix).toBe("st");
      expect(normalizeAddress({ line1: `12 Lotus ${w}`, zip: "77478" })?.suffix).toBeNull();
    }
  });
  it("random text of every script, punctuation and spacing never throws and always gives the same answer", () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ ,.&+()\"'-/#0123456789éñüøłđßÅÇ中王伟김민준Иван Петровمحمد الفارسيרדוड़રાહુલ\u0301\u200d\t";
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 1500; i++) {
      let text = "";
      for (let k = Math.floor(rand() * 40); k > 0; k--) text += alphabet[Math.floor(rand() * alphabet.length)];
      const a = normalizeName({ full: text });
      const b = normalizeName({ full: text });
      expect(b, text).toEqual(a);
      normalizeName({ first: text, last: text.slice(3) });
      parseName(text);
      normalizePhone(text, "IN");
      normalizePhones(text);
      normalizeAddress({ line1: text, line2: text, zip: text, city: text, state: text, country: text }, { country: "DE" });
      parseDate(text, { order: "unknown", today: "2026-10-11", context: "birth" });
      parsePostal(text);
      splitFullName(text);
    }
  });
  it("a name of 50,000 characters is read in a moment", () => {
    const long = Array.from({ length: 8000 }, (_, i) => `Name${"abcdefgh"[i % 8]}`).join(" ");
    const t0 = Date.now();
    normalizeName({ full: long });
    normalizeName({ full: `Shah, ${long}` });
    parseName(long);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
