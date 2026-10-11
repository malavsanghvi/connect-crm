import { describe, expect, it } from "vitest";

import { filterChildren, householdNameWithoutChildren, isAdultMember, leakedMinorNames, nameMatcher } from "@/lib/commands/child-filter";

const TODAY = "2026-10-10";

describe("who counts as an adult", () => {
  it("goes by the birth date when there is one", () => {
    expect(isAdultMember({ date_of_birth: "2008-10-10", role: "child" }, TODAY)).toBe(true); // turned 18 today
    expect(isAdultMember({ date_of_birth: "2008-10-11", role: "primary" }, TODAY)).toBe(false); // 17 until tomorrow
    expect(isAdultMember({ date_of_birth: "1985-03-02", role: "child" }, TODAY)).toBe(true); // an adult son or daughter
  });
  it("with no birth date, only a head, spouse or parent is an adult", () => {
    for (const role of ["primary", "spouse", "parent"]) expect(isAdultMember({ date_of_birth: null, role }, TODAY)).toBe(true);
    for (const role of ["child", "sibling", "other", null, undefined]) expect(isAdultMember({ date_of_birth: null, role }, TODAY)).toBe(false);
  });
});

describe("removing children from a result", () => {
  it("drops birth dates and children lists wherever they are", () => {
    const { value, removed } = filterChildren(
      { household: { name: "Shah", date_of_birth: "1980-01-01", children: [{ name: "Zoya" }], nested: { dob: "1990-05-05", fine: 1 } } },
      { today: TODAY },
    );
    expect(value).toEqual({ household: { name: "Shah", nested: { fine: 1 } } });
    expect(removed).toBe(3);
  });

  it("removes a record that is itself a minor, by birth date, age, role or flag", () => {
    const list = [
      { name: "Adult One", date_of_birth: "1980-01-01" },
      { name: "Kid By Birth", date_of_birth: "2015-01-01" },
      { name: "Kid By Age", age: 9 },
      { name: "Kid By Role", role: "Child" },
      { name: "Kid By Flag", is_minor: true },
      { name: "Learner", learner_id: "abc" },
      { name: "Adult Age", age: 44 },
    ];
    const { value } = filterChildren({ people: list }, { today: TODAY });
    expect((value.people as { name: string }[]).map((p) => p.name)).toEqual(["Adult One", "Adult Age"]);
  });

  it("drops learner records, photos and health notes by name", () => {
    const { value } = filterChildren(
      { class: { name: "Level 2", attendance: [{ date: "2026-10-04" }], homework: ["x"], progress: 80, students: 12, photo_path: "p.jpg", dietary_notes: "none", allergies: "nuts", teacher: "Meera Shah" } },
      { today: TODAY },
    );
    expect(value).toEqual({ class: { name: "Level 2", teacher: "Meera Shah" } });
  });

  it("drops the household card's text of everyone's first names", () => {
    const { value } = filterChildren({ household_id: "h", members: "Priya, Rahul, Zoya", primary_member: "Priya Shah", city: "Naperville" }, { today: TODAY });
    expect(value).toEqual({ household_id: "h", city: "Naperville" });
  });

  it("replaces the names of minors in any text, as whole words, without case", () => {
    const names = ["Zoya Shah", "Aarav Patel"];
    const { value, removed } = filterChildren(
      { a: "Pickup for ZOYA  SHAH at 5", b: ["Aarav Patel's class", "Zoya Shahid is an adult", "Priya Shah"] },
      { minorNames: names, today: TODAY },
    );
    expect(JSON.stringify(value)).not.toMatch(/Zoya Shah\b|Aarav Patel/i);
    expect(value.b[1]).toBe("Zoya Shahid is an adult");
    expect(value.b[2]).toBe("Priya Shah");
    expect(removed).toBe(2);
  });

  it("does not change what it was given", () => {
    const input = { children: [1], name: "Zoya Shah" };
    filterChildren(input, { minorNames: ["Zoya Shah"], today: TODAY });
    expect(input).toEqual({ children: [1], name: "Zoya Shah" });
  });

  it("keeps numbers, nulls and dates as they are", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(filterChildren({ n: 1, z: null, ok: true, d }, { today: TODAY }).value).toEqual({ n: 1, z: null, ok: true, d });
  });
});

describe("checking a result for a child's name", () => {
  it("finds a name that is still there, whatever its case, accents or spacing", () => {
    expect(leakedMinorNames({ x: ["fine", { y: "zoya  SHAH" }] }, ["Zoya Shah", "Aarav Patel"])).toEqual(["Zoya Shah"]);
    expect(leakedMinorNames({ x: "René Müller" }, ["Rene Muller"])).toEqual(["Rene Muller"]);
    expect(leakedMinorNames({ x: "Zoya Shahid" }, ["Zoya Shah"])).toEqual([]);
    expect(leakedMinorNames({ x: "nothing" }, [])).toEqual([]);
  });
  it("only matches names of two words or more, so a first name alone cannot blank a result", () => {
    expect(nameMatcher(["Om", "Zoya"])).toBeNull();
    expect(nameMatcher(["Zoya Shah"])).not.toBeNull();
  });
});

describe("a household's display name without its children's first names", () => {
  it("takes a child out of the list of names", () => {
    expect(householdNameWithoutChildren("Shah, Priya, Rahul & Zoya", ["Zoya"])).toBe("Shah, Priya, Rahul");
    expect(householdNameWithoutChildren("Shah family (Priya, Zoya)", ["Zoya"])).toBe("Shah family (Priya)");
    expect(householdNameWithoutChildren("Zoya & Priya Shah", ["Zoya"])).toBe("Priya Shah");
    expect(householdNameWithoutChildren("Patel and Aarav", ["Aarav"])).toBe("Patel");
  });
  it("leaves a name alone when there is nothing to take out, and gives null when nothing is left", () => {
    expect(householdNameWithoutChildren("Patel family", ["Zoya"])).toBe("Patel family");
    expect(householdNameWithoutChildren("Zoya", ["Zoya"])).toBeNull();
    expect(householdNameWithoutChildren(null, ["Zoya"])).toBeNull();
    expect(householdNameWithoutChildren("Zoyal Shah", ["Zoya"])).toBe("Zoyal Shah");
  });
});
