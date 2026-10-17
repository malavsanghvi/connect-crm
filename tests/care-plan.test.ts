import { describe, expect, it } from "vitest";

import { wordsAsk } from "@/lib/care/gestures";
import {
  MAX_MOMENTS,
  NEVER_ASK_PLAN,
  byMonth,
  checkPlan,
  comingUp,
  itemLine,
  monthName,
  parsePlan,
  parsePlanContext,
  planInput,
  quietOn,
  skeletonPlan,
  toPayload,
  type PlanContext,
  type PlanInput,
} from "@/lib/care/plan";

// DonorDelight slice 8 (0896): the care plan from the mission, in words.

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  year: 2027, audience: "faith", mission: "To welcome every neighbour.", fiscalYearStartMonth: 7, groups: {}, calendar: [], quietPeriods: [], playbooks: [], gestures: 0, label: "Member care", ...over,
});

describe("parsePlan and parsePlanContext", () => {
  it("read the plan, its moments (one with no id or day is dropped) and the years that have a plan", () => {
    const p = parsePlan({
      year: 2027, exists: true, status: "approved", summary: "Thank first.", approved_at: "2026-10-12T10:00:00Z", years: [2027, 2028], can_manage: true, label: "Member care", today: "2026-10-12",
      items: [{ id: "abc123456", on: "2027-03-01", title: "Call", group: "steady", kind: "thank_you", note: "No ask." }, { title: "no id" }, { id: "xyz987654", on: "2027-04-01", title: "Odd", group: "rich", kind: "ask" }],
    });
    expect(p).toMatchObject({ year: 2027, exists: true, status: "approved", summary: "Thank first.", canManage: true, years: [2027, 2028] });
    expect(p.items).toEqual([
      { id: "abc123456", on: "2027-03-01", title: "Call", group: "steady", kind: "thank_you", note: "No ask." },
      { id: "xyz987654", on: "2027-04-01", title: "Odd", group: "all", kind: "other", note: null },
    ]);
    expect(parsePlan(null)).toMatchObject({ exists: false, status: "none", items: [], years: [], label: "DonorDelight" });
  });
  it("the context holds counts only", () => {
    const c = parsePlanContext({
      year: 2027, audience: "faith", mission: "M", fiscal_year_start_month: 13, groups: { steady: 12, rich: 3, cooling: "x" }, calendar: [{ title: "Supper", on: "2027-10-10" }, { title: "" }],
      quiet_periods: [{ name: "Rest", starts_on: "2027-12-20", ends_on: "2028-01-05", yearly: true }], playbooks: ["A"], gestures: 13,
    });
    expect(c.groups).toEqual({ steady: 12 });
    expect(c.fiscalYearStartMonth).toBe(12);
    expect(c.calendar).toEqual([{ title: "Supper", on: "2027-10-10" }]);
    expect(c.quietPeriods[0]).toMatchObject({ name: "Rest", yearly: true });
  });
});

