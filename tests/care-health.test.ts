import { describe, expect, it } from "vitest";

import {
  HEALTH_LABEL,
  agoLine,
  balanceOk,
  canCompareYears,
  classifyHealth,
  compareNote,
  daysBetween,
  parseCareDashboard,
  parseHealthFacts,
  perAskLine,
  percent,
  retentionLine,
  type HealthFacts,
} from "@/lib/care/health";

const TODAY = "2026-10-16";
const ctx = { today: TODAY, historyMonths: 30, giving: true };
const facts = (over: Partial<HealthFacts> = {}): HealthFacts => ({
  householdId: "h1", gifts12: 0, giftsPrev12: 0, firstGiftOn: null, lastGiftOn: null, part12: 0, lastPartOn: null, opened12: 0,
  touches12: 0, asks12: 0, noAsk12: 0, lastTouchAt: null, unthanked: null, ...over,
});

describe("reading the facts", () => {
  it("reads the rows and the community's history, and drops a row with no household", () => {
    const a = parseHealthFacts({
      today: TODAY, history_months: 26, giving: true,
      rows: [{ household_id: "h1", gifts_12: 3, gifts_prev_12: 2, last_gift_on: "2026-09-26", part_12: 2, last_part_on: "2026-10-06", touches_12: 4, asks_12: 1, no_ask_12: 3, unthanked: 1 }, { gifts_12: 9 }],
    });
    expect(a.historyMonths).toBe(26);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]).toMatchObject({ householdId: "h1", gifts12: 3, giftsPrev12: 2, lastGiftOn: "2026-09-26", part12: 2, noAsk12: 3, unthanked: 1, firstGiftOn: null });
  });
});

describe("the level of a household, with its reasons", () => {
  it("is Thriving with steady giving, taking part and the touches in balance", () => {
    const h = classifyHealth(facts({ gifts12: 4, giftsPrev12: 2, lastGiftOn: "2026-10-01", part12: 2, lastPartOn: "2026-10-06", touches12: 4, asks12: 1, noAsk12: 3 }), ctx);
    expect(h.level).toBe("thriving");
    expect(h.reasons[0]).toBe("Steady giving, taking part, and the touches are in balance");
    expect(h.reasons).toContain("Gave 4 times in the last 12 months (2 the year before)");
    expect(h.reasons).toContain("3 no-ask touches and 1 ask in the last 12 months");
  });

  it("is Steady when it gives but does not take part, or the asks outrun the care", () => {
    expect(classifyHealth(facts({ gifts12: 2, giftsPrev12: 2, lastGiftOn: "2026-10-01" }), ctx).level).toBe("steady");
    expect(classifyHealth(facts({ gifts12: 2, giftsPrev12: 2, lastGiftOn: "2026-10-01", part12: 1, lastPartOn: "2026-10-01", asks12: 2, noAsk12: 3, touches12: 5 }), ctx).level).toBe("steady");
  });

  it("is Cooling when it gives less than the year before, or has not given for six months", () => {
    const fewer = classifyHealth(facts({ gifts12: 1, giftsPrev12: 3, lastGiftOn: "2026-10-01" }), ctx);
    expect(fewer.level).toBe("cooling");
    expect(fewer.reasons[0]).toBe("Gave fewer times (1) than the year before (3)");
    const quiet = classifyHealth(facts({ gifts12: 1, giftsPrev12: 1, lastGiftOn: "2026-02-01", part12: 1, lastPartOn: "2026-09-01" }), ctx);
    expect(quiet.level).toBe("cooling");
    expect(quiet.reasons[0]).toMatch(/^No gift for \d+ months$/);
  });

  it("is At risk when it gave the year before and nothing in the last 12 months", () => {
    const h = classifyHealth(facts({ gifts12: 0, giftsPrev12: 2, lastGiftOn: "2025-08-01" }), ctx);
    expect(h.level).toBe("at_risk");
    expect(h.reasons[0]).toBe("Gave 2 times the year before, and not in the last 12 months");
  });

  it("is Lapsed after 18 months of nothing, and that outranks At risk", () => {
    const h = classifyHealth(facts({ giftsPrev12: 1, lastGiftOn: "2025-02-01" }), ctx);
    expect(h.level).toBe("lapsed");
    expect(h.reasons[0]).toMatch(/^Nothing on record for \d+ months$/);
  });

  it("counts taking part as activity: a household that never gave but serves is not Lapsed", () => {
    expect(classifyHealth(facts({ part12: 3, lastPartOn: "2026-10-01" }), ctx).level).toBe("steady");
  });

  it("says No activity yet for a household with nothing on record, and Not enough history yet when the community is new", () => {
    expect(classifyHealth(facts(), ctx).level).toBe("none");
    const fresh = classifyHealth(facts({ gifts12: 2, lastGiftOn: "2026-10-01" }), { ...ctx, historyMonths: 4 });
    expect(fresh.level).toBe("not_enough_history");
    expect(fresh.reasons[0]).toBe("The community has about 4 months of records in Weaver; a sign needs about a year");
    expect(fresh.reasons).toContain("Gave 2 times in the last 12 months");
    expect(classifyHealth(facts(), { ...ctx, historyMonths: 0 }).reasons[0]).toContain("no records");
  });

  it("leaves the gift rules out when Giving is off (member care alone)", () => {
    const noGiving = { ...ctx, giving: false };
    expect(classifyHealth(facts({ part12: 2, lastPartOn: "2026-10-01" }), noGiving).level).toBe("thriving");
    expect(classifyHealth(facts({ part12: 2, lastPartOn: "2026-10-01", asks12: 2, noAsk12: 1, touches12: 3 }), noGiving).level).toBe("steady");
    expect(classifyHealth(facts({ giftsPrev12: 3, lastGiftOn: "2025-12-01", lastPartOn: "2026-09-01", part12: 1 }), noGiving).reasons.join(" ")).not.toContain("Gave");
  });

  it("names the gifts not yet thanked, and never an amount", () => {
    const h = classifyHealth(facts({ gifts12: 2, giftsPrev12: 2, lastGiftOn: "2026-10-01", unthanked: 2 }), ctx);
    expect(h.reasons).toContain("2 gifts not yet thanked".replace("not yet thanked", "not thanked yet"));
    expect(h.reasons.join(" ")).not.toMatch(/\$|cents/);
  });

  it("has a label for every level", () => {
    expect(HEALTH_LABEL.at_risk).toBe("At risk");
    expect(Object.keys(HEALTH_LABEL)).toHaveLength(7);
  });
});

