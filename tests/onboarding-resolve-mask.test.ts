import { describe, expect, it } from "vitest";

import { makeConfig } from "@/lib/onboarding/resolve/config";
import { assertNoChildLeak, ChildLeakError, childIdentities, collectStrings, maskForAi, modelInputForGroup, type ChildIdentity } from "@/lib/onboarding/resolve/mask";
import type { RawRecord } from "@/lib/onboarding/resolve/types";

import { rec, run, TODAY } from "./fixtures/onboarding-resolve/helpers";

const cfg = makeConfig(TODAY, { country: "US" });

const child = rec({
  id: "k",
  name: "Zoya Shah",
  role: "Daughter",
  dob: "2014-05-03",
  school: "Cedar Elementary",
  grade: "Grade 5",
  notes: "allergic to peanuts",
  phone: "713-555-0142",
  address1: "12 Lotus Ln",
  zip: "77478",
});
const parent = rec({
  id: "a",
  name: "Rahul Shah",
  mobile: "713-555-0142",
  email: "rahul@example.com",
  address1: "12 Lotus Ln",
  zip: "77478",
  dob: "1985-02-01",
  notes: "Zoya starts at Cedar Elementary in Grade 5",
  children: "Zoya Shah, Arjun Shah",
});
const zoya: ChildIdentity = { first: "Zoya", last: "Shah", dob: "2014-05-03", school: "Cedar Elementary", grade: "Grade 5", notes: "allergic to peanuts" };

describe("maskForAi (D2)", () => {
  it("withholds a child's record whole", () => {
    const m = maskForAi(child, cfg);
    expect(m.withheld).toBe(true);
    expect(m.record).toBeNull();
    if (m.withheld) expect(m.reason).toBe("minor");
    expect(JSON.stringify(m)).not.toMatch(/Zoya|Shah|2014|Cedar|Grade|peanuts|Lotus/i);
  });
  it("keeps an adult's first name and masked contact details, and nothing about their children", () => {
    const m = maskForAi(parent, cfg);
    expect(m.withheld).toBe(false);
    if (m.withheld) return;
    expect(m.record.givenName).toBe("rahul");
    expect(m.record.phoneMasked).toBe("•••-•••-••42");
    expect(m.record.emailMasked).toBe("r•••@•••.com");
    expect(m.record.surnameMasked).toBe("s•••");
    expect(m.removed).toEqual(["date of birth", "notes", "children listed"]);
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/Zoya|Arjun|Cedar|Grade|peanuts|1985|rahul@example/i);
    expect(Object.keys(m.record)).not.toContain("notes");
    expect(Object.keys(m.record)).not.toContain("dob");
  });
  it("drops a child's name written inside a household-style name", () => {
    const row = rec({ id: "h", name: "Zoya & Rahul Shah", children: "Zoya", phone: "713-555-0142" });
    const m = maskForAi(row, cfg);
    if (m.withheld) throw new Error("adult row withheld");
    expect(m.record.givenName).toBeNull();
    expect(m.record.moreNamesOmitted).toBe(true);
    expect(JSON.stringify(m)).not.toMatch(/zoya/i);
  });
  it("withholds a record whose kind is unknown", () => {
    const m = maskForAi(rec({ id: "u", kind: "unknown", name: "??" }), cfg);
    expect(m.withheld).toBe(true);
  });
});

describe("assertNoChildLeak (the test helper)", () => {
  const leaks: Array<[string, unknown]> = [
    ["first name", { text: "Please check Zoya's record" }],
    ["first name, other case", ["ZOYA"]],
    ["full name", "zoya shah is on this row"],
    ["accented", { x: "Zoyá" }],
    ["inside a key", { "Zoya Shah": 1 }],
    ["deep in a list", { a: [{ b: [{ c: "ask about Zoya" }] }] }],
    ["birth date, ISO", "born 2014-05-03"],
    ["birth date, US", "born 05/03/2014"],
    ["birth date, day first", "born 03/05/2014"],
    ["school", "attends Cedar Elementary"],
    ["grade", "in grade 5"],
    ["notes", "note: allergic to peanuts"],
  ];
  for (const [label, input] of leaks) {
    it(`fails on a child's ${label}`, () => {
      expect(() => assertNoChildLeak(input, [zoya])).toThrow(ChildLeakError);
    });
  }
  it("passes on clean input, including a parent with the same family name and a longer word", () => {
    expect(() => assertNoChildLeak({ a: "Rahul Shah", b: "Zoyaa", c: ["Mira", "Lotus Lane"] }, [zoya])).not.toThrow();
  });
  it("names what leaked", () => {
    try {
      assertNoChildLeak("Zoya Shah, born 2014-05-03", [zoya]);
      throw new Error("did not throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ChildLeakError);
      expect((e as ChildLeakError).leaks).toEqual(expect.arrayContaining(['full name "Zoya Shah"', 'first name "Zoya"', 'birth date "2014-05-03"']));
    }
  });
  it("collects every string, keys included", () => {
    expect(collectStrings({ a: ["x", { b: "y" }], n: 3 }).sort()).toEqual(["3", "a", "b", "n", "x", "y"]);
  });
  it("finds the children in a set of rows", () => {
    const kids = childIdentities([child, parent], cfg);
    expect(kids.map((k) => k.first).sort()).toEqual(["Arjun", "Zoya", "zoya"].sort());
    expect(kids.find((k) => k.school)?.school).toBe("Cedar Elementary");
  });
});

describe("what a model is given for a question", () => {
  const rows: RawRecord[] = [
    parent,
    child,
    rec({ id: "p1", name: "Nirav Kapadia", source: "b.csv", phone: "713-555-0101", address1: "90 Cedar Dr", zip: "77479", notes: "Zoya's classmate" }),
    rec({ id: "p0", name: "Rahul Doshi", mobile: "713-555-0101", address1: "12 Oak Ln", zip: "77478" }),
  ];
  const res = run(rows);
  const raws = new Map(rows.map((r) => [r.id, r]));
  const kids = childIdentities(rows, cfg);

  it("a group about children gets a count and no examples", () => {
    const g = res.groups.find((x) => x.signature === "minor_record")!;
    const input = modelInputForGroup(g, raws, cfg);
    expect(input).toEqual({ signature: "minor_record", tier: "D", rows: 1, examples: [], withheld: 1 });
    assertNoChildLeak(input, kids);
  });
  it("other groups get masked adults only", () => {
    const g = res.groups.find((x) => x.signature === "shared_phone_households")!;
    const input = modelInputForGroup(g, raws, cfg);
    expect(input.examples.length).toBeGreaterThan(0);
    for (const pair of input.examples) for (const r of pair) expect(r.phoneMasked ?? "").toMatch(/^[•\d-]*$/);
    assertNoChildLeak(input, kids);
  });
  it("nothing built for any group, or for any row, carries a child", () => {
    for (const g of res.groups) assertNoChildLeak(modelInputForGroup(g, raws, cfg), kids);
    for (const r of rows) assertNoChildLeak(maskForAi(r, cfg), kids);
  });
});
