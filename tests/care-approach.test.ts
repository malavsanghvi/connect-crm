import { describe, expect, it } from "vitest";

import {
  DOES_NOT_USE,
  USES,
  WEIGHT_KEYS,
  checkQuiet,
  checkSettings,
  holdLine,
  listLine,
  parseApproach,
  parseApproachHousehold,
  parseApproachSettings,
  rangeLine,
  signalLine,
  signalLines,
  stateLine,
  type Hold,
} from "@/lib/care/approach";

// DonorDelight slice 7 (0895): who to approach, held behind the touch balance, in words.

const money = (c: number) => `$${(c / 100).toLocaleString("en-US")}`;
const household = (id: string, name: string) => ({ id, name, number: `GC-${id}`, org_household_id: null, city: "Austin", zone: null, primary_member: name, adults: [], merged: false });
const ANSWER = {
  state: "ok", ready_total: 1, held_total: 2, not_shown: 3, fund: null, funds: [{ id: "f1", name: "Roof fund" }, { name: "no id" }], amounts: true, all: true, touch_balance: 3, rest_days: 60,
  can_manage: true, label: "Member care", today: "2026-10-17",
  ready: [
    { household: household("h1", "Mensah, Ama"), owner: "Ravi", state: "ready", holds: [], score: 55,
      signals: [{ key: "years", points: 32, n: 4 }, { key: "recent", points: 15, days: 30 }, { key: "took_part", points: 8, n: 2 }, { key: "well_thanked", points: 0 }],
      last_gift_on: "2026-09-17", last_ask_on: null, no_ask_since: 3, gifts: 4, range: { low: 13500, high: 20000, n: 4 } },
  ],
  held: [
    { household: household("h2", "Okafor, Chidi"), state: "held", holds: [{ code: "balance", have: 2, need: 3 }], score: 31, signals: [], last_gift_on: "2026-08-01", last_ask_on: "2026-07-19", no_ask_since: 2, gifts: 3, range: null },
    { household: { name: "no id" }, state: "held", holds: [] },
  ],
};

describe("parseApproach", () => {
  const l = parseApproach(ANSWER);
  it("reads the ready and held rows (one with no household is dropped), the counts and the funds", () => {
    expect(l.state).toBe("ok");
    expect(l.ready.map((r) => [r.household.name, r.score, r.state])).toEqual([["Mensah, Ama", 55, "ready"]]);
    expect(l.held.map((r) => r.household.name)).toEqual(["Okafor, Chidi"]);
    expect(l.readyTotal).toBe(1);
    expect(l.heldTotal).toBe(2);
    expect(l.notShown).toBe(3);
    expect(l.funds).toEqual([{ id: "f1", name: "Roof fund" }]);
    expect(l.touchBalance).toBe(3);
    expect(l.restDays).toBe(60);
    expect(l.all).toBe(true);
    expect(l.ready[0].range).toEqual({ low: 13500, high: 20000, n: 4 });
    expect(l.held[0].range).toBeNull();
  });
  it("off, giving off and nonsense are safe", () => {
    expect(parseApproach({ state: "off", can_manage: true }).state).toBe("off");
    expect(parseApproach({ state: "giving_off" }).state).toBe("giving_off");
    expect(parseApproach(null)).toMatchObject({ state: "ok", ready: [], held: [], notShown: 0, restDays: 60, touchBalance: 3, label: "DonorDelight" });
  });
  it("an unknown hold or signal is dropped, never guessed", () => {
    const odd = parseApproach({ ready: [{ household: household("h", "X"), state: "ready", holds: [{ code: "wealth" }, { code: "thank", n: 2 }], signals: [{ key: "net_worth", points: 99 }, { key: "years", points: 8, n: 1 }] }] });
    expect(odd.ready[0].holds).toEqual([{ code: "thank", n: 2 }]);
    expect(odd.ready[0].signals).toEqual([{ key: "years", points: 8, n: 1, days: 0 }]);
  });
  it("the household answer for the card", () => {
    expect(parseApproachHousehold({ state: "off" })).toEqual({ state: "off" });
    expect(parseApproachHousehold({ state: "no_history" })).toEqual({ state: "no_history" });
    const a = parseApproachHousehold({ state: "held", holds: [{ code: "rest", last_ask_on: "2026-10-01", until: "2026-11-30" }], score: 20, signals: [], no_ask_since: 1, gifts: 2, touch_balance: 3, rest_days: 60 });
    expect(a).toMatchObject({ state: "held", holds: [{ code: "rest", lastAskOn: "2026-10-01", until: "2026-11-30" }], touchBalance: 3, range: null });
  });
});

