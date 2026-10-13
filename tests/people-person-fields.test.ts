import { describe, expect, it } from "vitest";

import { changedKeys, parsePersonForm, callTimeLabel, dailyMinutesLabel, contactChannelLabel, ADULT_ONLY_FIELDS, SCREEN_ONLY_FIELDS } from "@/lib/people";
import { changedFields } from "@/lib/activity";
import { contactChannelsOf, personValues, preferenceValues } from "@/lib/people-v2/family-model";
import {
  PERSON_EDITABLE,
  PERSON_UNITS,
  checkDraft,
  conflictKeys,
  conflictLine,
  displayValue,
  initialEdit,
  normalizeStored,
  reduce,
  sameValue,
  toDraft,
  type CheckContext,
  type EditEvent,
  type EditUnit,
} from "@/lib/people-v2/inline-edit";
import { reachedByLine } from "@/lib/people-v2/slideover";

// The five details of a person's record that were read-only until now: the name they go by, interests, expertise areas, the best time
// to call and the daily learning goal. The pure core: parsing, the stored text of a list, "did it change", the edit state machine.

const ctx: CheckContext = { today: "2026-10-12", languages: ["en", "es"], zoneIds: [] };
const run = (u: EditUnit, start: Record<string, string>, events: EditEvent[]) => events.reduce((s, e) => reduce(s, e, u, ctx), initialEdit(u, start));

describe("parsePersonForm: the five details", () => {
  it("takes a preferred name in any script, trims it, and empty clears it", () => {
    expect(parsePersonForm({ preferred_name: "  Sami " }, ctx.today)).toEqual({ ok: true, value: { preferred_name: "Sami" } });
    expect(parsePersonForm({ preferred_name: "美咲" }, ctx.today)).toEqual({ ok: true, value: { preferred_name: "美咲" } });
    expect(parsePersonForm({ preferred_name: "Айгуль" }, ctx.today)).toEqual({ ok: true, value: { preferred_name: "Айгуль" } });
    expect(parsePersonForm({ preferred_name: "  " }, ctx.today)).toEqual({ ok: true, value: { preferred_name: null } });
  });

  it("takes interests and expertise areas as lists, from text or from the stored JSON, in any script", () => {
    expect(parsePersonForm({ interests: "chess, 茶道, ગુજરાતી" }, ctx.today)).toEqual({ ok: true, value: { interests: ["chess", "茶道", "ગુજરાતી"] } });
    expect(parsePersonForm({ expertise_tags: '["Law","tax"]' }, ctx.today)).toEqual({ ok: true, value: { expertise_tags: ["Law", "tax"] } });
    expect(parsePersonForm({ interests: "" }, ctx.today)).toEqual({ ok: true, value: { interests: [] } });
  });

  it("refuses a list that is too long, in words", () => {
    const many = Array.from({ length: 21 }, (_, i) => `i${i}`).join(",");
    expect(parsePersonForm({ interests: many }, ctx.today)).toEqual({ ok: false, error: "Add at most 20 interests" });
  });

  it("takes only morning, afternoon or evening for the call time", () => {
    expect(parsePersonForm({ best_call_time: "Evening" }, ctx.today)).toEqual({ ok: true, value: { best_call_time: "evening" } });
    expect(parsePersonForm({ best_call_time: "" }, ctx.today)).toEqual({ ok: true, value: { best_call_time: null } });
    expect(parsePersonForm({ best_call_time: "night" }, ctx.today)).toEqual({ ok: false, error: "Choose morning, afternoon or evening" });
  });

  it("takes only 5, 10 or 15 for the daily goal", () => {
    expect(parsePersonForm({ gyan_daily_minutes: "10" }, ctx.today)).toEqual({ ok: true, value: { gyan_daily_minutes: 10 } });
    expect(parsePersonForm({ gyan_daily_minutes: "" }, ctx.today)).toEqual({ ok: true, value: { gyan_daily_minutes: null } });
    expect(parsePersonForm({ gyan_daily_minutes: "7" }, ctx.today)).toEqual({ ok: false, error: "Choose 5, 10 or 15 minutes a day" });
    expect(parsePersonForm({ gyan_daily_minutes: "1e1" }, ctx.today)).toEqual({ ok: false, error: "Choose 5, 10 or 15 minutes a day" });
    expect(parsePersonForm({ gyan_daily_minutes: "-5" }, ctx.today)).toMatchObject({ ok: false });
  });

  it("leaves out what the form did not send", () => {
    expect(parsePersonForm({ profession: "Pilot" }, ctx.today)).toEqual({ ok: true, value: { profession: "Pilot" } });
  });

  it("names the screen-only and the adult-only details", () => {
    expect([...SCREEN_ONLY_FIELDS]).toEqual(["preferred_name", "interests", "expertise_tags", "best_call_time", "gyan_daily_minutes"]);
    expect([...ADULT_ONLY_FIELDS]).toEqual(["interests", "expertise_tags", "best_call_time", "gyan_daily_minutes"]);
    expect(ADULT_ONLY_FIELDS.every((k) => (SCREEN_ONLY_FIELDS as readonly string[]).includes(k))).toBe(true);
    for (const k of SCREEN_ONLY_FIELDS) expect(PERSON_EDITABLE).toContain(k);
  });
});

