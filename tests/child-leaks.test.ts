import { describe, expect, it } from "vitest";

import { filterChildren } from "@/lib/commands/child-filter";
import { CHILD_NAME_REPLACEMENT as M, compileMinorNames, type MinorNameEntry } from "@/lib/commands/minor-names";

import { LEAK_CASES, seen } from "./fixtures/child-leaks";

// Decision D2: nothing about a child reaches an AI provider. Every line below is a way a child's name once got through the name
// filter (found by an adversarial review): glued to digits or words, in an address or file name, split by invisible characters,
// with an ending stuck on in Tamil, Russian or Georgian, written with another Arabic letter, as one word or two, as Traditional
// or Simplified Chinese, or as Korean written letter by letter.

describe("a child's name never gets through the filter, however it is written", () => {
  for (const c of LEAK_CASES) {
    it(`${c.group}: ${JSON.stringify(c.text)}`, () => {
      const scanner = compileMinorNames(c.children);
      const out = scanner.redact(c.text).text;
      expect(out, `${JSON.stringify(c.text)} -> ${JSON.stringify(out)}`).toContain(M);
      const clean = seen(out);
      for (const piece of c.gone) expect(clean, `${JSON.stringify(c.text)} -> ${JSON.stringify(out)}`).not.toContain(piece.toLowerCase());
      // The answer is itself clean, and cleaning it again changes nothing.
      expect(scanner.find(out)).toEqual([]);
      expect(scanner.redact(out).text).toBe(out);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. A key can carry a name too
// ---------------------------------------------------------------------------
describe("8. object keys that carry a child's name", () => {
  const zoya: MinorNameEntry[] = [{ full: ["Zoya Shah"], words: ["Zoya"] }];
  it("renames them, keeps them apart, and keeps the values", () => {
    const { value, removed } = filterChildren({ ZoyaNote: "a", zoya2015: "b", "zoya.shah@example.org": "c", ok: 1 }, { minorNames: zoya, today: "2026-10-10" });
    const keys = Object.keys(value as object);
    expect(keys).toHaveLength(4);
    expect(keys).toContain("ok");
    expect(keys.join("|").toLowerCase()).not.toContain("zoya");
    expect(Object.values(value as object).sort()).toEqual([1, "a", "b", "c"]);
    expect(removed).toBeGreaterThanOrEqual(3);
  });
  it("renames keys at any depth and in lists", () => {
    const { value } = filterChildren({ rows: [{ ZoyaPaid: 5 }], deep: { a: { zoya_2015: true } } }, { minorNames: zoya, today: "2026-10-10" });
    expect(JSON.stringify(value).toLowerCase()).not.toContain("zoya");
  });
});

// ---------------------------------------------------------------------------
// 11. Ages and school years that survived the structural filter
// ---------------------------------------------------------------------------
describe("11. age fields, school years and labelled birth dates", () => {
  const TODAY = "2026-10-10";
  const names = (value: unknown, majority?: number) => ((filterChildren(value, { today: TODAY, majority }).value as { people: { name: string }[] }).people ?? []).map((p) => p.name);

  it("removes a record whose age is written as text", () => {
    const people = [
      { name: "a", age: "12" }, { name: "b", age: "12 years" }, { name: "c", age: "12y" }, { name: "d", age: " 9 yrs old " }, { name: "e", age: "child" },
      { name: "f", age: "teen" }, { name: "g", age: "under 18" }, { name: "h", age_years: "7" }, { name: "i", current_age: 5 },
      { name: "adult", age: "44" }, { name: "adult2", age: 44 },
    ];
    expect(names({ people })).toEqual(["adult", "adult2"]);
  });
  it("uses the community's age, not 18", () => {
    expect(names({ people: [{ name: "x", age: "19" }, { name: "y", age: 25 }] })).toEqual(["x", "y"]);
    expect(names({ people: [{ name: "x", age: "19" }, { name: "y", age: 25 }] }, 21)).toEqual(["y"]);
  });
  it("drops age groups, school years and every key that says born or birth", () => {
    const { value } = filterChildren(
      { name: "Dev", age_group: "7-9", ageGroup: "child", age_range: "5-12", grade: "5th", grade_level: 5, year_group: "Year 6", class_year: "2", born: "1980-01-01", birth: "1980", dob_iso: "1980-01-01T00:00:00Z", dobISO: "x", birthplace: "Pune", yob: 1980, fine: 1 },
      { today: TODAY },
    );
    expect(value).toEqual({ name: "Dev", fine: 1 });
  });
  it("removes a record by a birth year, a birth key in any spelling and an ISO date", () => {
    expect(names({ people: [{ name: "a", birth: "2015" }, { name: "b", born: "2016-02-02" }, { name: "c", dob_iso: "2014-01-01T00:00:00Z" }, { name: "d", yob: 2012 }, { name: "ok", born: "1975" }] })).toEqual(["ok"]);
  });
  it("removes a {label, value} pair that says what the value is", () => {
    const rows = [
      { label: "Date of birth", value: "2015-05-05" }, { label: "Born", value: "May 2015" }, { name: "Age", value: "12" }, { field: "Grade", text: "5" },
      { title: "Age group", value: "child" }, { label: "DOB:", value: "x" }, { label: "Phone", value: "630" }, { label: "City", value: "Lisle" },
    ];
    const { value } = filterChildren({ people: rows }, { today: TODAY });
    expect(JSON.stringify(value)).toBe(JSON.stringify({ people: [{ label: "Phone", value: "630" }, { label: "City", value: "Lisle" }] }));
  });
});

// ---------------------------------------------------------------------------
// Over-removal that does not make the filter weaker
// ---------------------------------------------------------------------------
describe("names that are also everyday words, and ages written after a name", () => {
  const redact = (entries: MinorNameEntry[], text: string): string => compileMinorNames(entries).redact(text).text;
  const kid = (given: string, family = "Shah"): MinorNameEntry => ({ full: [`${given} ${family}`], words: [given] });

  it("finds Will, Hope, Chase, May, An and My only as a name: capitalised, or beside the child's other names", () => {
    for (const [given, plain] of [["Will", "I will come and free will is real"], ["Hope", "I hope so; there is hope"], ["Chase", "Do not purchase it; chase the cat"], ["May", "It may rain; you may go"], ["An", "an event; an hour"], ["My", "my class; my turn"], ["Joy", "with joy"], ["Grace", "saying grace"]] as const) {
      expect(redact([kid(given)], plain), given).toBe(plain);
      expect(redact([kid(given)], `${given} is sick`), given).toContain(M);
      expect(redact([kid(given)], `${given.toUpperCase()} is sick`), given).toContain(M);
      expect(redact([kid(given)], `Call ${given.toLowerCase()} shah today`), given).toContain(M); // beside the family name
    }
  });
  it("still finds a name that merely looks like a word when it is a name of five letters or more written whole", () => {
    expect(redact([kid("Aarav")], "an aarav")).toBe(`an ${M}`);
  });
  it("takes an age written right after the name along, and no other number", () => {
    const zoya = [kid("Zoya")];
    for (const text of ["Zoya (12) came", "Zoya, aged 12, came", "Zoya aged 12 came", "Zoya, age 12 came", "Zoya [12] came", "Zoya, 12 years old, came", "Zoya 12-year-old came", "Zoya (12y) came", "Zoya (12 yrs old) came"]) {
      const out = redact(zoya, text);
      expect(out, text).not.toMatch(/\d/);
      expect(out, text).toContain("came");
    }
    expect(redact(zoya, "12-year-old Zoya came")).not.toMatch(/\d/);
    expect(redact(zoya, "Zoya paid $12 for room 12; 12 guests (Zoya)")).toBe(`${M} paid $12 for room 12; 12 guests (${M})`);
    expect(redact(zoya, "Zoya (3 guests) and (12) tables")).toBe(`${M} (3 guests) and (12) tables`);
  });
});
