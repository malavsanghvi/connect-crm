import { describe, expect, it } from "vitest";

import { validateRulesJson } from "@/lib/center-rules";
import {
  HOME_SHORTCUT_KEYS,
  describeShortcuts,
  homeShortcutChanges,
  homeShortcutRows,
  moveShortcut,
  parseHomeShortcuts,
  readHomeShortcuts,
  shownShortcuts,
} from "@/lib/home-shortcuts";
import { applyRulesPatch } from "@/lib/settings-rules";

describe("reading rules.home.shortcuts", () => {
  it("shows all six in the default order when the key is absent", () => {
    expect(HOME_SHORTCUT_KEYS).toEqual(["learn", "playlist", "photos", "recipe", "podcast", "guide"]);
    expect(readHomeShortcuts(null)).toEqual(["learn", "playlist", "photos", "recipe", "podcast", "guide"]);
    expect(readHomeShortcuts({ home: {} })).toEqual(["learn", "playlist", "photos", "recipe", "podcast", "guide"]);
    expect(readHomeShortcuts({ home: { shortcuts: "learn" } })).toEqual(["learn", "playlist", "photos", "recipe", "podcast", "guide"]);
  });
  it("keeps the stored order, shows nothing for an empty list, ignores unknown and repeated keys", () => {
    expect(readHomeShortcuts({ home: { shortcuts: ["podcast", "learn"] } })).toEqual(["podcast", "learn"]);
    expect(readHomeShortcuts({ home: { shortcuts: [] } })).toEqual([]);
    expect(readHomeShortcuts({ home: { shortcuts: ["quiz", "recipe", 3, "recipe", "photos"] } })).toEqual(["recipe", "photos"]);
  });
  it("lists the card's rows: shown ones in order, then the hidden ones in the default order", () => {
    expect(homeShortcutRows({ home: { shortcuts: ["podcast", "learn"] } })).toEqual([
      { key: "podcast", on: true },
      { key: "learn", on: true },
      { key: "playlist", on: false },
      { key: "photos", on: false },
      { key: "recipe", on: false },
      { key: "guide", on: false },
    ]);
    expect(shownShortcuts(homeShortcutRows(null))).toEqual(HOME_SHORTCUT_KEYS);
  });
});

describe("editing the shortcuts", () => {
  const rows = homeShortcutRows(null);
  it("moves a row up or down and ignores moves past either end", () => {
    expect(shownShortcuts(moveShortcut(rows, 4, -1))).toEqual(["learn", "playlist", "photos", "podcast", "recipe", "guide"]);
    expect(shownShortcuts(moveShortcut(rows, 0, 1))).toEqual(["playlist", "learn", "photos", "recipe", "podcast", "guide"]);
    expect(moveShortcut(rows, 0, -1)).toEqual(rows);
    expect(moveShortcut(rows, 5, 1)).toEqual(rows);
  });
  it("counts changes for the Save button", () => {
    expect(homeShortcutChanges(["learn", "playlist"], ["learn", "playlist"])).toBe(0);
    expect(homeShortcutChanges(["learn", "playlist"], ["learn"])).toBe(1);
    expect(homeShortcutChanges(["learn", "playlist"], ["playlist", "learn"])).toBe(1);
    expect(homeShortcutChanges(["learn", "playlist"], ["podcast", "playlist", "learn"])).toBe(2);
    expect(homeShortcutChanges(["learn"], [])).toBe(1);
  });
  it("parses the posted keys and refuses anything else", () => {
    expect(parseHomeShortcuts(["recipe", "learn"])).toEqual({ ok: true, shortcuts: ["recipe", "learn"] });
    expect(parseHomeShortcuts([])).toEqual({ ok: true, shortcuts: [] });
    expect(parseHomeShortcuts(["learn", "quiz"])).toEqual({ ok: false, error: expect.stringContaining('"quiz" is not a Home shortcut') });
    expect(parseHomeShortcuts(["learn", "learn"])).toEqual({ ok: false, error: expect.stringContaining("Learn is listed twice") });
  });
  it("describes the saved strip", () => {
    expect(describeShortcuts(["learn", "recipe", "podcast"])).toBe("Learn, Jain recipe and Podcast");
    expect(describeShortcuts(["photos"])).toBe("Event photos");
    expect(describeShortcuts(["guide", "podcast"])).toBe("New to the community and Podcast");
    expect(describeShortcuts([])).toBe("none");
  });
});

describe("validating home.shortcuts in the rule bag", () => {
  it("accepts the card's patch, merged into the rules (lists replace, never merge)", () => {
    const first = applyRulesPatch({ home: { shortcuts: ["learn", "playlist", "photos"] }, boli: { step_cents: 2100 } }, { home: { shortcuts: ["podcast"] } });
    expect(first.rules.home).toEqual({ shortcuts: ["podcast"] });
    expect(validateRulesJson(JSON.stringify(first.rules)).ok).toBe(true);
    expect(validateRulesJson(JSON.stringify({ home: { shortcuts: [] } })).ok).toBe(true);
  });
  it("refuses a shortcut list that is not a list of known, distinct names", () => {
    const bad = (rules: unknown) => {
      const r = validateRulesJson(JSON.stringify(rules));
      return r.ok ? [] : r.errors;
    };
    expect(bad({ home: "learn" })).toEqual(['"home" must be an object.']);
    expect(bad({ home: { shortcuts: "learn" } })[0]).toContain('"home.shortcuts" must be a list of names');
    expect(bad({ home: { shortcuts: ["learn", 2] } })[0]).toContain("must be a list of names");
    expect(bad({ home: { shortcuts: ["learn", "recipes"] } })[0]).toContain('not "recipes"');
    expect(bad({ home: { shortcuts: ["learn", "learn"] } })[0]).toContain('lists "learn" more than once');
  });
});
