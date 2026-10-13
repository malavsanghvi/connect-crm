import { describe, expect, it } from "vitest";

import { initialEdit, reduce, type EditEvent, type EditUnit, type Values } from "@/lib/people-v2/inline-edit";
import {
  CHOICES_MAX,
  GROUP_FIELDS,
  NOTE_MAX,
  PAIR_SENTENCE,
  PROFILE_KEYS,
  checkAnniversary,
  checkDietary,
  checkEmergency,
  csvKeys,
  describeGroup,
  dietaryChips,
  dietaryText,
  emergencyText,
  encodePatch,
  groupOf,
  nothingToChange,
  profileConflictKeys,
  profileConflictLine,
  profileGroups,
  profileShapeProblem,
  profileUnits,
  profileValues,
  rowValues,
  sameProfileValue,
  toggleChoice,
  type CheckInput,
  type DietaryOption,
} from "@/lib/people-v2/profile-details";

// The pure core of the editable "given by the member" rows: the checks (in the database's own words), the units that run through the
// same state machine as every other value, the patch the database function receives, the shape check, and the comparison behind
// the conflict. Names and notes are from several cultures and scripts on purpose: nothing here is Latin-only.

const OPTIONS: DietaryOption[] = [
  { key: "vegetarian", label: "Vegetarian", active: true },
  { key: "vegan", label: "Vegan", active: true },
  { key: "halal", label: "حلال", active: true },
  { key: "dairy_free", label: "Dairy-free", active: false },
  { key: "other", label: "Other", active: true },
];

const adult: CheckInput = { today: "2026-10-13", birthDate: "1980-05-05", isChild: false, options: OPTIONS, currentKeys: [] };
const child: CheckInput = { ...adult, birthDate: "2017-03-01", isChild: true };

const EMPTY: Values = rowValues(null);

/** Plays events through the state machine of a unit, as the page does. */
function run(unit: EditUnit, committed: Values, events: EditEvent[]) {
  return events.reduce((s, e) => reduce(s, e, unit, { today: "" }), initialEdit(unit, committed));
}

describe("which groups a person has", () => {
  it("gives an adult all three and a child dietary needs and an emergency contact only (an allergy matters; an anniversary is for adults)", () => {
    expect(profileGroups(false)).toEqual(["anniversary", "dietary", "emergency"]);
    expect(profileGroups(true)).toEqual(["dietary", "emergency"]);
  });

  it("knows the fields of each group and which group a field belongs to", () => {
    expect(PROFILE_KEYS).toHaveLength(6);
    expect(Object.values(GROUP_FIELDS).flat().sort()).toEqual([...PROFILE_KEYS].sort());
    expect(groupOf("dietary_other")).toBe("dietary");
    expect(groupOf("emergency_contact_phone")).toBe("emergency");
    expect(groupOf("anniversary")).toBe("anniversary");
    expect(groupOf("first_name")).toBeNull();
  });
});

describe("the values", () => {
  it("holds a person's details as text by field name, and nothing as empty text", () => {
    const v = profileValues({
      anniversary: "2009-06-20",
      emergency: { name: "田中 健", relationship: "Brother", phone: "+81398765432" },
      edit: { dietaryKeys: ["halal", "other"], dietaryOther: "エビ・カニにアレルギー" },
    });
    expect(v).toEqual({
      anniversary: "2009-06-20",
      dietary: "halal,other",
      dietary_other: "エビ・カニにアレルギー",
      emergency_contact_name: "田中 健",
      emergency_contact_relationship: "Brother",
      emergency_contact_phone: "+81398765432",
    });
    expect(profileValues({ anniversary: null, emergency: null, edit: { dietaryKeys: [], dietaryOther: "" } })).toEqual(EMPTY);
  });

  it("reads the same values from a row of the table, and from no row", () => {
    expect(rowValues({ anniversary: "2009-06-20", dietary: ["vegan", "other"], dietary_other: "ไม่ทานถั่ว", emergency_contact_name: "Ngozi", emergency_contact_relationship: null, emergency_contact_phone: "+2348012345678" })).toEqual({
      anniversary: "2009-06-20",
      dietary: "vegan,other",
      dietary_other: "ไม่ทานถั่ว",
      emergency_contact_name: "Ngozi",
      emergency_contact_relationship: "",
      emergency_contact_phone: "+2348012345678",
    });
    expect(rowValues(null)).toEqual(EMPTY);
    expect(rowValues(undefined)).toEqual(EMPTY);
  });

  it("lists choices once each, in the order given", () => {
    expect(csvKeys("vegan, other,vegan,,halal ")).toEqual(["vegan", "other", "halal"]);
    expect(csvKeys("")).toEqual([]);
    expect(csvKeys(null)).toEqual([]);
  });
});

