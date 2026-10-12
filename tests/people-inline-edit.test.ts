import { describe, expect, it } from "vitest";

import {
  CONFLICT_PREFIX,
  DEFAULT_REASON,
  HOUSEHOLD_UNITS,
  PERSON_UNITS,
  ageCrossing,
  agoText,
  checkDraft,
  conflictKeys,
  conflictLine,
  conflictSentence,
  displayValue,
  expectText,
  friendlySaveError,
  initialEdit,
  isConflictMessage,
  normalizeStored,
  parseExpect,
  possessive,
  reduce,
  sameValue,
  savedSentence,
  toDraft,
  undoReason,
  type CheckContext,
  type EditEvent,
  type EditState,
  type EditUnit,
} from "@/lib/people-v2/inline-edit";

const ZONE = "9a000000-0000-4000-8000-000000000001";
const ctx: CheckContext = { today: "2026-10-12", languages: ["en", "es", "yo"], zoneIds: [ZONE] };

function run(u: EditUnit, start: Record<string, string>, events: EditEvent[], c: CheckContext = ctx): EditState {
  return events.reduce((s, e) => reduce(s, e, u, c), initialEdit(u, start));
}

describe("checkDraft", () => {
  it("turns a typed mobile number into the stored one, and refuses one without an area code", () => {
    expect(checkDraft(PERSON_UNITS.mobile, { phone_e164: "(713) 555-0136" }, ctx)).toEqual({ ok: true, stored: { phone_e164: "+17135550136" } });
    expect(checkDraft(PERSON_UNITS.mobile, { phone_e164: "555-0136" }, ctx)).toMatchObject({ ok: false });
    expect(checkDraft(PERSON_UNITS.mobile, { phone_e164: "+234 803 555 0152" }, ctx)).toEqual({ ok: true, stored: { phone_e164: "+2348035550152" } });
    expect(checkDraft(PERSON_UNITS.mobile, { phone_e164: "" }, ctx)).toEqual({ ok: true, stored: { phone_e164: "" } });
  });

  it("lower-cases an email and refuses one that does not look right", () => {
    expect(checkDraft(PERSON_UNITS.email, { email: " Samira.Hassan@Example.org " }, ctx)).toEqual({ ok: true, stored: { email: "samira.hassan@example.org" } });
    expect(checkDraft(PERSON_UNITS.email, { email: "samira@" }, ctx)).toEqual({ ok: false, error: "That email address does not look right" });
  });

  it("takes names in any script, and needs both", () => {
    expect(checkDraft(PERSON_UNITS.name, { first_name: "太郎", last_name: "山田" }, ctx)).toEqual({ ok: true, stored: { first_name: "太郎", last_name: "山田" } });
    expect(checkDraft(PERSON_UNITS.name, { first_name: "Фёдор", last_name: "Иванов" }, ctx).ok).toBe(true);
    expect(checkDraft(PERSON_UNITS.name, { first_name: "عمر", last_name: "" }, ctx)).toEqual({ ok: false, error: "Last name is required" });
  });

  it("reads a birth date as MM/DD/YYYY and refuses a future one", () => {
    expect(checkDraft(PERSON_UNITS.dob, { date_of_birth: "03/14/1984" }, ctx)).toEqual({ ok: true, stored: { date_of_birth: "1984-03-14" } });
    expect(checkDraft(PERSON_UNITS.dob, { date_of_birth: "01/01/2030" }, ctx)).toEqual({ ok: false, error: "The date of birth is in the future" });
    expect(checkDraft(PERSON_UNITS.dob, { date_of_birth: "14 March" }, ctx).ok).toBe(false);
  });

  it("limits the language to the community's own", () => {
    expect(checkDraft(PERSON_UNITS.language, { language: "yo" }, ctx)).toEqual({ ok: true, stored: { language: "yo" } });
    const out = checkDraft(PERSON_UNITS.language, { language: "ja" }, ctx);
    expect(out.ok).toBe(false);
  });

  it("checks a relationship against the list", () => {
    expect(checkDraft(PERSON_UNITS.relationship, { role: "parent" }, ctx)).toEqual({ ok: true, stored: { role: "parent" } });
    expect(checkDraft(PERSON_UNITS.relationship, { role: "primary" }, ctx).ok).toBe(false);
  });

  it("checks an address as a block, a zone against the community's zones, and a switch as on or off", () => {
    const address = { address_line1: "14 Maple Court", address_line2: "", city: "Riverside", state_region: "TX", postal_code: "77030", zone_id: "" };
    expect(checkDraft(HOUSEHOLD_UNITS.address, address, ctx)).toEqual({ ok: true, stored: address });
    expect(checkDraft(HOUSEHOLD_UNITS.address, { ...address, postal_code: "??" }, ctx).ok).toBe(false);
    expect(checkDraft(HOUSEHOLD_UNITS.address, { ...address, zone_id: "not-a-zone" }, ctx).ok).toBe(false);
    expect(checkDraft(HOUSEHOLD_UNITS.address, { ...address, zone_id: ZONE }, ctx)).toMatchObject({ ok: true });
    expect(checkDraft(HOUSEHOLD_UNITS.directory, { directory_opt_in: "on" }, ctx)).toEqual({ ok: true, stored: { directory_opt_in: "on" } });
    expect(checkDraft(HOUSEHOLD_UNITS.mail, { physical_mail_opt_in: "off" }, ctx)).toEqual({ ok: true, stored: { physical_mail_opt_in: "off" } });
  });

  it("takes a note, trims it and clears it when empty", () => {
    expect(checkDraft(HOUSEHOLD_UNITS.notes, { notes: "  Prefers evening calls.  " }, ctx)).toEqual({ ok: true, stored: { notes: "Prefers evening calls." } });
    expect(checkDraft(HOUSEHOLD_UNITS.notes, { notes: "   " }, ctx)).toEqual({ ok: true, stored: { notes: "" } });
  });
});

