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

// The five details of a person's record that were read-only until now: the name they go by, interests (a fixed choice), expertise areas
// (free text), the best time to call and the daily learning goal. The pure core: parsing, the stored text of a list, "did it change",
// the edit state machine.

const ctx: CheckContext = { today: "2026-10-12", languages: ["en", "es"], zoneIds: [] };
const run = (u: EditUnit, start: Record<string, string>, events: EditEvent[]) => events.reduce((s, e) => reduce(s, e, u, ctx), initialEdit(u, start));

describe("parsePersonForm: the five details", () => {
  it("takes a preferred name in any script, trims it, and empty clears it", () => {
    expect(parsePersonForm({ preferred_name: "  Sami " }, ctx.today)).toEqual({ ok: true, value: { preferred_name: "Sami" } });
    expect(parsePersonForm({ preferred_name: "美咲" }, ctx.today)).toEqual({ ok: true, value: { preferred_name: "美咲" } });
    expect(parsePersonForm({ preferred_name: "Айгуль" }, ctx.today)).toEqual({ ok: true, value: { preferred_name: "Айгуль" } });
    expect(parsePersonForm({ preferred_name: "  " }, ctx.today)).toEqual({ ok: true, value: { preferred_name: null } });
  });

  it("takes expertise areas as free text in any script, from text or from the stored JSON", () => {
    expect(parsePersonForm({ expertise_tags: "chess, 茶道, ગુજરાતી" }, ctx.today)).toEqual({ ok: true, value: { expertise_tags: ["chess", "茶道", "ગુજરાતી"] } });
    expect(parsePersonForm({ expertise_tags: '["Law","tax"]' }, ctx.today)).toEqual({ ok: true, value: { expertise_tags: ["Law", "tax"] } });
    expect(parsePersonForm({ expertise_tags: "" }, ctx.today)).toEqual({ ok: true, value: { expertise_tags: [] } });
  });

  it("takes interests only from the member app's keys, in the app's order, in any letter case or by their names", () => {
    expect(parsePersonForm({ interests: '["youth","Events"]' }, ctx.today)).toEqual({ ok: true, value: { interests: ["events", "youth"] } });
    expect(parsePersonForm({ interests: "Seniors, giving" }, ctx.today)).toEqual({ ok: true, value: { interests: ["seniors", "giving"] } });
    expect(parsePersonForm({ interests: "" }, ctx.today)).toEqual({ ok: true, value: { interests: [] } });
  });

  it("refuses an interest that is not one of the keys, in words, whatever the script", () => {
    expect(parsePersonForm({ interests: "events, chess" }, ctx.today)).toEqual({
      ok: false,
      error: 'Choose interests from the list: Events, Pathshala, Volunteering, Youth, Seniors and Giving ("chess" is not on it)',
    });
    expect(parsePersonForm({ interests: "茶道, कविता" }, ctx.today)).toMatchObject({ ok: false, error: expect.stringContaining('"茶道" and "कविता" are not on it') });
  });

  it("lets an interest that is already on file stay, but no other that is not a key", () => {
    const onFile = { interests: ["youth", "茶道"] };
    expect(parsePersonForm({ interests: '["youth","茶道","giving"]' }, ctx.today, undefined, onFile)).toEqual({ ok: true, value: { interests: ["youth", "giving", "茶道"] } });
    expect(parsePersonForm({ interests: '["茶道"]' }, ctx.today, undefined, onFile)).toEqual({ ok: true, value: { interests: ["茶道"] } });
    expect(parsePersonForm({ interests: '["茶道","俳句"]' }, ctx.today, undefined, onFile)).toMatchObject({ ok: false });
    // removed from the record, it can no longer be put back by a save
    expect(parsePersonForm({ interests: '["茶道"]' }, ctx.today, undefined, { interests: ["youth"] })).toMatchObject({ ok: false });
  });

  it("refuses a list that is too long, in words", () => {
    const many = Array.from({ length: 21 }, (_, i) => `i${i}`).join(",");
    expect(parsePersonForm({ expertise_tags: many }, ctx.today)).toEqual({ ok: false, error: "Add at most 20 expertise areas" });
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
    const original: Record<string, unknown> = { interests: ["Events", "youth"], expertise_tags: [], preferred_name: null, best_call_time: null, gyan_daily_minutes: 10 };
    expect(changedKeys(original, { interests: ["YOUTH", "events"], expertise_tags: [], preferred_name: null, best_call_time: null, gyan_daily_minutes: 10 })).toEqual([]);
    expect(changedKeys(original, { interests: ["youth"], expertise_tags: ["law"], preferred_name: "Sami", best_call_time: "morning", gyan_daily_minutes: 5 })).toEqual([
      "interests",
      "expertise_tags",
      "preferred_name",
      "best_call_time",
      "gyan_daily_minutes",
    ]);
  });
  it("treats a missing list on file as an empty one", () => {
    expect(changedKeys({ interests: undefined } as Record<string, unknown>, { interests: [] })).toEqual([]);
    expect(changedKeys({ interests: null } as Record<string, unknown>, { interests: ["giving"] })).toEqual(["interests"]);
  });
});