describe("the wedding anniversary check", () => {
  it("turns what was typed into a date, or clears it when empty", () => {
    expect(checkAnniversary("06/20/2009", adult)).toEqual({ ok: true, stored: { anniversary: "2009-06-20" } });
    expect(checkAnniversary("2009-06-20", adult)).toEqual({ ok: true, stored: { anniversary: "2009-06-20" } });
    expect(checkAnniversary("6/2/2019", adult)).toEqual({ ok: true, stored: { anniversary: "2019-06-02" } });
    expect(checkAnniversary("   ", adult)).toEqual({ ok: true, stored: { anniversary: "" } });
    expect(checkAnniversary("10/13/2026", adult)).toEqual({ ok: true, stored: { anniversary: "2026-10-13" } });
  });

  it("says in the database's words why a date cannot be kept", () => {
    expect(checkAnniversary("10/14/2026", adult)).toEqual({ ok: false, error: "The wedding anniversary cannot be in the future." });
    expect(checkAnniversary("01/01/1975", adult)).toEqual({ ok: false, error: "The wedding anniversary has to be after the birth date. Check the year." });
    expect(checkAnniversary("05/05/1980", adult)).toMatchObject({ ok: false });
    expect(checkAnniversary("02/30/2019", adult)).toMatchObject({ ok: false, error: expect.stringContaining("real date") });
    expect(checkAnniversary("soon", adult)).toMatchObject({ ok: false, error: expect.stringContaining("MM/DD/YYYY") });
    expect(checkAnniversary("06/20/2009", child)).toEqual({ ok: false, error: "A wedding anniversary can only be recorded for an adult." });
  });

  it("takes any date when the birth date is not known", () => {
    expect(checkAnniversary("01/01/1950", { ...adult, birthDate: null })).toEqual({ ok: true, stored: { anniversary: "1950-01-01" } });
  });
});

describe("the dietary needs check", () => {
  it("keeps the choices in the order given and stores the note next to them", () => {
    expect(checkDietary({ dietary: "halal,other,halal", dietary_other: "  エビ・カニにアレルギー " }, adult)).toEqual({
      ok: true,
      stored: { dietary: "halal,other", dietary_other: "エビ・カニにアレルギー" },
    });
    expect(checkDietary({ dietary: "", dietary_other: "" }, adult)).toEqual({ ok: true, stored: { dietary: "", dietary_other: "" } });
  });

  it("accepts only choices the community offers, and a switched-off one only while the person still has it", () => {
    expect(checkDietary({ dietary: "pizza", dietary_other: "" }, adult)).toMatchObject({ ok: false, error: expect.stringContaining("not on the community's list") });
    expect(checkDietary({ dietary: "Vegan", dietary_other: "" }, adult)).toMatchObject({ ok: false });
    expect(checkDietary({ dietary: "dairy_free", dietary_other: "" }, adult)).toMatchObject({ ok: false });
    expect(checkDietary({ dietary: "dairy_free,vegan", dietary_other: "" }, { ...adult, currentKeys: ["dairy_free"] })).toMatchObject({ ok: true });
  });

  it('needs "Other" before a note, and limits the note by characters (not bytes)', () => {
    expect(checkDietary({ dietary: "vegan", dietary_other: "no peanuts" }, adult)).toEqual({ ok: false, error: 'Choose "Other" to add a note of your own.' });
    const thai = "ก".repeat(NOTE_MAX);
    expect(checkDietary({ dietary: "other", dietary_other: thai }, adult)).toMatchObject({ ok: true });
    expect(checkDietary({ dietary: "other", dietary_other: `${thai}ก` }, adult)).toEqual({ ok: false, error: `The note can be at most ${NOTE_MAX} characters.` });
    expect(checkDietary({ dietary: "other", dietary_other: "" }, adult)).toMatchObject({ ok: true });
  });

  it("limits how many are chosen", () => {
    const many = { ...adult, options: Array.from({ length: CHOICES_MAX + 1 }, (_, i) => ({ key: `c${i}`, label: `C${i}`, active: true })) };
    const csv = many.options.map((o) => o.key).join(",");
    expect(checkDietary({ dietary: csv, dietary_other: "" }, many)).toEqual({ ok: false, error: `Choose at most ${CHOICES_MAX} dietary needs.` });
  });
});