describe("changedKeys with lists", () => {
  it("a list in another order or letter case is not a change; a different list is", () => {
    const original: Record<string, unknown> = { interests: ["Chess", "art"], expertise_tags: [], preferred_name: null, best_call_time: null, gyan_daily_minutes: 10 };
    expect(changedKeys(original, { interests: ["ART", "chess"], expertise_tags: [], preferred_name: null, best_call_time: null, gyan_daily_minutes: 10 })).toEqual([]);
    expect(changedKeys(original, { interests: ["art"], expertise_tags: ["law"], preferred_name: "Sami", best_call_time: "morning", gyan_daily_minutes: 5 })).toEqual([
      "interests",
      "expertise_tags",
      "preferred_name",
      "best_call_time",
      "gyan_daily_minutes",
    ]);
  });
  it("treats a missing list on file as an empty one", () => {
    expect(changedKeys({ interests: undefined } as Record<string, unknown>, { interests: [] })).toEqual([]);
    expect(changedKeys({ interests: null } as Record<string, unknown>, { interests: ["x"] })).toEqual(["interests"]);
  });
});

describe("the stored text of a list and the draft in the editor", () => {
  it("a list is stored as JSON and edited as one item per line", () => {
    const stored = '["chess","ગુજરાતી"]';
    expect(toDraft("interests", stored)).toBe("chess\nગુજરાતી\n");
    expect(toDraft("expertise_tags", "")).toBe("");
    expect(displayValue("interests", stored)).toBe("chess, ગુજરાતી");
    expect(displayValue("interests", "")).toBe("");
  });

  it("checkDraft turns the lines (the one still being typed included) into the stored JSON", () => {
    expect(checkDraft(PERSON_UNITS.interests, { interests: "chess\nart\nmusi" }, ctx)).toEqual({ ok: true, stored: { interests: '["chess","art","musi"]' } });
    expect(checkDraft(PERSON_UNITS.interests, { interests: "Chess\nchess\n" }, ctx)).toEqual({ ok: true, stored: { interests: '["Chess"]' } });
    expect(checkDraft(PERSON_UNITS.interests, { interests: "" }, ctx)).toEqual({ ok: true, stored: { interests: "" } });
    expect(checkDraft(PERSON_UNITS.expertiseAreas, { expertise_tags: "[beta]\n" }, ctx)).toEqual({ ok: true, stored: { expertise_tags: '["[beta]"]' } });
  });

  it("checkDraft says what is wrong in words", () => {
    const long = "y".repeat(51);
    const r = checkDraft(PERSON_UNITS.interests, { interests: `ok\n${long}\n` }, ctx);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("Each interest can be 50 characters at most");
    expect(checkDraft(PERSON_UNITS.callTime, { best_call_time: "midnight" }, ctx)).toEqual({ ok: false, error: "Choose morning, afternoon or evening" });
    expect(checkDraft(PERSON_UNITS.dailyGoal, { gyan_daily_minutes: "12" }, ctx)).toEqual({ ok: false, error: "Choose 5, 10 or 15 minutes a day" });
    expect(checkDraft(PERSON_UNITS.dailyGoal, { gyan_daily_minutes: "15" }, ctx)).toEqual({ ok: true, stored: { gyan_daily_minutes: "15" } });
    expect(checkDraft(PERSON_UNITS.preferredName, { preferred_name: " Sami " }, ctx)).toEqual({ ok: true, stored: { preferred_name: "Sami" } });
  });

  it("shows the call time and the daily goal in words", () => {
    expect(displayValue("best_call_time", "evening")).toBe("Evening");
    expect(displayValue("gyan_daily_minutes", "10")).toBe("10 minutes a day");
    expect(callTimeLabel("Morning")).toBe("Morning");
    expect(callTimeLabel("noon")).toBe("");
    expect(dailyMinutesLabel(5)).toBe("5 minutes a day");
    expect(dailyMinutesLabel("")).toBe("");
    expect(dailyMinutesLabel(7)).toBe("");
  });

  it("names how a member likes to be reached", () => {
    expect(contactChannelLabel("phone_call")).toBe("Phone call");
    expect(contactChannelLabel("sms")).toBe("Text message");
    expect(contactChannelLabel("signal_group")).toBe("signal group");
    expect(reachedByLine(["phone_call", "email"])).toEqual({ label: "Reached by", value: "Phone call, Email" });
    expect(reachedByLine([])).toEqual({ label: "Reached by", value: "Not given" });
  });
});