describe("the stored text of a list and the draft in the editor", () => {
  it("expertise areas are stored as JSON and edited as one item per line", () => {
    const stored = '["chess","ગુજરાતી"]';
    expect(toDraft("expertise_tags", stored)).toBe("chess\nગુજરાતી\n");
    expect(toDraft("expertise_tags", "")).toBe("");
    expect(displayValue("expertise_tags", stored)).toBe("chess, ગુજરાતી");
    expect(displayValue("expertise_tags", "")).toBe("");
  });

  it("interests are shown by their names, the keys first in the app's order, then an older value as written", () => {
    const stored = '["茶道","youth","Events"]';
    expect(displayValue("interests", stored)).toBe("Events, Youth, 茶道");
    expect(toDraft("interests", stored)).toBe("events\nyouth\n茶道\n");
    expect(toDraft("interests", "")).toBe("");
  });

  it("checkDraft turns expertise lines (the one still being typed included) into the stored JSON", () => {
    expect(checkDraft(PERSON_UNITS.expertiseAreas, { expertise_tags: "chess\nart\nmusi" }, ctx)).toEqual({ ok: true, stored: { expertise_tags: '["chess","art","musi"]' } });
    expect(checkDraft(PERSON_UNITS.expertiseAreas, { expertise_tags: "Chess\nchess\n" }, ctx)).toEqual({ ok: true, stored: { expertise_tags: '["Chess"]' } });
    expect(checkDraft(PERSON_UNITS.expertiseAreas, { expertise_tags: "" }, ctx)).toEqual({ ok: true, stored: { expertise_tags: "" } });
    expect(checkDraft(PERSON_UNITS.expertiseAreas, { expertise_tags: "[beta]\n" }, ctx)).toEqual({ ok: true, stored: { expertise_tags: '["[beta]"]' } });
  });

  it("checkDraft stores chosen interests as keys in the app's order, and refuses a new word that is not a key", () => {
    expect(checkDraft(PERSON_UNITS.interests, { interests: "youth\nevents\n" }, ctx)).toEqual({ ok: true, stored: { interests: '["events","youth"]' } });
    expect(checkDraft(PERSON_UNITS.interests, { interests: "" }, ctx)).toEqual({ ok: true, stored: { interests: "" } });
    const r = checkDraft(PERSON_UNITS.interests, { interests: "events\nchess\n" }, ctx, { interests: '["events"]' });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain('"chess" is not on it');
  });

  it("checkDraft keeps an older value that is on file, in any script, and lets it go when removed", () => {
    const committed = { interests: '["youth","茶道"]' };
    expect(checkDraft(PERSON_UNITS.interests, { interests: "youth\n茶道\n" }, ctx, committed)).toEqual({ ok: true, stored: { interests: '["youth","茶道"]' } });
    expect(checkDraft(PERSON_UNITS.interests, { interests: "youth\n" }, ctx, committed)).toEqual({ ok: true, stored: { interests: '["youth"]' } });
    // not on file: refused, so it can never be added
    expect(checkDraft(PERSON_UNITS.interests, { interests: "youth\n茶道\n" }, ctx, { interests: '["youth"]' }).ok).toBe(false);
  });

  it("checkDraft says what is wrong in words", () => {
    const long = "y".repeat(51);
    const r = checkDraft(PERSON_UNITS.expertiseAreas, { expertise_tags: `ok\n${long}\n` }, ctx);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("Each expertise area can be 50 characters at most");
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
    expect(sameValue("interests", ["youth", "Events"], '["events","Youth"]')).toBe(true);
    expect(sameValue("interests", [], "")).toBe(true);
    expect(sameValue("interests", null, undefined)).toBe(true);
    expect(sameValue("interests", ["youth"], '["youth","giving"]')).toBe(false);
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
    const current = { interests: ["events", "youth"], best_call_time: "morning" };
    expect(conflictKeys({ interests: '["youth","events"]' }, current, ["interests"])).toEqual([]);
    expect(conflictKeys({ interests: '["events"]' }, current, ["interests", "best_call_time"])).toEqual(["interests"]);
  });
  it("says in words what the other person changed interests to, by their names", () => {
    const line = conflictLine({ who: "Ravi", at: null, keys: ["interests"], theirs: { interests: '["seniors","events"]' } }, new Date());
    expect(line).toBe("Ravi changed this a moment ago to Events, Seniors. Your change was not saved.");
  });
});