describe("holds are said in words, each an instruction", () => {
  it("every hold", () => {
    const h = (x: Hold) => holdLine(x);
    expect(h({ code: "pledge", days: 70 })).toBe("Behind on a pledge by 70 days: remind them, do not ask");
    expect(h({ code: "thank", n: 1 })).toBe("A gift has not been thanked yet: thank them first");
    expect(h({ code: "thank", n: 3 })).toBe("3 gifts have not been thanked yet: thank them first");
    expect(h({ code: "rest", lastAskOn: "2026-10-01", until: "2026-11-30" })).toBe("Asked on 1 October 2026: they rest until 30 November 2026");
    expect(h({ code: "balance", have: 2, need: 3 })).toBe("Not yet: 2 of 3 touches with no ask since the last ask. One more first");
    expect(h({ code: "balance", have: 0, need: 3 })).toBe("Not yet: 0 of 3 touches with no ask since the last ask. 3 more first");
    expect(h({ code: "quiet", name: "A season of fasting", until: "2026-11-05" })).toBe("Quiet period: A season of fasting until 5 November 2026. Asks wait");
  });
});

describe("the score's reasons", () => {
  it("each signal that counted is a sentence with its points; one that did not is left out", () => {
    const l = parseApproach(ANSWER);
    expect(signalLines(l.ready[0].signals)).toEqual([
      "Gave in 4 of the last 5 years (+32)",
      "Last gift 1 month ago (+15)",
      "Took part in the last 12 months: 2 events or shifts (+8)",
    ]);
    expect(signalLine({ key: "well_thanked", points: 4, n: 0, days: 0 })).toBe("Every gift thanked (+4)");
    expect(signalLine({ key: "years", points: 0, n: 0, days: 0 })).toBeNull();
  });
  it("the points add up to the score", () => {
    const r = parseApproach(ANSWER).ready[0];
    expect(r.signals.reduce((a, s) => a + s.points, 0)).toBe(r.score);
  });
  it("no signal names anything the plan forbids", () => {
    const words = JSON.stringify([signalLines(parseApproach(ANSWER).ready[0].signals), USES]).toLowerCase();
    for (const bad of ["religion", "caste", "ethnic", "gender", "income", "property", "occupation", "wealth", "birth"]) expect(words).not.toContain(bad);
    expect(DOES_NOT_USE.join(" ")).toContain("wealth screening");
    expect(DOES_NOT_USE.join(" ")).toContain("under 18");
  });
});

describe("the range from the household's own gifts", () => {
  it("is rounded outwards, never one number, with how many gifts it comes from", () => {
    expect(rangeLine({ low: 13500, high: 20000, n: 4 }, money)).toBe("$130 to $200, from 4 gifts of their own");
    expect(rangeLine({ low: 10000, high: 10000, n: 3 }, money)).toBe("About $100, from 3 gifts of their own");
    expect(rangeLine({ low: 120000, high: 260000, n: 5 }, money)).toBe("$1,200 to $2,600, from 5 gifts of their own");
    expect(rangeLine(null, money)).toBeNull();
  });
  it("a tiny gift still shows a whole step", () => {
    expect(rangeLine({ low: 300, high: 700, n: 3 }, money)).toBe("$10 to $10, from 3 gifts of their own".replace("$10 to $10", "About $10"));
  });
});