describe("a value that did not change is not a change", () => {
  it("compares lists without order or letter case, and the database array with the stored text", () => {
    expect(sameValue("interests", ["b", "A"], '["a","B"]')).toBe(true);
    expect(sameValue("interests", [], "")).toBe(true);
    expect(sameValue("interests", null, undefined)).toBe(true);
    expect(sameValue("interests", ["a"], '["a","b"]')).toBe(false);
    expect(normalizeStored("expertise_tags", ["Law", "tax"])).toBe(normalizeStored("expertise_tags", '["TAX","law"]'));
  });
  it("compares a number from the database with the text the screen holds, and the call time without letter case", () => {
    expect(sameValue("gyan_daily_minutes", 10, "10")).toBe(true);
    expect(sameValue("gyan_daily_minutes", null, "")).toBe(true);
    expect(sameValue("gyan_daily_minutes", 5, "10")).toBe(false);
    expect(sameValue("best_call_time", "Evening", "evening")).toBe(true);
    expect(sameValue("preferred_name", null, "")).toBe(true);
  });
  it("finds the conflict on a list the same way", () => {
    const current = { interests: ["chess", "art"], best_call_time: "morning" };
    expect(conflictKeys({ interests: '["art","chess"]' }, current, ["interests"])).toEqual([]);
    expect(conflictKeys({ interests: '["chess"]' }, current, ["interests", "best_call_time"])).toEqual(["interests"]);
  });
  it("says in words what the other person changed it to", () => {
    const line = conflictLine({ who: "Ravi", at: null, keys: ["interests"], theirs: { interests: '["Hiking","Board games"]' } }, new Date());
    expect(line).toBe("Ravi changed this a moment ago to Hiking, Board games. Your change was not saved.");
  });
});