describe("the small rules", () => {
  it("keeps three no-ask touches for every ask as the balance, and no ask as balanced", () => {
    expect(balanceOk({ asks12: 0, noAsk12: 0 })).toBe(true);
    expect(balanceOk({ asks12: 1, noAsk12: 3 })).toBe(true);
    expect(balanceOk({ asks12: 2, noAsk12: 5 })).toBe(false);
  });

  it("counts days and says how long ago in words", () => {
    expect(daysBetween("2026-10-01", "2026-10-16")).toBe(15);
    expect(agoLine("2026-10-16", TODAY)).toBe("today");
    expect(agoLine("2026-10-15", TODAY)).toBe("yesterday");
    expect(agoLine("2026-10-10", TODAY)).toBe("6 days ago");
    expect(agoLine("2026-09-01", TODAY)).toBe("6 weeks ago");
    expect(agoLine("2026-03-16", TODAY)).toBe("7 months ago");
    expect(agoLine("2023-10-16", TODAY)).toBe("3 years ago");
  });
});

describe("the organization's numbers", () => {
  const d = parseCareDashboard({
    state: "ok", today: TODAY, history_months: 26,
    giving: { donors_last: 2, donors_prev: 3, kept: 2, lybunt: 1, sybunt: 2, retention: 0.667, first_year: { cohort: 3, kept: 2, rate: 0.667 } },
    thanks: { gifts: 5, thanked: 3, open: 2, overdue: 2, median_hours: 60.5, on_time_share: 0.6 },
    touches: { asks: 1, no_ask: 3, per_ask: 3.0 },
    key: { households: 3, with_owner: 2, share: 0.667 },
  });

  it("reads every number, and the parts that are not there (Giving off, rules not saved) as null", () => {
    expect(d.giving).toMatchObject({ donorsLast: 2, kept: 2, lybunt: 1, sybunt: 2, retention: 0.667, firstYear: { cohort: 3, kept: 2, rate: 0.667 } });
    expect(d.thanks).toMatchObject({ gifts: 5, medianHours: 60.5, onTimeShare: 0.6 });
    expect(d.key).toEqual({ households: 3, withOwner: 2, share: 0.667 });
    const bare = parseCareDashboard({ state: "ok", giving: null, thanks: null, touches: {}, key: {} });
    expect(bare.giving).toBeNull();
    expect(bare.thanks).toBeNull();
    expect(bare.touches.perAsk).toBeNull();
  });

  it("shows retention as a percent once there are about two years, and says why not before", () => {
    expect(percent(0.667)).toBe("67%");
    expect(percent(null)).toBeNull();
    expect(retentionLine(0.667, 26)).toBe("67%");
    expect(retentionLine(null, 26)).toBe("No one gave the year before");
    expect(retentionLine(0.667, 14)).toBe("Not enough yet");
    expect(canCompareYears(22)).toBe(false);
    expect(canCompareYears(23)).toBe(true);
    expect(compareNote(14)).toBe("Weaver has about 14 months of records; this compares two years");
    expect(compareNote(0)).toBe("Weaver has no records; this compares two years");
  });

  it("says the touch balance against the aim", () => {
    expect(perAskLine(3.0)).toBe("3.0 for each ask");
    expect(perAskLine(1.5)).toBe("1.5 for each ask (aim for 3 or more)");
    expect(perAskLine(null)).toBe("No ask recorded in the last 12 months");
  });
});
