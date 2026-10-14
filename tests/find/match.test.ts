import { describe, expect, it } from "vitest";

import { classifyInput } from "@/lib/find/classify";
import { canonicalId, familyOfAdult, foldWords, nameScore, scoreFamily, scorePerson } from "@/lib/find/match";

import { FAMILIES, PEOPLE, RULES, family, person } from "./fixtures";

const score = (typed: string, p = PEOPLE.samira) => scorePerson(classifyInput(typed), p, RULES);

describe("names, folded", () => {
  it("finds a name with or without accents, in any case", () => {
    expect(score("sofia", PEOPLE.sofia)?.why.label).toBe("Name");
    expect(score("SOFÍA FERNANDEZ", PEOPLE.sofia)).not.toBeNull();
    expect(score("fernandez", PEOPLE.sofia)).not.toBeNull();
    expect(score("Sofía", person({ id: "x", firstName: "Sofia", lastName: "Ruiz" }))).not.toBeNull();
  });

  it("finds names in other scripts by what was typed", () => {
    expect(score("田中", PEOPLE.taro)).not.toBeNull();
    expect(score("太郎", PEOPLE.taro)).not.toBeNull();
    expect(score("田中太郎", PEOPLE.taro)).not.toBeNull();
    expect(score("प्रिया", PEOPLE.priya)).not.toBeNull();
    expect(score("शर्मा", PEOPLE.priya)).not.toBeNull();
    expect(score("محمد", PEOPLE.mohammed)).not.toBeNull();
    expect(score("иванов", PEOPLE.nikolai)).not.toBeNull();
    expect(score("николай иванов", PEOPLE.nikolai)).not.toBeNull();
  });

  it("does not match a name that is not there, and needs every typed word", () => {
    expect(score("Nakamura", PEOPLE.samira)).toBeNull();
    expect(score("Samira Nakamura", PEOPLE.samira)).toBeNull();
    expect(score("田中", PEOPLE.sofia)).toBeNull();
  });

  it("finds a person by their preferred name, in either order", () => {
    expect(score("Sam Nakamura", PEOPLE.sam)).not.toBeNull();
    expect(score("Nakamura Sam", PEOPLE.sam)).not.toBeNull();
    expect(score("Samuel", PEOPLE.sam)).not.toBeNull();
  });

  it("scores a whole name above the start of a name above the inside of a word", () => {
    const words = foldWords("Samuel Nakamura");
    const exact = nameScore(foldWords("Samuel Nakamura"), words);
    const whole = nameScore(foldWords("Samuel"), words);
    const prefix = nameScore(foldWords("Sam"), words);
    const inside = nameScore(foldWords("amur"), words);
    expect(exact).toBeGreaterThan(whole);
    expect(whole).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(0);
    expect(exact).toBeLessThan(95); // an identifier or a whole phone number always beats a name
  });

  it("an apostrophe is no break", () => {
    expect(foldWords("O'Brien")).toEqual(["obrien"]);
    expect(nameScore(foldWords("obrien"), foldWords("Mary O’Brien"))).toBeGreaterThan(0);
  });

  it("a child ranks just under an adult who matches equally, a person who has passed away under the living", () => {
    const adult = score("Hassan", PEOPLE.samira);
    const child = score("Hassan", PEOPLE.layla);
    const late = score("Hassan", person({ ...PEOPLE.samira, id: "late", isDeceased: true }));
    expect(adult && child && late).toBeTruthy();
    expect(child!.score).toBeLessThan(adult!.score);
    expect(late!.score).toBeLessThan(child!.score);
  });
});

describe("phone numbers by their digits", () => {
  it("finds a whole number in any format", () => {
    for (const t of ["+1 415 555 0134", "(415) 555-0134", "415.555.0134", "4155550134"]) {
      const s = score(t, PEOPLE.ana);
      expect(s?.why.code, t).toBe("phone");
      expect(s!.score).toBeGreaterThanOrEqual(92);
    }
  });

  it("finds the last digits, with a label that says so", () => {
    const s = score("555-0134", PEOPLE.ana)!;
    expect(s.why.label).toBe("Mobile (415) 555-0134");
    const last = scorePerson(classifyInput("(555) 0134"), PEOPLE.ana, RULES)!;
    expect(last.why.code).toBe("phone");
    expect(score("(415) 555-0199", PEOPLE.ana)).toBeNull();
  });

  it("a bare four-digit number is an identifier first: a phone match is weaker than an exact ID", () => {
    const asId = scorePerson(classifyInput("0134"), PEOPLE.ana, RULES)!;
    expect(asId.why.code).toBe("phone");
    expect(asId.score).toBeLessThanOrEqual(60);
    const exact = scorePerson(classifyInput("0134"), person({ id: "z", firstName: "Z", lastName: "Z", hits: [{ kind: "org_member", system: "register", value: "0134" }] }), RULES)!;
    expect(exact.score).toBe(100);
  });
});

