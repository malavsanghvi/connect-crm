import { describe, expect, it } from "vitest";

import { classifyInput } from "@/lib/find/classify";
import { customReason, familyOfAdult, scoreFamily, scorePerson } from "@/lib/find/match";
import { accentPattern, customValueFilter } from "@/lib/find/pattern";
import { rankCandidates } from "@/lib/find/search";

import { FAMILIES, PEOPLE, RULES, family, person } from "./fixtures";

const q = (text: string) => classifyInput(text);

describe("a searchable custom field found by the one box", () => {
  const skills = { label: "Volunteer skills", value: "Catering, first aid" };

  it("says which field matched and what it holds, as 'Custom field: <label> · <value>'", () => {
    const r = scorePerson(q("catering"), { ...PEOPLE.samira, customHits: [skills] }, RULES);
    expect(r?.why).toEqual({ code: "custom", label: "Custom field: Volunteer skills · Catering, first aid" });
  });

  it("needs every typed word in the value, in any order, and ignores accents and case", () => {
    expect(customReason(q("first catering"), [skills], false)).not.toBeNull();
    expect(customReason(q("catering driving"), [skills], false)).toBeNull();
    expect(customReason(q("CATERING"), [skills], false)).not.toBeNull();
    expect(customReason(q("cafe"), [{ label: "Likes", value: "Café Latte" }], false)).not.toBeNull();
  });

  it("finds a value and a field name written in another script", () => {
    const jp = { label: "ボランティアの技能", value: "料理, 応急手当" };
    const r = customReason(q("料理"), [jp], false);
    expect(r?.why.label).toBe("Custom field: ボランティアの技能 · 料理, 応急手当");
    const ar = { label: "المهارات", value: "الطبخ والإسعافات الأولية" };
    expect(customReason(q("الطبخ"), [ar], false)).not.toBeNull();
  });

  it("never outranks a name, an ID or a phone number", () => {
    const byCustom = scorePerson(q("sam"), { ...PEOPLE.sam, customHits: [{ label: "Nickname", value: "Sam" }] }, RULES);
    const byName = scorePerson(q("sam"), PEOPLE.sam, RULES);
    expect(byName?.why.code).toBe("name");
    expect(byCustom?.why.code).toBe("name");
    expect(customReason(q("catering"), [skills], false)!.score).toBeLessThanOrEqual(60);
    // a typed phone number or ID is not looked up in custom values
    expect(customReason(q("(713) 555-0136"), [{ label: "Note", value: "713 555 0136" }], false)).toBeNull();
    expect(customReason(q("10482"), [{ label: "Note", value: "10482" }], false)).toBeNull();
    expect(customReason(q("ana@example.org"), [{ label: "Note", value: "ana example org" }], false)).toBeNull();
  });

  it("does not match a value that is not there, and says nothing when there are no values", () => {
    expect(scorePerson(q("plumbing"), { ...PEOPLE.samira, customHits: [skills] }, RULES)).toBeNull();
    expect(scorePerson(q("catering"), PEOPLE.samira, RULES)).toBeNull();
    expect(customReason(q("catering"), [], false)).toBeNull();
  });

  it("picks the best of several fields", () => {
    const r = customReason(q("evening"), [{ label: "Notes", value: "Prefers calls in the evening after work" }, { label: "Preferred contact time", value: "Evening" }], false);
    expect(r?.why.label).toBe("Custom field: Preferred contact time · Evening");
  });

  it("clips a long value", () => {
    const r = customReason(q("catering"), [{ label: "Notes", value: `Catering ${"and more ".repeat(20)}` }], false);
    expect(r!.why.label.length).toBeLessThan(90);
    expect(r!.why.label).toContain("…");
  });

  it("says which field matched for a child but not what it holds (D2)", () => {
    const r = scorePerson(q("catering"), { ...PEOPLE.layla, customHits: [{ label: "Allergy note", value: "Peanuts, catering staff informed" }] }, RULES);
    expect(r?.why).toEqual({ code: "custom", label: "Custom field: Allergy note" });
    expect(r?.why.label).not.toContain("Peanuts");
  });

  it("finds a family on a household field, and an adult's family says who matched", () => {
    const f = scoreFamily(q("evening"), { ...FAMILIES.hassan, customHits: [{ label: "Preferred contact time", value: "Evening" }] }, RULES);
    expect(f?.why.label).toBe("Custom field: Preferred contact time · Evening");
    const adult = scorePerson(q("catering"), { ...PEOPLE.samira, customHits: [skills] }, RULES)!;
    const derived = familyOfAdult(adult, FAMILIES.hassan);
    expect(derived?.why.code).toBe("custom");
    expect(derived?.why.label).toBe("Custom field: Volunteer skills · Catering, first aid · Samira Hassan");
  });

  it("never brings a child's family in", () => {
    const child = scorePerson(q("catering"), { ...PEOPLE.layla, customHits: [skills] }, RULES)!;
    expect(familyOfAdult(child, FAMILIES.hassan)).toBeNull();
  });

  it("ranks through the same path as everything else: an adult and their family, a child only when the viewer may see children", () => {
    const people = [
      { ...PEOPLE.samira, customHits: [skills] },
      { ...PEOPLE.layla, customHits: [{ label: "Notes", value: "Catering helper" }] },
      PEOPLE.sam,
    ];
    const families = new Map([[FAMILIES.hassan.id, FAMILIES.hassan]]);
    const staff = rankCandidates(q("catering"), RULES, people, families, { canSeeChildren: true });
    expect(staff.items.map((i) => `${i.kind}:${i.scored.item.id}`).sort()).toEqual(["family:h-hassan", "person:p-layla", "person:p-samira"]);
    const other = rankCandidates(q("catering"), RULES, people, families, { canSeeChildren: false });
    expect(other.items.map((i) => `${i.kind}:${i.scored.item.id}`).sort()).toEqual(["family:h-hassan", "person:p-samira"]);
  });

  it("does not make up a match for a family or person with no custom values", () => {
    expect(scoreFamily(q("evening"), family({ id: "x", displayName: "Other household" }), RULES)).toBeNull();
    expect(scorePerson(q("evening"), person({ id: "y", firstName: "A", lastName: "B" }), RULES)).toBeNull();
  });
});

describe("the database filter for custom values", () => {
  it("looks in each listed field for every typed word, widening accents the way names are", () => {
    expect(customValueFilter("catering", ["skills"])).toBe(`custom->>skills.imatch.${accentPattern("catering")}`);
    const a = accentPattern("first");
    const b = accentPattern("aid");
    expect(customValueFilter("first aid", ["skills", "notes"])).toBe(
      `and(custom->>skills.imatch.${a},custom->>skills.imatch.${b}),and(custom->>notes.imatch.${a},custom->>notes.imatch.${b})`,
    );
  });

  it("uses a word in another script as typed", () => {
    expect(customValueFilter("料理", ["skills_ja"])).toBe("custom->>skills_ja.imatch.料理");
  });

  it("uses only keys that look like database keys, and nothing typed can reach the filter text", () => {
    expect(customValueFilter("catering", ["Bad Key", "x),other.eq.1", "ok_key", "9lives"])).toBe(customValueFilter("catering", ["ok_key"]));
    expect(customValueFilter("a),b.eq.1,(c", ["k"])).not.toMatch(/[(),]b|\.eq\.1/);
    expect(customValueFilter("%%%", ["k"])).toBeNull();
    expect(customValueFilter("catering", [])).toBeNull();
    expect(customValueFilter("catering", ["Bad Key"])).toBeNull();
  });
});