describe("the emergency contact check", () => {
  it("saves a name, how they are related and a mobile number together, as an international number", () => {
    expect(checkEmergency({ emergency_contact_name: " Layla Haddad ", emergency_contact_relationship: "Sister ", emergency_contact_phone: "(713) 555-0100" })).toEqual({
      ok: true,
      stored: { emergency_contact_name: "Layla Haddad", emergency_contact_relationship: "Sister", emergency_contact_phone: "+17135550100" },
    });
    expect(checkEmergency({ emergency_contact_name: "田中 健", emergency_contact_relationship: "", emergency_contact_phone: "+81 3 9876 5432" })).toEqual({
      ok: true,
      stored: { emergency_contact_name: "田中 健", emergency_contact_relationship: "", emergency_contact_phone: "+81398765432" },
    });
  });

  it("clears the whole contact when all three are empty", () => {
    expect(checkEmergency({ emergency_contact_name: " ", emergency_contact_relationship: "", emergency_contact_phone: "" })).toEqual({
      ok: true,
      stored: { emergency_contact_name: "", emergency_contact_relationship: "", emergency_contact_phone: "" },
    });
  });

  it("needs a name and a mobile number together, in the database's words", () => {
    expect(checkEmergency({ emergency_contact_name: "Ngozi", emergency_contact_relationship: "", emergency_contact_phone: "" })).toEqual({ ok: false, error: PAIR_SENTENCE });
    expect(checkEmergency({ emergency_contact_name: "", emergency_contact_relationship: "", emergency_contact_phone: "(713) 555-0100" })).toEqual({ ok: false, error: PAIR_SENTENCE });
    expect(checkEmergency({ emergency_contact_name: "", emergency_contact_relationship: "Sister", emergency_contact_phone: "" })).toEqual({ ok: false, error: PAIR_SENTENCE });
  });

  it("asks for the country code when the number is not a US one, and refuses numbers that cannot be right", () => {
    expect(checkEmergency({ emergency_contact_name: "Ngozi", emergency_contact_relationship: "", emergency_contact_phone: "0801 234 5678" })).toMatchObject({ ok: false, error: expect.stringContaining("country code") });
    expect(checkEmergency({ emergency_contact_name: "Ngozi", emergency_contact_relationship: "", emergency_contact_phone: "+0123456789" })).toMatchObject({ ok: false, error: expect.stringContaining("country code") });
    expect(checkEmergency({ emergency_contact_name: "Ngozi", emergency_contact_relationship: "", emergency_contact_phone: "+12" })).toMatchObject({ ok: false });
  });

  it("limits the lengths by characters", () => {
    const base = { emergency_contact_name: "李".repeat(120), emergency_contact_relationship: "x".repeat(60), emergency_contact_phone: "+17135550100" };
    expect(checkEmergency(base)).toMatchObject({ ok: true });
    expect(checkEmergency({ ...base, emergency_contact_name: "李".repeat(121) })).toEqual({ ok: false, error: "The name can be at most 120 characters." });
    expect(checkEmergency({ ...base, emergency_contact_relationship: "x".repeat(61) })).toEqual({ ok: false, error: "How they are related can be at most 60 characters." });
  });
});