describe("showing values", () => {
  it("shows a stored value the way a person reads it, and turns it back into a draft", () => {
    expect(displayValue("phone_e164", "+17135550136")).toBe("(713) 555-0136");
    expect(displayValue("date_of_birth", "1984-03-14")).toBe("03/14/1984");
    expect(displayValue("gender", "female")).toBe("Female");
    expect(displayValue("language", "yo")).toBe("Yoruba");
    expect(displayValue("role", "spouse")).toBe("Spouse");
    expect(displayValue("email", "")).toBe("");
    expect(toDraft("phone_e164", "+17135550136")).toBe("(713) 555-0136");
    expect(toDraft("date_of_birth", "1984-03-14")).toBe("03/14/1984");
  });
});

describe("sameValue", () => {
  it("counts nothing, an empty string and null as the same", () => {
    expect(sameValue("profession", null, "")).toBe(true);
    expect(sameValue("profession", undefined, " ")).toBe(true);
    expect(sameValue("profession", "Nurse", "Teacher")).toBe(false);
  });
  it("ignores the case of an email and of a language code, and reads a legacy gender", () => {
    expect(sameValue("email", "A@B.org", "a@b.org")).toBe(true);
    expect(sameValue("language", "pt-BR", "pt-br")).toBe(true);
    expect(sameValue("gender", "F", "female")).toBe(true);
    expect(sameValue("gender", "F", "male")).toBe(false);
  });
  it("reads switches as on or off whatever way they were written", () => {
    expect(sameValue("directory_opt_in", true, "on")).toBe(true);
    expect(sameValue("directory_opt_in", false, "off")).toBe(true);
    expect(sameValue("physical_mail_opt_in", true, "off")).toBe(false);
    expect(normalizeStored("physical_mail_opt_in", "true")).toBe("on");
  });
});

