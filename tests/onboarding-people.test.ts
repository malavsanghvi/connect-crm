import { describe, expect, it } from "vitest";

import { applyDecisions, matchPayers } from "@/lib/onboarding/match";
import { autoMapPersonColumns, buildPeopleFile, missingPersonFields, personToInput, relationshipOf, validatePeople } from "@/lib/onboarding/people";

const headers = ["Name", "Relation", "Family ID", "DOB", "Cell", "E-mail", "Address", "ZIP", "Tier", "Clan"];
const rows = [
  ["Sanghvi, Malav", "Self", "F-1", "04/12/1986", "281-555-0142", "m@example.com", "12 Lotus Lane", "77478", "Life", "Shah"],
  ["Palak Sheth", "Wife", "F-1", "1988-02-01", "", "", "", "", "", ""],
  ["Arav Sanghvi", "Son", "F-1", "02/30/2012", "", "not-an-email", "", "", "", ""],
  ["", "Son", "F-2", "", "", "", "", "", "", ""],
];

describe("people mapping and validation", () => {
  const c = autoMapPersonColumns(headers, rows);
  it("maps by header words; a name column counts as Full name; unknown becomes custom", () => {
    expect(c.slice(0, 9)).toEqual(["fullName", "relationship", "familyId", "dob", "phone", "email", "address1", "zip", "membership"]);
    expect(c[9]).toBe("custom");
    expect(missingPersonFields(c)).toEqual([]);
    expect(missingPersonFields(["email"])).toHaveLength(1);
  });
  it("recognises relationships in the organization's own words", () => {
    expect(relationshipOf("Wife")).toBe("spouse");
    expect(relationshipOf("Head of Household")).toBe("primary");
    expect(relationshipOf("Daughter")).toBe("child");
    expect(relationshipOf("Uncle")).toBe("other");
    expect(relationshipOf("")).toBeNull();
  });
  const v = validatePeople(headers, rows, c);
  it("splits 'Last, First', drops bad optional values with a warning and rejects a blank name", () => {
    expect(v.rows.map((r) => `${r.firstName} ${r.lastName}`)).toEqual(["Malav Sanghvi", "Palak Sheth", "Arav Sanghvi"]);
    expect([...v.badRows]).toEqual([5]);
    expect(v.problems.some((p) => p.rowNo === 4 && p.column === "Birth date")).toBe(true);
    expect(v.problems.some((p) => p.rowNo === 4 && p.column === "Email")).toBe(true);
    expect(v.rows[0]!.dob).toBe("1986-04-12");
    expect(v.rows[0]!.phone).toBe("+12815550142");
    expect(v.rows[0]!.extras).toEqual({ Clan: "Shah" });
  });
  it("a family ID puts people with different surnames in one household, one primary", () => {
    const m = matchPayers(v.rows.map(personToInput));
    expect(m.groups).toHaveLength(1);
    const f = buildPeopleFile(applyDecisions(m, new Set()), v.rows, (g) => `ONB-H-${g.id + 1}`);
    expect(f.rows).toHaveLength(3);
    expect(f.rows.filter((r) => r[3] === "Yes")).toHaveLength(1);
    expect(f.rows[0]![2]).toBe("primary");
    expect(f.rows[1]![2]).toBe("spouse");
    expect(f.rows[2]![2]).toBe("child");
    expect(f.headers).toContain("Membership type");
    expect(f.headers).toContain("Clan");
  });
});