describe("each group as one click-to-edit thing", () => {
  const units = profileUnits(adult);

  it("shows an anniversary the way it is typed, and sends only what changed with the value the person saw", () => {
    const committed = { ...EMPTY, anniversary: "2009-06-20" };
    const started = run(units.anniversary, committed, [{ type: "start" }]);
    expect(started.draft.anniversary).toBe("06/20/2009");
    const saving = run(units.anniversary, committed, [{ type: "start" }, { type: "change", key: "anniversary", value: "7/4/2010" }, { type: "submit" }]);
    expect(saving.phase).toBe("saving");
    expect(saving.pending).toEqual({ fields: { anniversary: "2010-07-04" }, expect: { anniversary: "2009-06-20" }, reason: null });
    const unchanged = run(units.anniversary, committed, [{ type: "start" }, { type: "submit" }]);
    expect(unchanged.phase).toBe("idle");
  });

  it("keeps what was typed and says why when the date cannot be kept", () => {
    const s = run(units.anniversary, EMPTY, [{ type: "start" }, { type: "change", key: "anniversary", value: "10/14/2026" }, { type: "submit" }]);
    expect(s.phase).toBe("editing");
    expect(s.problem).toBe("The wedding anniversary cannot be in the future.");
    expect(s.draft.anniversary).toBe("10/14/2026");
  });

  it("saves the dietary choices and their note together, and dropping Other drops the note with it", () => {
    const committed = { ...EMPTY, dietary: "vegan,other", dietary_other: "no mushrooms" };
    const dropped = toggleChoice({ dietary: committed.dietary, dietary_other: committed.dietary_other }, "other");
    expect(dropped).toEqual({ dietary: "vegan", dietary_other: "" });
    const s = run(units.dietary, committed, [
      { type: "start" },
      { type: "change", key: "dietary", value: dropped.dietary },
      { type: "change", key: "dietary_other", value: dropped.dietary_other },
      { type: "submit" },
    ]);
    expect(s.phase).toBe("saving");
    expect(s.pending).toEqual({ fields: { dietary: "vegan", dietary_other: "" }, expect: { dietary: "vegan,other", dietary_other: "no mushrooms" }, reason: null });
  });

  it("sends only the dietary choices when the note did not change", () => {
    const committed = { ...EMPTY, dietary: "vegan" };
    const next = toggleChoice({ dietary: "vegan", dietary_other: "" }, "halal");
    const s = run(units.dietary, committed, [{ type: "start" }, { type: "change", key: "dietary", value: next.dietary }, { type: "submit" }]);
    expect(s.pending?.fields).toEqual({ dietary: "vegan,halal" });
  });

  it("saves the emergency contact as one unit, the number as an international number", () => {
    const committed = { ...EMPTY, emergency_contact_name: "Layla Haddad", emergency_contact_relationship: "Sister", emergency_contact_phone: "+17135550100" };
    const started = run(units.emergency, committed, [{ type: "start" }]);
    expect(started.draft).toEqual({ emergency_contact_name: "Layla Haddad", emergency_contact_relationship: "Sister", emergency_contact_phone: "(713) 555-0100" });
    const s = run(units.emergency, committed, [
      { type: "start" },
      { type: "change", key: "emergency_contact_name", value: "Ngozi Okonkwo" },
      { type: "change", key: "emergency_contact_phone", value: "+234 801 234 5678" },
      { type: "submit" },
    ]);
    expect(s.pending).toEqual({
      fields: { emergency_contact_name: "Ngozi Okonkwo", emergency_contact_phone: "+2348012345678" },
      expect: { emergency_contact_name: "Layla Haddad", emergency_contact_phone: "+17135550100" },
      reason: null,
    });
  });

  it("does not save half a contact", () => {
    const s = run(units.emergency, EMPTY, [{ type: "start" }, { type: "change", key: "emergency_contact_name", value: "Ngozi" }, { type: "submit" }]);
    expect(s.phase).toBe("editing");
    expect(s.problem).toBe(PAIR_SENTENCE);
  });

  it("shows a conflict and lets the person use theirs, which refreshes the whole group", () => {
    const committed = { ...EMPTY, dietary: "vegan", dietary_other: "" };
    const saving = run(units.dietary, committed, [{ type: "start" }, { type: "change", key: "dietary", value: "vegan,halal" }, { type: "submit" }]);
    const conflicted = reduce(saving, { type: "conflicted", theirs: { dietary: "vegetarian,other", dietary_other: "no onions" }, who: "Ravi", at: null }, units.dietary, { today: "" });
    expect(conflicted.phase).toBe("conflict");
    const theirs = reduce(conflicted, { type: "use_theirs" }, units.dietary, { today: "" });
    expect(theirs.phase).toBe("idle");
    expect(theirs.committed).toEqual({ dietary: "vegetarian,other", dietary_other: "no onions" });
    const mine = reduce(conflicted, { type: "keep_mine" }, units.dietary, { today: "" });
    expect(mine.phase).toBe("saving");
    expect(mine.pending?.expect).toEqual({ dietary: "vegetarian,other" });
  });

  it("restores the old value and keeps what was typed when a save fails", () => {
    const saving = run(units.anniversary, EMPTY, [{ type: "start" }, { type: "change", key: "anniversary", value: "07/04/2010" }, { type: "submit" }]);
    const failed = reduce(saving, { type: "failed", message: "Could not save Samira's wedding anniversary — the server did not respond. Try again." }, units.anniversary, { today: "" });
    expect(failed.phase).toBe("error");
    expect(failed.committed.anniversary).toBe("");
    expect(failed.draft.anniversary).toBe("07/04/2010");
    expect(failed.message).toContain("Try again");
  });

  it("refuses an anniversary for a child, even if one were sent", () => {
    const c = profileUnits(child);
    const s = run(c.anniversary, EMPTY, [{ type: "start" }, { type: "change", key: "anniversary", value: "06/20/2009" }, { type: "submit" }]);
    expect(s.problem).toBe("A wedding anniversary can only be recorded for an adult.");
  });
});

