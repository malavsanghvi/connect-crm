import { describe, expect, it } from "vitest";

import { givingRuleProblems } from "@/lib/giving-glance/levels";
import {
  DEFAULT_PLEDGE_DUE_DAYS,
  checkDueChange,
  defaultDueOn,
  dueRuleSentence,
  isRealDate,
  pledgeDueDays,
  pledgeDueDaysProblem,
} from "@/lib/giving-due";

// Every pledge has a due date (0775). The rule reads rules.giving.pledge_due_days exactly as app.pledge_default_due_on does.

const ID = "17500000-0000-4000-8000-000000000301";

describe("the community's rule", () => {
  it("is 30 days when nothing is set (what every screen already counted with)", () => {
    expect(DEFAULT_PLEDGE_DUE_DAYS).toBe(30);
    expect(pledgeDueDays(null)).toBe(30);
    expect(pledgeDueDays({})).toBe(30);
    expect(pledgeDueDays({ giving: { show_by: "person" } })).toBe(30);
  });

  it("reads a whole number of days from 0 to 3650, as a number or as digits", () => {
    expect(pledgeDueDays({ giving: { pledge_due_days: 14 } })).toBe(14);
    expect(pledgeDueDays({ giving: { pledge_due_days: "45" } })).toBe(45);
    expect(pledgeDueDays({ giving: { pledge_due_days: 0 } })).toBe(0);
    expect(pledgeDueDays({ giving: { pledge_due_days: 3650 } })).toBe(3650);
  });

  it("falls back to 30 for anything else, as the database does", () => {
    for (const v of [-3, 3651, 5000, 14.5, "soon", "", "1e2", true, [], {}]) {
      expect(pledgeDueDays({ giving: { pledge_due_days: v } })).toBe(30);
    }
  });

  it("is checked in the rules checker, in plain words", () => {
    expect(pledgeDueDaysProblem(undefined)).toBeNull();
    expect(pledgeDueDaysProblem(21)).toBeNull();
    expect(pledgeDueDaysProblem("soon")).toMatch(/whole number of days from 0 to 3650/);
    expect(givingRuleProblems({ pledge_due_days: 9999 })).toEqual(['"giving.pledge_due_days" must be a whole number of days from 0 to 3650.']);
    expect(givingRuleProblems({ show_by: "nobody", pledge_due_days: -1 })).toHaveLength(2);
    expect(givingRuleProblems({ show_by: "person", pledge_due_days: 60 })).toEqual([]);
  });

  it("gives the date and the sentence", () => {
    expect(defaultDueOn("2026-01-09", 30)).toBe("2026-02-08");
    expect(defaultDueOn("2026-12-20", 14)).toBe("2027-01-03");
    expect(dueRuleSentence(30)).toBe("Pledges are due 30 days after they are made.");
    expect(dueRuleSentence(1)).toBe("Pledges are due 1 day after they are made.");
    expect(dueRuleSentence(0)).toBe("Pledges are due the day they are made.");
  });
});

describe("changing a due date", () => {
  const today = "2026-10-13";
  const ok = { pledgeId: ID, dueOn: "2026-12-31", reason: "Asked for more time" };

  it("accepts a real date with a reason", () => {
    expect(checkDueChange(ok, today)).toEqual({ ok: true, value: ok });
  });

  it("refuses what the database would refuse, in the same words", () => {
    expect(checkDueChange({ ...ok, dueOn: "" }, today)).toEqual({ ok: false, error: "Choose the new due date." });
    expect(checkDueChange({ ...ok, dueOn: "2026-02-30" }, today)).toMatchObject({ ok: false, error: expect.stringMatching(/as a date/) });
    expect(checkDueChange({ ...ok, dueOn: "2037-01-01" }, today)).toMatchObject({ ok: false, error: expect.stringMatching(/ten years/) });
    expect(checkDueChange({ ...ok, dueOn: "2026-09-01" }, today, "2026-09-10")).toMatchObject({ ok: false, error: expect.stringMatching(/before the day it was pledged/) });
    expect(checkDueChange({ ...ok, reason: " x " }, today)).toMatchObject({ ok: false, error: expect.stringMatching(/^Say why the due date changes/) });
    expect(checkDueChange({ ...ok, pledgeId: "nope" }, today)).toMatchObject({ ok: false });
    expect(checkDueChange(null, today)).toMatchObject({ ok: false });
  });

  it("knows a real date", () => {
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2027-02-29")).toBe(false);
    expect(isRealDate("31/12/2026")).toBe(false);
  });
});