describe("expect", () => {
  it("reads nothing as no expectation, and refuses what is not JSON", () => {
    expect(parseExpect(undefined)).toEqual({ ok: true, value: null });
    expect(parseExpect("  ")).toEqual({ ok: true, value: null });
    expect(parseExpect("not json")).toMatchObject({ ok: false });
    expect(parseExpect("[1]")).toMatchObject({ ok: false });
    expect(parseExpect('{"city": 5}')).toMatchObject({ ok: false });
  });
  it("round-trips what a screen sends", () => {
    const sent = expectText({ phone_e164: "+17135550136", notes: "" });
    expect(parseExpect(sent)).toEqual({ ok: true, value: { phone_e164: "+17135550136", notes: "" } });
    expect(parseExpect('{"directory_opt_in": true}')).toEqual({ ok: true, value: { directory_opt_in: "on" } });
  });
  it("finds the fields that changed under the person, and only among those about to change", () => {
    const current = { phone_e164: "+18325550199", email: "a@b.org", city: "Riverside" };
    expect(conflictKeys({ phone_e164: "+18325550101", email: "a@b.org" }, current, ["phone_e164"])).toEqual(["phone_e164"]);
    expect(conflictKeys({ phone_e164: "+18325550199" }, current, ["phone_e164"])).toEqual([]);
    // someone else changed the email, but this edit is only the mobile: no conflict
    expect(conflictKeys({ phone_e164: "+18325550199", email: "old@b.org" }, current, ["phone_e164"])).toEqual([]);
    expect(conflictKeys(null, current, ["phone_e164"])).toEqual([]);
  });
  it("words a conflict so a screen can recognise it", () => {
    const text = conflictSentence(["phone_e164", "email"]);
    expect(text.startsWith(CONFLICT_PREFIX)).toBe(true);
    expect(text).toContain("mobile and email");
    expect(isConflictMessage(text)).toBe(true);
    expect(isConflictMessage("Could not save the profile — the person was not found.")).toBe(false);
  });
});

describe("ageCrossing", () => {
  const base = { firstName: "Aarav", today: "2026-10-12", majority: 18 };
  it("says when a birth date makes an adult a child, and the other way round", () => {
    expect(ageCrossing({ ...base, before: "1984-01-01", after: "2014-05-05" })).toBe("This makes Aarav 12, a child");
    expect(ageCrossing({ ...base, before: "2014-05-05", after: "1984-01-01" })).toBe("This makes Aarav 42, an adult");
  });
  it("stays quiet when nobody changes class, or the date is cleared", () => {
    expect(ageCrossing({ ...base, before: "1984-01-01", after: "1985-01-01" })).toBeNull();
    expect(ageCrossing({ ...base, before: "2014-05-05", after: "2015-05-05" })).toBeNull();
    expect(ageCrossing({ ...base, before: "2014-05-05", after: "" })).toBeNull();
  });
  it("warns about a child's date when none was recorded, and uses the community's age of majority", () => {
    expect(ageCrossing({ ...base, before: null, after: "2014-05-05" })).toBe("This makes Aarav 12, a child");
    expect(ageCrossing({ ...base, before: null, after: "1990-05-05" })).toBeNull();
    expect(ageCrossing({ ...base, majority: 21, before: "2000-01-01", after: "2007-01-01" })).toBe("This makes Aarav 19, a child");
  });
});