describe("the edit of a list, step by step", () => {
  const start = { interests: '["chess"]' };

  it("save: adds a chip and sends the change with what was seen", () => {
    const s = run(PERSON_UNITS.interests, start, [
      { type: "start" },
      { type: "change", key: "interests", value: "chess\nart\n" },
      { type: "submit" },
    ]);
    expect(s.phase).toBe("saving");
    expect(s.pending).toEqual({ fields: { interests: '["chess","art"]' }, expect: { interests: '["chess"]' }, reason: null });
  });

  it("save with nothing typed or changed is no save", () => {
    const s = run(PERSON_UNITS.interests, start, [{ type: "start" }, { type: "submit" }]);
    expect(s.phase).toBe("idle");
    expect(s.pending).toBeNull();
    const reordered = run(PERSON_UNITS.interests, { interests: '["chess","art"]' }, [{ type: "start" }, { type: "change", key: "interests", value: "ART\nChess\n" }, { type: "submit" }]);
    expect(reordered.phase).toBe("idle");
  });

  it("a mistake stays in the field with its sentence, and what was typed is kept", () => {
    const s = run(PERSON_UNITS.interests, start, [{ type: "start" }, { type: "change", key: "interests", value: `chess\n${"z".repeat(60)}` }, { type: "submit" }]);
    expect(s.phase).toBe("editing");
    expect(s.problem).toContain("50 characters at most");
    expect(s.draft.interests).toBe(`chess\n${"z".repeat(60)}`);
  });

  it("clearing the list sends an empty value, and a failed save keeps what was typed", () => {
    let s = run(PERSON_UNITS.interests, start, [{ type: "start" }, { type: "change", key: "interests", value: "" }, { type: "submit" }]);
    expect(s.pending?.fields).toEqual({ interests: "" });
    s = reduce(s, { type: "failed", message: "Could not save Sami's interests — the server did not accept it." }, PERSON_UNITS.interests, ctx);
    expect(s.phase).toBe("error");
    expect(s.draft.interests).toBe("");
    expect(s.committed.interests).toBe('["chess"]');
  });

  it("a conflict offers theirs, and theirs becomes the list the editor starts from", () => {
    let s = run(PERSON_UNITS.interests, start, [{ type: "start" }, { type: "change", key: "interests", value: "chess\nart\n" }, { type: "submit" }]);
    s = reduce(s, { type: "conflicted", theirs: { interests: '["Hiking"]' }, who: "Ravi", at: null }, PERSON_UNITS.interests, ctx);
    s = reduce(s, { type: "use_theirs" }, PERSON_UNITS.interests, ctx);
    expect(s.phase).toBe("idle");
    expect(s.committed.interests).toBe('["Hiking"]');
    expect(s.draft.interests).toBe("Hiking\n");
  });

  it("a non-Latin list round-trips through the draft unchanged", () => {
    const stored = '["茶道","ગુજરાતી","الشطرنج"]';
    const s = run(PERSON_UNITS.interests, { interests: stored }, [{ type: "start" }, { type: "submit" }]);
    expect(s.phase).toBe("idle"); // starting and leaving a list as it was changes nothing
    const again = checkDraft(PERSON_UNITS.interests, { interests: toDraft("interests", stored) }, ctx);
    expect(again).toEqual({ ok: true, stored: { interests: stored } });
  });
});

describe("the values the editors start from", () => {
  it("personValues carries the preferred name; nothing is \"\"", () => {
    const row = { first_name: "Folake", last_name: "Adeyemi", preferred_name: "Fola", date_of_birth: null, gender: null, profession: null, employer: null, phone_e164: null, email: null, language: "en" };
    expect(personValues(row, "spouse").preferred_name).toBe("Fola");
    expect(personValues({ ...row, preferred_name: null }, "spouse").preferred_name).toBe("");
    expect(personValues({ ...row, preferred_name: undefined }, "spouse").preferred_name).toBe("");
  });

  it("preferenceValues makes the lists stored text, the call time and the goal as text", () => {
    expect(preferenceValues({ interests: ["chess", "茶道"], expertise_tags: ["Law"], best_call_time: "evening", gyan_daily_minutes: 10 })).toEqual({
      interests: '["chess","茶道"]',
      expertise_tags: '["Law"]',
      best_call_time: "evening",
      gyan_daily_minutes: "10",
    });
    expect(preferenceValues({})).toEqual({ interests: "", expertise_tags: "", best_call_time: "", gyan_daily_minutes: "" });
    expect(preferenceValues({ interests: null, expertise_tags: [], best_call_time: null, gyan_daily_minutes: null })).toEqual({
      interests: "",
      expertise_tags: "",
      best_call_time: "",
      gyan_daily_minutes: "",
    });
  });

  it("reads the ways a member likes to be reached as they are stored", () => {
    expect(contactChannelsOf({ contact_channels: ["phone_call", "sms"] })).toEqual(["phone_call", "sms"]);
    expect(contactChannelsOf({ contact_channels: null })).toEqual([]);
    expect(contactChannelsOf({})).toEqual([]);
  });
});

describe("History names the new details in plain words", () => {
  it("says what changed", () => {
    expect(
      changedFields(
        { interests: ["a"], best_call_time: null, gyan_daily_minutes: 5, expertise_tags: [], contact_channels: [], preferred_name: null },
        { interests: ["a", "b"], best_call_time: "morning", gyan_daily_minutes: 10, expertise_tags: ["law"], contact_channels: ["sms"], preferred_name: "Sami" },
      ),
    ).toEqual(["interests", "best time to call", "daily learning goal", "expertise areas", "contact choices", "preferred name"]);
  });
});