describe("choosing dietary needs", () => {
  it("offers the community's active choices in its own order, then any choice the person has that is no longer offered", () => {
    const chips = dietaryChips(OPTIONS, ["dairy_free", "vegan"], "dairy_free,vegan");
    expect(chips.map((c) => `${c.key}:${c.selected ? "on" : "off"}${c.retired ? ":retired" : ""}`)).toEqual([
      "vegetarian:off",
      "vegan:on",
      "halal:off",
      "other:off",
      "dairy_free:on:retired",
    ]);
    expect(chips.find((c) => c.key === "halal")?.label).toBe("حلال");
  });

  it("still names a choice that is no longer in the list at all", () => {
    const chips = dietaryChips(OPTIONS, ["kosher_style"], "kosher_style");
    expect(chips.at(-1)).toEqual({ key: "kosher_style", label: "Kosher style", selected: true, retired: true });
  });

  it("lets a retired choice be taken away, and does not offer it again once it is", () => {
    const after = toggleChoice({ dietary: "dairy_free,vegan", dietary_other: "" }, "dairy_free");
    expect(after.dietary).toBe("vegan");
    expect(dietaryChips(OPTIONS, [], after.dietary).some((c) => c.key === "dairy_free")).toBe(false);
  });

  it("adds a choice after the ones already chosen", () => {
    expect(toggleChoice({ dietary: "vegan", dietary_other: "x" }, "halal")).toEqual({ dietary: "vegan,halal", dietary_other: "x" });
    expect(toggleChoice({ dietary: "", dietary_other: "" }, "other")).toEqual({ dietary: "other", dietary_other: "" });
  });
});