describe("the state of one edit", () => {
  const mobile = PERSON_UNITS.mobile;
  const start = { phone_e164: "+17135550136" };

  it("opens with the value as a person reads it, saves a changed one, and keeps the saved value", () => {
    let s = run(mobile, start, [{ type: "start" }]);
    expect(s.phase).toBe("editing");
    expect(s.draft.phone_e164).toBe("(713) 555-0136");
    s = run(mobile, start, [{ type: "start" }, { type: "change", key: "phone_e164", value: "(832) 555-0199" }, { type: "submit" }]);
    expect(s.phase).toBe("saving");
    expect(s.pending).toEqual({ fields: { phone_e164: "+18325550199" }, expect: { phone_e164: "+17135550136" }, reason: null });
    s = reduce(s, { type: "saved" }, mobile, ctx);
    expect(s.phase).toBe("idle");
    expect(s.committed.phone_e164).toBe("+18325550199");
    expect(s.draft.phone_e164).toBe("(832) 555-0199");
  });

  it("saves nothing when nothing changed, and Escape puts the old value back", () => {
    expect(run(mobile, start, [{ type: "start" }, { type: "submit" }]).phase).toBe("idle");
    const s = run(mobile, start, [{ type: "start" }, { type: "change", key: "phone_e164", value: "12" }, { type: "cancel" }]);
    expect(s.phase).toBe("idle");
    expect(s.draft.phone_e164).toBe("(713) 555-0136");
  });

  it("keeps the field open with the sentence under it when what was typed is wrong, and keeps the typing", () => {
    const s = run(mobile, start, [{ type: "start" }, { type: "change", key: "phone_e164", value: "555-01" }, { type: "submit" }]);
    expect(s.phase).toBe("editing");
    expect(s.problem).toMatch(/area code/);
    expect(s.draft.phone_e164).toBe("555-01");
  });

  it("restores nothing it should not: a failed save keeps what was typed, shows the words, and a retry sends it again", () => {
    let s = run(mobile, start, [{ type: "start" }, { type: "change", key: "phone_e164", value: "(832) 555-0199" }, { type: "submit" }]);
    s = reduce(s, { type: "failed", message: "Could not save Tunde's mobile — the server did not answer." }, mobile, ctx);
    expect(s.phase).toBe("error");
    expect(s.message).toMatch(/Could not save/);
    expect(s.draft.phone_e164).toBe("(832) 555-0199");
    expect(s.committed.phone_e164).toBe("+17135550136");
    s = reduce(s, { type: "submit" }, mobile, ctx);
    expect(s.phase).toBe("saving");
    expect(s.pending?.fields.phone_e164).toBe("+18325550199");
  });

  it("a name needs a reason: the default one, or the one chosen; leaving it unchanged is no save", () => {
    const name = PERSON_UNITS.name;
    const begin = { first_name: "Samira", last_name: "Hassan" };
    const typed: EditEvent[] = [{ type: "start" }, { type: "change", key: "first_name", value: "Samira-Jane" }];
    expect(run(name, begin, [...typed, { type: "submit" }]).pending).toEqual({
      fields: { first_name: "Samira-Jane" },
      expect: { first_name: "Samira" },
      reason: DEFAULT_REASON,
    });
    expect(run(name, begin, [...typed, { type: "reason", value: "Married" }, { type: "submit" }]).pending?.reason).toBe("Married");
    expect(run(name, begin, [{ type: "start" }, { type: "reason", value: "Married" }, { type: "submit" }]).phase).toBe("idle");
  });

  it("sends only the fields of an address that changed, and the values it saw for them", () => {
    const address = HOUSEHOLD_UNITS.address;
    const begin = { address_line1: "14 Maple Court", address_line2: "", city: "Riverside", state_region: "TX", postal_code: "77030", zone_id: "" };
    const s = run(address, begin, [{ type: "start" }, { type: "change", key: "address_line1", value: "16 Maple Court" }, { type: "submit" }]);
    expect(s.pending).toEqual({ fields: { address_line1: "16 Maple Court" }, expect: { address_line1: "14 Maple Court" }, reason: null });
  });

  it("shows the conflict, and Use theirs adopts the new value without saving anything", () => {
    let s = run(mobile, start, [{ type: "start" }, { type: "change", key: "phone_e164", value: "(713) 555-0100" }, { type: "submit" }]);
    s = reduce(s, { type: "conflicted", theirs: { phone_e164: "+18325550199" }, who: "Ravi", at: "2026-10-12T10:00:00Z" }, mobile, ctx);
    expect(s.phase).toBe("conflict");
    expect(s.conflict?.who).toBe("Ravi");
    const adopted = reduce(s, { type: "use_theirs" }, mobile, ctx);
    expect(adopted.phase).toBe("idle");
    expect(adopted.committed.phone_e164).toBe("+18325550199");
    expect(adopted.draft.phone_e164).toBe("(832) 555-0199");
    expect(adopted.pending).toBeNull();
  });

  it("Keep mine sends the same change again, now expecting the value they wrote", () => {
    let s = run(mobile, start, [{ type: "start" }, { type: "change", key: "phone_e164", value: "(713) 555-0100" }, { type: "submit" }]);
    s = reduce(s, { type: "conflicted", theirs: { phone_e164: "+18325550199" }, who: null, at: null }, mobile, ctx);
    s = reduce(s, { type: "keep_mine" }, mobile, ctx);
    expect(s.phase).toBe("saving");
    expect(s.pending).toEqual({ fields: { phone_e164: "+17135550100" }, expect: { phone_e164: "+18325550199" }, reason: null });
  });

  it("adopts new values from the page only while idle, so typing is never overwritten", () => {
    const idle = reduce(initialEdit(mobile, start), { type: "sync", values: { phone_e164: "+18325550199" } }, mobile, ctx);
    expect(idle.committed.phone_e164).toBe("+18325550199");
    const typing = run(mobile, start, [{ type: "start" }, { type: "change", key: "phone_e164", value: "(713) 555-0100" }]);
    const kept = reduce(typing, { type: "sync", values: { phone_e164: "+18325550199" } }, mobile, ctx);
    expect(kept.draft.phone_e164).toBe("(713) 555-0100");
    expect(kept.committed.phone_e164).toBe("+17135550136");
  });

  it("ignores events that do not belong to the phase it is in", () => {
    const idle = initialEdit(mobile, start);
    expect(reduce(idle, { type: "saved" }, mobile, ctx)).toBe(idle);
    expect(reduce(idle, { type: "failed", message: "x" }, mobile, ctx)).toBe(idle);
    expect(reduce(idle, { type: "submit" }, mobile, ctx)).toBe(idle);
    const saving = run(mobile, start, [{ type: "start" }, { type: "change", key: "phone_e164", value: "(832) 555-0199" }, { type: "submit" }]);
    expect(reduce(saving, { type: "cancel" }, mobile, ctx)).toBe(saving);
    expect(reduce(saving, { type: "change", key: "phone_e164", value: "1" }, mobile, ctx)).toBe(saving);
  });
});