describe("the list's headline and the card's line", () => {
  it("counts what is ready, held and not shown", () => {
    expect(listLine({ readyTotal: 1, heldTotal: 4, notShown: 0 })).toBe("1 household ready · 4 held");
    expect(listLine({ readyTotal: 3, heldTotal: 0, notShown: 2 })).toBe("3 households ready · 0 held · 2 not shown");
  });
  it("the card says ready, not yet, or do not ask, and nothing otherwise", () => {
    expect(stateLine({ state: "ready", holds: [], score: 0, signals: [], lastGiftOn: null, lastAskOn: null, noAskSince: 0, gifts: 0, touchBalance: 3, restDays: 60, range: null })).toBe("Ready for an ask, when you choose to ask");
    expect(stateLine({ state: "held", holds: [], score: 0, signals: [], lastGiftOn: null, lastAskOn: null, noAskSince: 0, gifts: 0, touchBalance: 3, restDays: 60, range: null })).toBe("Not yet");
    expect(stateLine({ state: "excluded", holds: [], score: 0, signals: [], lastGiftOn: null, lastAskOn: null, noAskSince: 0, gifts: 0, touchBalance: 3, restDays: 60, range: null })).toBe("Do not ask");
    expect(stateLine({ state: "off" })).toBeNull();
    expect(stateLine({ state: "no_history" })).toBeNull();
  });
});

describe("settings: the same rules as the database", () => {
  const weights = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 5])) as Record<(typeof WEIGHT_KEYS)[number], number>;
  it("parses the settings, with their defaults and quiet periods", () => {
    const s = parseApproachSettings({
      enabled: true, touch_balance: 4, rest_days: 0, weights: { years_per: 8, years_max: 40, recent_12: 15, recent_24: 10, recent_36: 5, took_part: 8, well_thanked: 4 },
      defaults: { years_per: 8 }, can_manage: true, quiet_periods: [{ id: "q1", name: "Lent", starts_on: "2027-02-10", ends_on: "2027-03-28", yearly: true }, { name: "no id" }],
    });
    expect(s).toMatchObject({ enabled: true, touchBalance: 4, restDays: 0, canManage: true });
    expect(s.weights.recent_12).toBe(15);
    expect(s.quietPeriods).toEqual([{ id: "q1", name: "Lent", startsOn: "2027-02-10", endsOn: "2027-03-28", yearly: true }]);
    expect(parseApproachSettings(null)).toMatchObject({ enabled: false, touchBalance: 3, restDays: 60, quietPeriods: [] });
  });
  it("checkSettings", () => {
    expect(checkSettings({ touchBalance: 3, restDays: 60, weights })).toEqual({ ok: true });
    expect(checkSettings({ touchBalance: 0, restDays: 60, weights })).toEqual({ ok: false, error: "The touch balance is 1 to 10 touches with no ask for every ask." });
    expect(checkSettings({ touchBalance: 3, restDays: 400, weights })).toEqual({ ok: false, error: "The rest after an ask is 0 to 365 days." });
    expect(checkSettings({ touchBalance: 3, restDays: 60, weights: { ...weights, took_part: 51 } })).toEqual({ ok: false, error: "A weight is 0 to 50 points (the most for years is 100)." });
    expect(checkSettings({ touchBalance: 3, restDays: 60, weights: { ...weights, years_max: 100 } })).toEqual({ ok: true });
  });
  it("checkQuiet", () => {
    expect(checkQuiet({ name: "Lent", startsOn: "2027-02-10", endsOn: "2027-03-28", yearly: true })).toEqual({ ok: true });
    expect(checkQuiet({ name: " ", startsOn: "2027-02-10", endsOn: "2027-03-28", yearly: false })).toEqual({ ok: false, error: "Give the quiet period a name of up to 80 characters." });
    expect(checkQuiet({ name: "x", startsOn: "", endsOn: "2027-03-28", yearly: false })).toEqual({ ok: false, error: "Say when the quiet period starts and ends." });
    expect(checkQuiet({ name: "x", startsOn: "2027-03-28", endsOn: "2027-02-10", yearly: false })).toEqual({ ok: false, error: "A quiet period cannot end before it starts." });
    expect(checkQuiet({ name: "x", startsOn: "2026-01-01", endsOn: "2027-06-01", yearly: false })).toEqual({ ok: false, error: "A quiet period is at most a year long." });
  });
});