describe("the edit of expertise areas, step by step", () => {
  const u = PERSON_UNITS.expertiseAreas;
  const start = { expertise_tags: '["chess"]' };

  it("save: adds a chip and sends the change with what was seen", () => {
    const s = run(u, start, [{ type: "start" }, { type: "change", key: "expertise_tags", value: "chess\nart\n" }, { type: "submit" }]);
    expect(s.phase).toBe("saving");
    expect(s.pending).toEqual({ fields: { expertise_tags: '["chess","art"]' }, expect: { expertise_tags: '["chess"]' }, reason: null });
  });

  it("save with nothing typed or changed is no save", () => {
    const s = run(u, start, [{ type: "start" }, { type: "submit" }]);
    expect(s.phase).toBe("idle");
    expect(s.pending).toBeNull();
    const reordered = run(u, { expertise_tags: '["chess","art"]' }, [{ type: "start" }, { type: "change", key: "expertise_tags", value: "ART\nChess\n" }, { type: "submit" }]);
    expect(reordered.phase).toBe("idle");
  });

  it("a mistake stays in the field with its sentence, and what was typed is kept", () => {
    const s = run(u, start, [{ type: "start" }, { type: "change", key: "expertise_tags", value: `chess\n${"z".repeat(60)}` }, { type: "submit" }]);
    expect(s.phase).toBe("editing");
    expect(s.problem).toContain("50 characters at most");
    expect(s.draft.expertise_tags).toBe(`chess\n${"z".repeat(60)}`);
  });

  it("clearing the list sends an empty value, and a failed save keeps what was typed", () => {
    let s = run(u, start, [{ type: "start" }, { type: "change", key: "expertise_tags", value: "" }, { type: "submit" }]);
    expect(s.pending?.fields).toEqual({ expertise_tags: "" });
    s = reduce(s, { type: "failed", message: "Could not save Sami's expertise areas — the server did not accept it." }, u, ctx);
    expect(s.phase).toBe("error");
    expect(s.draft.expertise_tags).toBe("");
    expect(s.committed.expertise_tags).toBe('["chess"]');
  });

  it("a conflict offers theirs, and theirs becomes the list the editor starts from", () => {
    let s = run(u, start, [{ type: "start" }, { type: "change", key: "expertise_tags", value: "chess\nart\n" }, { type: "submit" }]);
    s = reduce(s, { type: "conflicted", theirs: { expertise_tags: '["Hiking"]' }, who: "Ravi", at: null }, u, ctx);
    s = reduce(s, { type: "use_theirs" }, u, ctx);
    expect(s.phase).toBe("idle");
    expect(s.committed.expertise_tags).toBe('["Hiking"]');
    expect(s.draft.expertise_tags).toBe("Hiking\n");
  });

  it("a non-Latin list round-trips through the draft unchanged", () => {
    const stored = '["茶道","ગુજરાતી","الشطرنج"]';
    const s = run(u, { expertise_tags: stored }, [{ type: "start" }, { type: "submit" }]);
    expect(s.phase).toBe("idle"); // starting and leaving a list as it was changes nothing
    expect(checkDraft(u, { expertise_tags: toDraft("expertise_tags", stored) }, ctx)).toEqual({ ok: true, stored: { expertise_tags: stored } });
  });
});

describe("the edit of interests, step by step", () => {
  const u = PERSON_UNITS.interests;
  const start = { interests: '["youth","茶道"]' }; // one key, and an older value in another script

  it("choosing a key sends the keys in the app's order and keeps the older value", () => {
    const s = run(u, start, [{ type: "start" }, { type: "change", key: "interests", value: "youth\n茶道\nevents\n" }, { type: "submit" }]);
    expect(s.phase).toBe("saving");
    expect(s.pending).toEqual({ fields: { interests: '["events","youth","茶道"]' }, expect: { interests: '["youth","茶道"]' }, reason: null });
  });

  it("removing the older value sends the list without it", () => {
    const s = run(u, start, [{ type: "start" }, { type: "change", key: "interests", value: "youth\n" }, { type: "submit" }]);
    expect(s.pending?.fields).toEqual({ interests: '["youth"]' });
  });

  it("a word that is not a key is refused in the field and nothing is sent", () => {
    const s = run(u, start, [{ type: "start" }, { type: "change", key: "interests", value: "youth\n茶道\nchess\n" }, { type: "submit" }]);
    expect(s.phase).toBe("editing");
    expect(s.problem).toContain('"chess" is not on it');
    expect(s.pending).toBeNull();
  });

  it("leaving it as it was is no save", () => {
    const s = run(u, start, [{ type: "start" }, { type: "submit" }]);
    expect(s.phase).toBe("idle");
  });

  it("Undo is offered unless the change removed an older value (putting it back would add what is not a key)", () => {
    expect(u.canUndo?.('["youth","茶道"]', '["events","youth","茶道"]')).toBe(true);
    expect(u.canUndo?.('["youth"]', '["youth","events"]')).toBe(true);
    expect(u.canUndo?.('["youth","茶道"]', '["youth"]')).toBe(false);
    expect(u.canUndo?.("", '["events"]')).toBe(true);
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
    expect(preferenceValues({ interests: ["youth", "茶道"], expertise_tags: ["Law"], best_call_time: "evening", gyan_daily_minutes: 10 })).toEqual({
      interests: '["youth","茶道"]',
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
        { interests: ["events"], best_call_time: null, gyan_daily_minutes: 5, expertise_tags: [], contact_channels: [], preferred_name: null },
        { interests: ["events", "youth"], best_call_time: "morning", gyan_daily_minutes: 10, expertise_tags: ["law"], contact_channels: ["sms"], preferred_name: "Sami" },
      ),
    ).toEqual(["interests", "best time to call", "daily learning goal", "expertise areas", "contact choices", "preferred name"]);
  });
});