describe("checkPlan: the same rules as the database, in the same words", () => {
  const ok = (): PlanInput => ({ summary: "Thank first.", items: [{ on: "2027-03-01", title: "Call the steady givers", group: "steady", kind: "thank_you", note: "" }] });
  it("a good plan passes", () => expect(checkPlan(2027, ok())).toEqual({ ok: true }));
  it("a moment is in the plan's year, has a title, a known group and a plain touch", () => {
    const m = (patch: Record<string, unknown>) => ({ ...ok(), items: [{ ...ok().items[0], ...patch }] }) as PlanInput;
    expect(checkPlan(2027, m({ on: "2028-01-02" }))).toEqual({ ok: false, error: "Moment 1: choose a day in 2027." });
    expect(checkPlan(2027, m({ on: "2027-02-31" }))).toEqual({ ok: false, error: "Moment 1: choose a day in 2027." });
    expect(checkPlan(2027, m({ title: " " }))).toEqual({ ok: false, error: "Moment 1: give it a title of up to 120 characters." });
    expect(checkPlan(2027, m({ group: "rich" }))).toEqual({ ok: false, error: "Moment 1: say which households it is for: everyone, or one of the groups." });
    expect(checkPlan(2027, m({ kind: "care_moment" }))).toEqual({ ok: false, error: "Moment 1: say what the touch is." });
    expect(checkPlan(2027, m({ note: "x".repeat(401) }))).toEqual({ ok: false, error: "Moment 1: the note is at most 400 characters." });
  });
  it("a plan is never paired with an ask, in its summary, a title or a note", () => {
    expect(checkPlan(2027, { ...ok(), summary: "Would you consider donating $100?" })).toEqual({ ok: false, error: NEVER_ASK_PLAN });
    const r = checkPlan(2027, { ...ok(), items: [{ ...ok().items[0], title: "Please give generously" }] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("never paired with an ask");
    expect(checkPlan(2027, { ...ok(), items: [{ ...ok().items[0], note: "Make a donation" }] }).ok).toBe(false);
  });
  it("at most sixty moments, and a year the database accepts", () => {
    const many = Array.from({ length: MAX_MOMENTS + 1 }, (_, i) => ({ on: "2027-01-02", title: `m${i}`, group: "all" as const, kind: "greeting" as const, note: "" }));
    expect(checkPlan(2027, { summary: "", items: many })).toEqual({ ok: false, error: "A care plan has at most 60 moments." });
    expect(checkPlan(1999, ok())).toEqual({ ok: false, error: "Choose a year between 2000 and 2100." });
  });
  it("toPayload trims, nulls empty text and carries ids only when there are some; there is no ask field", () => {
    const p = toPayload({ summary: "  Thank first. ", items: [{ id: "abc123456", on: "2027-03-01", title: " Call ", group: "steady", kind: "thank_you", note: "" }, { on: "2027-04-01", title: "Card", group: "all", kind: "greeting", note: " hi " }] });
    expect(p).toEqual({
      summary: "Thank first.",
      items: [{ id: "abc123456", on: "2027-03-01", title: "Call", group: "steady", kind: "thank_you", note: null }, { on: "2027-04-01", title: "Card", group: "all", kind: "greeting", note: "hi" }],
    });
    expect(JSON.stringify(p)).not.toContain("is_ask");
    expect(planInput(parsePlan({ exists: true, summary: null, items: [{ id: "abc123456", on: "2027-03-01", title: "Call", group: "steady", kind: "thank_you" }] }))).toEqual({
      summary: "", items: [{ id: "abc123456", on: "2027-03-01", title: "Call", group: "steady", kind: "thank_you", note: "" }],
    });
  });
});

describe("quiet periods", () => {
  it("a one-off period, a yearly one and one that crosses the new year", () => {
    const rest = { name: "Rest", startsOn: "2027-12-20", endsOn: "2028-01-05", yearly: true };
    expect(quietOn("2027-12-25", [rest])?.name).toBe("Rest");
    expect(quietOn("2030-01-02", [rest])?.name).toBe("Rest");
    expect(quietOn("2030-01-10", [rest])).toBeNull();
    expect(quietOn("2027-06-01", [rest])).toBeNull();
    const once = { name: "Fast", startsOn: "2027-03-01", endsOn: "2027-04-05", yearly: false };
    expect(quietOn("2027-03-10", [once])?.name).toBe("Fast");
    expect(quietOn("2028-03-10", [once])).toBeNull();
  });
});

describe("skeletonPlan: a first draft from what the organization has", () => {
  const faith = skeletonPlan(ctx({ calendar: [{ title: "Harvest supper", on: "2027-10-10" }, { title: "Founders day", on: "2027-03-04" }], quietPeriods: [{ name: "A season of rest", startsOn: "2027-12-20", endsOn: "2028-01-05", yearly: true }] }), 2027);
  it("is valid by the database's own rules, within sixty moments, in date order, all in the year", () => {
    expect(checkPlan(2027, faith)).toEqual({ ok: true });
    expect(faith.items.length).toBeGreaterThan(10);
    expect(faith.items.length).toBeLessThanOrEqual(MAX_MOMENTS);
    expect(faith.items.map((i) => i.on)).toEqual([...faith.items.map((i) => i.on)].sort());
    expect(faith.items.every((i) => i.on.startsWith("2027"))).toBe(true);
  });
  it("never asks, in any summary, title or note, for any kind of organization", () => {
    for (const audience of ["faith", "civic"] as const) {
      const p = skeletonPlan(ctx({ audience, calendar: [{ title: "Gala", on: "2027-05-05" }], quietPeriods: [{ name: "Lent", startsOn: "2027-02-10", endsOn: "2027-03-28", yearly: true }] }), 2027);
      for (const x of [p.summary, ...p.items.flatMap((i) => [i.title, i.note])]) expect(wordsAsk(x), x).toBe(false);
      expect(p.items.every((i) => i.kind !== ("ask" as string))).toBe(true);
    }
  });
  it("starts from the mission and says who is thanked before anyone is asked", () => {
    expect(faith.summary).toBe("Our mission: To welcome every neighbour. This plan says who we thank, and when, before anyone is asked.");
    expect(skeletonPlan(ctx({ mission: null }), 2027).summary).toBe("This plan says who we thank, and when, before anyone is asked.");
  });
  it("greets households a few days before the organization's own calendar days, and names the quiet periods", () => {
    const titles = faith.items.map((i) => `${i.on} ${i.title}`);
    expect(titles).toContain("2027-10-07 Greet households around Harvest supper");
    expect(titles).toContain("2027-03-01 Greet households around Founders day");
    expect(faith.items.find((i) => i.title === "Quiet period: A season of rest")).toMatchObject({ on: "2027-12-20", group: "all", kind: "greeting" });
  });
  it("a moment inside a quiet period says asks wait", () => {
    const p = skeletonPlan(ctx({ calendar: [{ title: "Midwinter", on: "2027-12-27" }], quietPeriods: [{ name: "A season of rest", startsOn: "2027-12-20", endsOn: "2028-01-05", yearly: true }] }), 2027);
    expect(p.items.find((i) => i.title === "Greet households around Midwinter")?.note).toContain("A quiet period applies (A season of rest)");
  });
  it("thanks before the year closes, in the community's own fiscal year", () => {
    const july = faith.items.find((i) => i.title === "Thank every household before the year closes");
    expect(july?.on).toBe("2027-06-09");
    const january = skeletonPlan(ctx({ fiscalYearStartMonth: 1 }), 2027).items.find((i) => i.title === "Thank every household before the year closes");
    expect(january?.on).toBe("2027-12-10");
  });
  it("only a civic organization gets the day-of-giving thanks, which thank first", () => {
    expect(faith.items.some((i) => /day of giving/i.test(i.title))).toBe(false);
    const civic = skeletonPlan(ctx({ audience: "civic" }), 2027);
    const day = civic.items.filter((i) => /day of giving/i.test(i.title));
    expect(day.map((i) => i.on)).toEqual(["2027-11-16", "2027-12-03"]);
    expect(day.every((i) => i.kind === "thank_you")).toBe(true);
  });
  it("leaves out a group that has no households, and keeps one when the counts are not known", () => {
    const none = skeletonPlan(ctx({ groups: { cooling: 0, steady: 3 } }), 2027);
    expect(none.items.some((i) => i.group === "cooling")).toBe(false);
    expect(none.items.some((i) => i.group === "steady")).toBe(true);
    expect(skeletonPlan(ctx({ groups: {} }), 2027).items.some((i) => i.group === "cooling")).toBe(true);
  });
});

describe("words", () => {
  it("itemLine, byMonth, comingUp and monthName", () => {
    const items = [
      { id: "a1", on: "2027-03-02", title: "B", group: "steady" as const, kind: "thank_you" as const, note: null },
      { id: "a2", on: "2027-03-01", title: "A", group: "all" as const, kind: "greeting" as const, note: null },
      { id: "a3", on: "2027-05-01", title: "C", group: "lapsed" as const, kind: "check_in" as const, note: null },
    ];
    expect(itemLine(items[0])).toBe("A steady giver · Thank-you");
    expect(byMonth(items).map(([m, xs]) => [m, xs.map((x) => x.id)])).toEqual([["March", ["a2", "a1"]], ["May", ["a3"]]]);
    expect(comingUp(items, "2027-03-01", 30).map((i) => i.id)).toEqual(["a2", "a1"]);
    expect(comingUp(items, "2027-03-02", 1).map((i) => i.id)).toEqual(["a1"]);
    expect(monthName(1)).toBe("January");
    expect(monthName(12)).toBe("December");
  });
});