describe("the patch the database function receives", () => {
  it("holds only the fields that were sent, an empty one as null, and the choices as a list", () => {
    expect(encodePatch({ dietary: "vegan,other", dietary_other: "no mushrooms" })).toEqual({ dietary: ["vegan", "other"], dietary_other: "no mushrooms" });
    expect(encodePatch({ anniversary: "2010-07-04" })).toEqual({ anniversary: "2010-07-04" });
    expect(encodePatch({ anniversary: "" })).toEqual({ anniversary: null });
    expect(encodePatch({ dietary: "", dietary_other: "" })).toEqual({ dietary: null, dietary_other: null });
    expect(encodePatch({ emergency_contact_phone: "+17135550100" })).toEqual({ emergency_contact_phone: "+17135550100" });
    expect(Object.keys(encodePatch({ emergency_contact_name: "" }))).toEqual(["emergency_contact_name"]);
  });

  it("carries other scripts as they are, trimmed, and drops anything that is not one of the six fields", () => {
    expect(encodePatch({ dietary_other: " ไม่ทานถั่วลิสง ", emergency_contact_name: "田中 健" })).toEqual({ dietary_other: "ไม่ทานถั่วลิสง", emergency_contact_name: "田中 健" });
    expect(encodePatch({ center_id: "x", person_id: "y", first_name: "Z" })).toEqual({});
  });
});

describe("the shape of a request from the browser", () => {
  const ok = { fields: { dietary: "vegan" }, expect: { dietary: "" }, label: "Samira's dietary needs" };

  it("accepts a well-formed request, with or without a reason", () => {
    expect(profileShapeProblem(ok)).toBeNull();
    expect(profileShapeProblem({ ...ok, reason: "Undo of dietary needs change" })).toBeNull();
    expect(profileShapeProblem({ ...ok, reason: null })).toBeNull();
    expect(profileShapeProblem({ fields: { anniversary: "" }, expect: { anniversary: "2009-06-20" }, label: "x" })).toBeNull();
  });

  it("refuses anything that is not one of the six fields, in the fields or in what was seen", () => {
    expect(profileShapeProblem({ ...ok, fields: { dietary: "vegan", center_id: "x" } })).toMatch(/cannot be changed here/);
    expect(profileShapeProblem({ ...ok, expect: { person_id: "x" } })).toMatch(/cannot be changed here/);
    expect(profileShapeProblem({ ...ok, fields: { first_name: "x" } })).toMatch(/cannot be changed here/);
  });

  it("refuses an empty, malformed or oversized request", () => {
    expect(profileShapeProblem(null)).toBe("the request was not understood");
    expect(profileShapeProblem("x")).toBe("the request was not understood");
    expect(profileShapeProblem({ ...ok, fields: {} })).toBe("there was nothing to change");
    expect(profileShapeProblem({ ...ok, fields: [] })).toBe("the request was not understood");
    expect(profileShapeProblem({ ...ok, expect: undefined })).toBe("the request was not understood");
    expect(profileShapeProblem({ ...ok, label: "x".repeat(121) })).toBe("the request was not understood");
    expect(profileShapeProblem({ ...ok, fields: { dietary_other: "x".repeat(2001) } })).toBe("a value is too long");
    expect(profileShapeProblem({ ...ok, fields: { dietary_other: 7 as unknown as string } })).toBe("a value is too long");
    expect(profileShapeProblem({ ...ok, reason: "x".repeat(2001) })).toBe("the reason is too long");
  });

  it("refuses a date, a choice or a number in a form the database would not take", () => {
    expect(profileShapeProblem({ ...ok, fields: { anniversary: "06/20/2009" } })).toBe("the date was not understood");
    expect(profileShapeProblem({ ...ok, fields: { dietary: "Vegan; drop table" } })).toBe("a dietary choice was not understood");
    expect(profileShapeProblem({ ...ok, fields: { dietary: Array.from({ length: 21 }, (_, i) => `c${i}`).join(",") } })).toBe("a dietary choice was not understood");
    expect(profileShapeProblem({ ...ok, fields: { emergency_contact_phone: "713 555 0100" } })).toMatch(/country code/);
  });
});

