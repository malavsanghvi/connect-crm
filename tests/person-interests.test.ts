import { describe, expect, it } from "vitest";

import {
  canUndoInterests,
  checkInterests,
  interestKey,
  interestLabel,
  interestsDisplay,
  interestsToDraft,
  removeLegacyDraft,
  splitInterests,
  toggleInterestDraft,
} from "@/lib/person-interests";
import { INTEREST_CATALOG, INTEREST_KEYS, INTEREST_LABELS, interestLabels } from "@/lib/profile-details";

// Interests are a fixed choice: the member app keeps the keys of its INTEREST_CATALOG and drops everything else on the member's next
// save, so staff choose from the keys; a value on file that is not one is kept until they remove it, and never added.

describe("the keys", () => {
  it("are the member app's six, in its order, in the one list in this repo (change them together with connect-mobile INTEREST_CATALOG)", () => {
    expect([...INTEREST_KEYS]).toEqual(["events", "pathshala", "volunteering", "youth", "seniors", "giving"]);
    expect(INTEREST_CATALOG.map((i) => i.key)).toEqual([...INTEREST_KEYS]);
    expect(Object.keys(INTEREST_LABELS)).toEqual([...INTEREST_KEYS]);
  });

  it("are named by the existing helper", () => {
    expect(interestLabels(["youth", "events"])).toEqual(["Youth", "Events"]);
    expect(interestLabel("youth")).toBe("Youth");
    expect(interestLabel("YOUTH ")).toBe("Youth");
  });

  it("are found by key or by name in any letter case; anything else is not a key", () => {
    expect(interestKey("Youth")).toBe("youth");
    expect(interestKey(" SENIORS ")).toBe("seniors");
    expect(interestKey("chess")).toBeNull();
    expect(interestKey("茶道")).toBeNull();
    expect(interestKey("")).toBeNull();
  });
});

describe("what is on file", () => {
  it("splits the keys chosen (in the app's order) from older values (as written)", () => {
    expect(splitInterests('["茶道","giving","Events","Chess club"]')).toEqual({ chosen: ["events", "giving"], legacy: ["茶道", "Chess club"] });
    expect(splitInterests(["Youth", "youth"])).toEqual({ chosen: ["youth"], legacy: [] });
    expect(splitInterests(null)).toEqual({ chosen: [], legacy: [] });
    expect(splitInterests("")).toEqual({ chosen: [], legacy: [] });
  });

  it("shows names, not keys, and an older value as it was written (not made up into a name)", () => {
    expect(interestsDisplay(["giving", "events", "nut_club"])).toBe("Events, Giving, nut_club");
    expect(interestsDisplay([])).toBe("");
  });

  it("starts the editor with the keys and then the older values, one per line", () => {
    expect(interestsToDraft(["giving", "茶道", "events"])).toBe("events\ngiving\n茶道\n");
    expect(interestsToDraft([])).toBe("");
  });
});

describe("what a save may write", () => {
  it("takes the keys, in the app's order, from keys or names in any letter case", () => {
    expect(checkInterests(["Giving", "events", "YOUTH"])).toEqual({ ok: true, value: ["events", "youth", "giving"] });
    expect(checkInterests([])).toEqual({ ok: true, value: [] });
  });

  it("refuses a new word that is not a key, in words, and says which", () => {
    expect(checkInterests(["events", "chess"])).toEqual({
      ok: false,
      error: 'Choose interests from the list: Events, Pathshala, Volunteering, Youth, Seniors and Giving ("chess" is not on it)',
    });
    const many = checkInterests(["a", "b", "c", "d", "e"]);
    expect(many.ok ? "" : many.error).toBe(
      'Choose interests from the list: Events, Pathshala, Volunteering, Youth, Seniors and Giving ("a", "b" and "c" are not on it)',
    );
  });

  it("keeps an older value that is on file, as it is on file, after the keys", () => {
    expect(checkInterests(["茶道", "giving", "chess club"], ["Chess Club", "茶道"])).toEqual({ ok: true, value: ["giving", "茶道", "Chess Club"] });
  });

  it("does not let a value that is not on file in, even one that was on file once", () => {
    expect(checkInterests(["茶道"], [])).toMatchObject({ ok: false });
    expect(checkInterests(["茶道", "俳句"], ["茶道"])).toMatchObject({ ok: false });
  });

  it("lets an older value go: a save without it is a save", () => {
    expect(checkInterests(["youth"], ["youth", "茶道"])).toEqual({ ok: true, value: ["youth"] });
  });
});

describe("the editor's draft", () => {
  it("toggles a key on and off, and leaves older values alone", () => {
    expect(toggleInterestDraft("youth\n茶道\n", "giving")).toBe("youth\n茶道\ngiving\n");
    expect(toggleInterestDraft("youth\n茶道\ngiving\n", "youth")).toBe("茶道\ngiving\n");
    expect(toggleInterestDraft("", "events")).toBe("events\n");
    expect(toggleInterestDraft("events\n", "events")).toBe("");
    // a key written as a name counts as the key
    expect(toggleInterestDraft("Youth\n", "youth")).toBe("");
  });

  it("removes an older value, and nothing else", () => {
    expect(removeLegacyDraft("youth\n茶道\nChess club\n", "chess CLUB")).toBe("youth\n茶道\n");
    expect(removeLegacyDraft("茶道\n", "茶道")).toBe("");
  });
});

describe("Undo", () => {
  it("is not offered when the change removed an older value, since putting it back would add a value that is not a key", () => {
    expect(canUndoInterests('["youth","茶道"]', '["youth"]')).toBe(false);
    expect(canUndoInterests('["youth","茶道"]', '["youth","茶道","giving"]')).toBe(true);
    expect(canUndoInterests('["youth"]', '["events"]')).toBe(true);
    expect(canUndoInterests("", '["events"]')).toBe(true);
  });
});