describe("sentences", () => {
  it("says what was saved, whose it was and how an undo reads in the history", () => {
    expect(savedSentence("Tunde", "mobile")).toBe("Saved Tunde's mobile");
    expect(savedSentence("James", "email")).toBe("Saved James' email");
    expect(savedSentence("Фёдор", "email")).toBe("Saved Фёдор's email");
    expect(possessive("")).toBe("their");
    expect(undoReason("mobile", null)).toBe("Undo of mobile change");
    expect(undoReason("name", "Married")).toBe("Undo of name change (Married)");
  });

  it("tells a refusal for lack of permission from a conflict and from any other failure", () => {
    expect(friendlySaveError("Could not save the profile — you don't have permission (needs people.manage).", "Tunde's mobile")).toEqual({
      message: "You don't have access to this area. Tunde's mobile was not changed.",
      kind: "access",
    });
    expect(friendlySaveError(conflictSentence(["phone_e164"]), "Tunde's mobile").kind).toBe("conflict");
    expect(friendlySaveError("Could not save — this needs a fresh 2FA check.", "x").kind).toBe("step_up");
    expect(friendlySaveError("Could not save Tunde's profile — the number needs an area code.", "x")).toEqual({
      message: "Could not save Tunde's profile — the number needs an area code.",
      kind: "other",
    });
  });

  it("says how long ago, and writes the conflict line with the new value", () => {
    const now = new Date("2026-10-12T10:05:00Z");
    expect(agoText("2026-10-12T10:04:20Z", now)).toBe("a moment ago");
    expect(agoText("2026-10-12T10:03:30Z", now)).toBe("a minute ago");
    expect(agoText("2026-10-12T09:35:00Z", now)).toBe("30 minutes ago");
    expect(agoText("2026-10-12T08:00:00Z", now)).toBe("2 hours ago");
    expect(agoText("2026-10-10T08:00:00Z", now)).toBe("2 days ago");
    expect(agoText(null, now)).toBe("a moment ago");
    expect(conflictLine({ who: "Ravi", at: "2026-10-12T10:03:30Z", keys: ["phone_e164"], theirs: { phone_e164: "+18325550199" } }, now)).toBe(
      "Ravi changed this a minute ago to (832) 555-0199. Your change was not saved.",
    );
    expect(conflictLine({ who: null, at: null, keys: ["profession"], theirs: { profession: "" } }, now)).toBe("Someone changed this a moment ago to empty. Your change was not saved.");
  });
});