describe("email", () => {
  it("finds an email by its whole, its start or a part", () => {
    expect(score("ana@lopezbakery.example", PEOPLE.ana)).toMatchObject({ score: 100, why: { code: "email" } });
    expect(score("ana@lop", PEOPLE.ana)).toMatchObject({ score: 92 });
    expect(score("@lopezbakery", PEOPLE.ana)).toMatchObject({ score: 70 });
    expect(score("bob@lopezbakery.example", PEOPLE.ana)).toBeNull();
  });
});

describe("numbers and IDs", () => {
  it("finds a member number with or without leading zeros", () => {
    expect(score("10482", PEOPLE.samira)).toMatchObject({ score: 100, why: { code: "member_number", label: "Member no. 10482" } });
    const padded = person({ id: "m", firstName: "M", lastName: "M", memberNumber: "0417" });
    expect(scorePerson(classifyInput("417"), padded, RULES)).toMatchObject({ score: 100 });
    expect(scorePerson(classifyInput("member 0417"), padded, RULES)).toMatchObject({ score: 100 });
    expect(scorePerson(classifyInput("04"), padded, RULES)).toBeNull(); // too short to be a start
  });

  it("says why an identifier matched in the organization's own words, and finance kinds by their names", () => {
    const hit = (kind: string, system: string | null, value: string) => scorePerson(classifyInput(value), person({ id: "i", firstName: "I", lastName: "I", hits: [{ kind, system, value }] }), RULES)!.why.label;
    expect(hit("org_member", "register", "0417")).toBe("Member ID 0417");
    expect(hit("crm", "neon", "20417")).toBe("Old CRM ID 20417");
    expect(hit("crm", "other_system", "20417")).toBe("Old system ID 20417");
    expect(hit("accounting", "quickbooks", "88412")).toBe("QuickBooks customer 88412");
    expect(hit("bank_payer", "chase", "LOPEZ BAKERY LLC")).toBe("Bank payer name LOPEZ BAKERY LLC");
  });

  it("canonicalId ignores punctuation and the leading zeros of numbers only", () => {
    expect(canonicalId("0417")).toBe("417");
    expect(canonicalId("JSH-H-2041")).toBe("JSHH2041");
    expect(canonicalId("000")).toBe("0");
    expect(canonicalId("T-0417")).toBe("T0417");
  });
});

describe("families", () => {
  it("finds a family by its name, its household number or an identifier it holds", () => {
    expect(scoreFamily(classifyInput("hassan"), FAMILIES.hassan, RULES)).toMatchObject({ why: { code: "name" } });
    expect(scoreFamily(classifyInput("0301"), FAMILIES.hassan, RULES)).toMatchObject({ score: 100, why: { code: "household_number", label: "Household no. 0301" } });
    expect(scoreFamily(classifyInput("301"), FAMILIES.hassan, RULES)).toMatchObject({ score: 100 });
    const withHit = family({ id: "h", displayName: "Sharma household", hits: [{ kind: "org_household", system: "register", value: "2041" }] });
    expect(scoreFamily(classifyInput("2041"), withHit, RULES)).toMatchObject({ score: 100, why: { label: "Household ID 2041" } });
    expect(scoreFamily(classifyInput("nobody"), FAMILIES.hassan, RULES)).toBeNull();
    expect(scoreFamily(classifyInput("田中"), FAMILIES.tanaka, RULES)).not.toBeNull();
  });

  it("an adult who matched brings the family in a little lower, saying who; a child never does (D2)", () => {
    const adult = score("sam", PEOPLE.sam)!;
    const viaAdult = familyOfAdult(adult, FAMILIES.nakamura)!;
    expect(viaAdult.score).toBe(adult.score - 12);
    expect(viaAdult.why).toEqual({ code: "adult", label: "Adult Sam Nakamura" });
    const child = score("layla", PEOPLE.layla)!;
    expect(child).not.toBeNull();
    expect(familyOfAdult(child, FAMILIES.hassan)).toBeNull();
    const byPhone = familyOfAdult(score("555-0134", PEOPLE.ana)!, FAMILIES.lopez)!;
    expect(byPhone.why.label).toBe("Mobile (415) 555-0134 · Ana Lopez");
  });
});
