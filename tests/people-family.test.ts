import { describe, expect, it } from "vitest";

import { canCheckForMatches, familyAdultName, familyDraftProblem, isStrongMatch, matchesHeading, parseContact, parseFamilyMatches } from "@/lib/people-family";

// "Add a family": the pure pieces the command, the actions and the sheet share.
const d = (over: Partial<{ firstName: string; lastName: string; contact: string; street: string }> = {}) => ({ firstName: "Nia", lastName: "Okafor", contact: "", street: "", ...over });

describe("parseContact: one box for a mobile or an email", () => {
  it("reads an at sign as an email, in lower case", () => {
    expect(parseContact("  Nia@Example.ORG ")).toMatchObject({ email: "nia@example.org", mobile: null, badEmail: false, incompletePhone: false });
  });
  it("reads anything else as a mobile number, in international form", () => {
    expect(parseContact("(512) 555-0188")).toMatchObject({ mobile: "+15125550188", email: null });
    expect(parseContact("+44 7700 900123")).toMatchObject({ mobile: "+447700900123" });
  });
  it("says a half-typed number is not finished, without calling it a mistake yet", () => {
    const c = parseContact("512 55");
    expect(c).toMatchObject({ mobile: null, incompletePhone: true });
    expect(c.phoneProblem).toMatch(/area code/);
  });
  it("says an email that is not one", () => {
    expect(parseContact("nia@")).toMatchObject({ email: null, badEmail: true });
  });
  it("is nothing when empty", () => {
    expect(parseContact("   ")).toEqual({ mobile: null, email: null, incompletePhone: false, badEmail: false, phoneProblem: null });
  });
});

describe("when to look for a family that may already be here", () => {
  it("needs a last name of two letters, or a whole mobile or email", () => {
    expect(canCheckForMatches(d({ lastName: "O" }))).toBe(false);
    expect(canCheckForMatches(d({ lastName: "Ok" }))).toBe(true);
    expect(canCheckForMatches(d({ lastName: "", contact: "512 55" }))).toBe(false);
    expect(canCheckForMatches(d({ lastName: "", contact: "(512) 555-0188" }))).toBe(true);
    expect(canCheckForMatches(d({ lastName: "", contact: "nia@example.org" }))).toBe(true);
  });
  it("counts a name in any script: one Han character is a whole last name only with a second", () => {
    expect(canCheckForMatches(d({ firstName: "明", lastName: "李" }))).toBe(false);
    expect(canCheckForMatches(d({ firstName: "ليلى", lastName: "الحسن" }))).toBe(true);
  });
});

describe("familyDraftProblem", () => {
  it("asks for both names, a finished mobile or email, and a street of a sensible length", () => {
    expect(familyDraftProblem(d())).toBeNull();
    expect(familyDraftProblem(d({ firstName: " " }))).toBe("Enter the first adult's first and last name.");
    expect(familyDraftProblem(d({ lastName: "" }))).toBe("Enter the first adult's first and last name.");
    expect(familyDraftProblem(d({ contact: "nia@" }))).toBe("That email address does not look right.");
    expect(familyDraftProblem(d({ contact: "512 55" }))).toMatch(/^Enter the mobile number with its area code.*\.$/);
    expect(familyDraftProblem(d({ street: "x".repeat(301) }))).toBe("The street address is too long.");
    expect(familyDraftProblem(d({ firstName: "明", lastName: "李", contact: "ming@example.org" }))).toBeNull();
  });
  it("writes the first adult's name the way it was typed", () => {
    expect(familyAdultName({ firstName: " 明 ", lastName: "李" })).toBe("明 李");
  });
});

describe("parseFamilyMatches reads the database's answer defensively", () => {
  const id = "a0000000-0000-4000-8000-000000000001";
  it("reads matches, reasons and the count", () => {
    expect(parseFamilyMatches({ total: 12, matches: [{ household_id: id, reasons: ["mobile", "name"], strength: 7 }] })).toEqual({
      total: 12,
      matches: [{ householdId: id, reasons: ["mobile", "name"], strength: 7 }],
    });
  });
  it("drops what it does not understand: an id that is not an id, a reason it does not know, a row that is not an object", () => {
    const r = parseFamilyMatches({ total: 1, matches: [{ household_id: "nope", reasons: ["mobile"] }, { household_id: id, reasons: ["mobile", "ssn", 7] }, null, "x"] });
    expect(r.matches).toEqual([{ householdId: id, reasons: ["mobile"], strength: 0 }]);
    expect(r.total).toBe(1);
  });
  it("is empty for anything that is not an answer", () => {
    for (const bad of [null, undefined, [], "x", 3, { matches: "no" }]) expect(parseFamilyMatches(bad)).toEqual({ total: 0, matches: [] });
  });
  it("never says fewer than it was given", () => {
    expect(parseFamilyMatches({ total: 0, matches: [{ household_id: id, reasons: [] }] }).total).toBe(1);
  });
});

describe("the words over the matches", () => {
  it("counts them", () => {
    expect(matchesHeading(0)).toBe("No family like this yet.");
    expect(matchesHeading(1)).toBe("1 family may already be this one.");
    expect(matchesHeading(3)).toBe("3 families may already be this one.");
  });
  it("calls a shared last name alone a weaker sign than the same mobile, email or whole name", () => {
    expect(isStrongMatch({ reasons: ["last_name"] })).toBe(false);
    expect(isStrongMatch({ reasons: ["last_name", "mobile"] })).toBe(true);
    expect(isStrongMatch({ reasons: ["name"] })).toBe(true);
  });
});