describe("comparing values for the conflict check", () => {
  it("treats nothing and empty text as the same, and the dietary choices as the same in any order", () => {
    expect(sameProfileValue("anniversary", null, "")).toBe(true);
    expect(sameProfileValue("anniversary", "2009-06-20", " 2009-06-20 ")).toBe(true);
    expect(sameProfileValue("anniversary", "2009-06-20", "2010-06-20")).toBe(false);
    expect(sameProfileValue("dietary", "vegan,halal", "halal,vegan")).toBe(true);
    expect(sameProfileValue("dietary", "vegan", "vegan,halal")).toBe(false);
    expect(sameProfileValue("emergency_contact_name", "田中 健", "田中 健")).toBe(true);
    expect(sameProfileValue("emergency_contact_name", "田中 健", "田中 剛")).toBe(false);
  });

  it("names the fields someone else changed since the person looked, and none when nothing was seen", () => {
    const now: Values = { ...EMPTY, dietary: "vegan", emergency_contact_name: "Layla" };
    expect(profileConflictKeys({ dietary: "vegan,halal", emergency_contact_name: "Layla" }, now, ["dietary", "emergency_contact_name"])).toEqual(["dietary"]);
    expect(profileConflictKeys({ dietary: "vegan" }, now, ["dietary"])).toEqual([]);
    expect(profileConflictKeys(null, now, ["dietary"])).toEqual([]);
    expect(profileConflictKeys({}, now, ["dietary"])).toEqual([]);
  });

  it("knows when everything asked for is already there", () => {
    const now: Values = { ...EMPTY, dietary: "vegan,halal" };
    expect(nothingToChange({ dietary: "halal,vegan" }, now)).toBe(true);
    expect(nothingToChange({ dietary: "halal" }, now)).toBe(false);
    expect(nothingToChange({ anniversary: "" }, now)).toBe(true);
  });
});

describe("the sentences", () => {
  it("reads each group the way the page shows it", () => {
    const v: Values = {
      anniversary: "2009-06-20",
      dietary: "vegetarian,dairy_free,other",
      dietary_other: "ไม่ทานถั่วลิสง",
      emergency_contact_name: "田中 健",
      emergency_contact_relationship: "Brother",
      emergency_contact_phone: "+81398765432",
    };
    expect(describeGroup("anniversary", v, OPTIONS)).toBe("06/20/2009");
    expect(describeGroup("dietary", v, OPTIONS)).toBe("Vegetarian, Dairy-free (no longer offered), Other: ไม่ทานถั่วลิสง");
    expect(describeGroup("emergency", v, OPTIONS)).toBe("田中 健 (brother) · +81398765432");
    expect(describeGroup("emergency", { ...v, emergency_contact_phone: "+17135550100", emergency_contact_relationship: "" }, OPTIONS)).toBe("田中 健 · (713) 555-0100");
    expect(describeGroup("anniversary", EMPTY, OPTIONS)).toBe("");
    expect(describeGroup("dietary", EMPTY, OPTIONS)).toBe("");
    expect(describeGroup("emergency", EMPTY, OPTIONS)).toBe("");
    expect(dietaryText("halal", "", OPTIONS)).toBe("حلال");
    expect(emergencyText(EMPTY)).toBe("");
  });

  it("says who changed it and when, with their value", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    expect(profileConflictLine({ who: "Ravi", at: "2026-10-13T11:58:50Z", theirs: "Vegan" }, now)).toBe("Ravi changed this a minute ago to Vegan. Your change was not saved.");
    expect(profileConflictLine({ who: null, at: null, theirs: "" }, now)).toBe("Someone changed this a moment ago to empty. Your change was not saved.");
  });
});
