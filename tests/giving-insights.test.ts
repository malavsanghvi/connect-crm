import { afterEach, describe, expect, it, vi } from "vitest";

import { canSeeInsights, insightsWords, loadGivingInsights } from "@/lib/data/giving-insights";
import { INSIGHTS_SAMPLES, sampleInsights } from "@/lib/giving-insights/fixtures";
import { changeText, concentrationBp, elapsedBp, pace, peakMonth, percentText, perEach, retentionBp, shareBp } from "@/lib/giving-insights/maths";
import { parseInsights } from "@/lib/giving-insights/parse";
import { buildInsightsView } from "@/lib/giving-insights/view";
import { insightsWindow } from "@/lib/giving-insights/window";
import { ROLE_PERMISSIONS } from "@/lib/giving-today/fixtures";
import { givingTabs } from "@/lib/giving-today/tabs";
import { LEGACY_KIND, NEUTRAL_KIND } from "@/lib/kind";

import { fakeDb, fakeSession } from "./commands/helpers";

// What app.giving_insights (0749) answered for supabase/tests/157 (a chamber, CAD, a year from April 1, today October 13, 2026).
const SQL_157 = {
  from: "2026-04-01",
  to: "2026-10-13",
  today: "2026-10-13",
  prev_from: "2025-04-01",
  prev_to: "2025-10-13",
  prev_end: "2026-03-31",
  donations: {
    this_cents: 57000,
    same_point_last_cents: 13000,
    last_year_cents: 14500,
    gifts: 8,
    average_gift_cents: 7125,
    median_gift_cents: 5500,
    households: 7,
    households_same_point_last: 2,
    median_household_cents: 6000,
    member_households: 11,
  },
  fees: { this_cents: 9000, membership_cents: 6000, school_cents: 0, store_cents: 3000 },
  retention: { kept: 2, lost: 1, new: 4, regained: 1 },
  concentration: { households: 7, top_households: null, top_cents: null },
  categories: {
    fund: [{ key: "f1", label: "Scholarship fund", this_cents: 10000, last_cents: 4000 }],
    campaign: [{ key: "c1", label: "Main Street lights", this_cents: 20000, last_cents: 0 }],
    opportunity: [{ key: "o1", label: "Monthly sponsor", this_cents: 3000, last_cents: 0 }],
    applied_this_cents: 33000,
    applied_last_cents: 4000,
  },
  recurring: { this_cents: 3000, active_gifts: 1 },
  pledges: {
    made: 5,
    pledged_cents: 72500,
    paid_cents: 33000,
    written_off_cents: 5000,
    ageing: [
      { bucket: "not_due", pledges: 1, open_cents: 2500 },
      { bucket: "61_90", pledges: 1, open_cents: 30000 },
      { bucket: "over_90", pledges: 2, open_cents: 6000 },
    ],
  },
  pipeline: { overdue_cents: 36000, overdue_pledges: 3, months: [{ month: "2026-10", pledges: 1, open_cents: 2500 }], later_cents: 0 },
  months: [
    { month: "2026-04", this_cents: 5000, last_cents: 0 },
    { month: "2026-09", this_cents: 15000, last_cents: 0 },
    { month: "2027-03", this_cents: 0, last_cents: 1500 },
  ],
  goals: [{ key: "c1", label: "Main Street lights", goal_cents: 100000, starts_on: "2026-04-01", ends_on: "2026-12-31", pledged_cents: 50000, paid_cents: 20000 }],
};

const CHAMBER = {
  currency: "CAD",
  locale: "en-CA",
  yearLabel: "2026-27",
  isCurrentYear: true,
  words: { household: "member business", households: "member businesses", school: null, store: "Store" },
  opportunitiesOn: true,
  recurringOn: false,
};

describe("the database's answer, read defensively", () => {
  it("reads 0749's shape; a missing ageing bucket is zero; anything else is refused", () => {
    const d = parseInsights(SQL_157)!;
    expect(d.donations).toMatchObject({ thisCents: 57000, medianGiftCents: 5500, memberHouseholds: 11 });
    expect(d.pledges.ageing.map((a) => [a.bucket, a.pledges, a.openCents])).toEqual([
      ["not_due", 1, 2500],
      ["1_30", 0, 0],
      ["31_60", 0, 0],
      ["61_90", 1, 30000],
      ["over_90", 2, 6000],
    ]);
    expect(d.concentration).toEqual({ households: 7, topHouseholds: null, topCents: null });
    expect(parseInsights(null)).toBeNull();
    expect(parseInsights({ ...SQL_157, from: "April" })).toBeNull();
  });
});

describe("the arithmetic: integer cents in, whole basis points or cents out", () => {
  it("shares, percentages and changes", () => {
    expect(shareBp(1, 3)).toBe(3333);
    expect(shareBp(5, 0)).toBeNull();
    expect(percentText(4000)).toBe("40%");
    expect(percentText(450)).toBe("4.5%");
    expect(percentText(20)).toBe("under 1%");
    expect(percentText(0)).toBe("0%");
    expect(changeText(57000, 13000)).toBe("+338%");
    expect(changeText(900, 1000)).toBe("-10%");
    expect(changeText(5000, 0)).toBeNull();
    // Shared out in whole cents: 570.00 over 11 member businesses is 51.82 (51.8181…, rounded).
    expect(perEach(57000, 11)).toBe(5182);
    expect(perEach(57000, 0)).toBeNull();
    expect(retentionBp({ kept: 2, lost: 1 })).toBe(6667);
    expect(retentionBp({ kept: 0, lost: 0 })).toBeNull();
  });

  it("the under-10 rule: fewer than 10 giving households never shows the top tenth's share, even if a number came back", () => {
    expect(concentrationBp({ households: 9, topCents: 50000 }, 57000)).toBeNull();
    expect(concentrationBp({ households: 10, topCents: null }, 57000)).toBeNull();
    expect(concentrationBp({ households: 10, topCents: 20000 }, 60000)).toBe(3333);
  });

  it("the biggest month, and a campaign against its own dates", () => {
    expect(peakMonth([{ month: "2026-11", thisCents: 100 }, { month: "2026-12", thisCents: 400 }])).toEqual({ month: "2026-12", shareBp: 8000 });
    expect(peakMonth([{ month: "2026-12", thisCents: 0 }])).toBeNull();
    // April 1 to October 13 is 195 of the 274 days to December 31.
    expect(elapsedBp("2026-04-01", "2026-12-31", "2026-10-13")).toBe(7117);
    expect(elapsedBp("2026-04-01", "2026-12-31", "2027-02-01")).toBe(10000);
    expect(elapsedBp(null, "2026-12-31", "2026-10-13")).toBeNull();
    expect(pace(2000, 7000)).toBe("behind");
    expect(pace(7300, 7000)).toBe("on_pace");
    expect(pace(9000, 7000)).toBe("ahead");
    expect(pace(5000, null)).toBeNull();
  });
});

describe("the financial year", () => {
  it("a year from April: March 31 is still last year, April 1 starts the new one", () => {
    expect(insightsWindow("2026-03-31", 4, null)).toMatchObject({ year: 2025, label: "2025-26", from: "2025-04-01", to: "2026-03-31", isCurrentYear: true });
    expect(insightsWindow("2026-04-01", 4, null)).toMatchObject({ year: 2026, label: "2026-27", from: "2026-04-01", to: "2026-04-01", isCurrentYear: true });
    expect(insightsWindow("2026-10-13", 4, 2025)).toMatchObject({ year: 2025, from: "2025-04-01", to: "2026-03-31", isCurrentYear: false });
    expect(insightsWindow("2026-10-13", 4, null).years.map((y) => [y.label, y.href])).toEqual([
      ["2026-27", "/giving/insights"],
      ["2025-26", "/giving/insights?year=2025"],
      ["2024-25", "/giving/insights?year=2024"],
    ]);
  });

  it("the calendar year, and a year typed in the address that has not started", () => {
    expect(insightsWindow("2026-10-13", 1, null)).toMatchObject({ year: 2026, label: "2026", from: "2026-01-01", to: "2026-10-13" });
    expect(insightsWindow("2026-10-13", 1, 2027)).toMatchObject({ year: 2027, notStarted: true });
    expect(insightsWindow("2026-10-13", 1, 1900).year).toBe(2026);
  });
});

describe("what a person reads", () => {
  it("a chamber of commerce in Canadian dollars: its own words, no faith words, fees on their own line", () => {
    const v = buildInsightsView(parseInsights(SQL_157)!, CHAMBER);
    expect(v.title).toBe("Giving insights, 2026-27");
    expect(v.figures.map((f) => [f.label, f.value])).toEqual([
      ["Given so far", "$570.00"],
      ["Giving member businesses", "7"],
      ["Average gift", "$71.25"],
      ["Median gift", "$55.00"],
      ["Typical year per giving member business", "$60.00"],
      ["Per member business, giving or not", "$51.82"],
    ]);
    expect(v.figures[1].hint).toBe("64% of 11 member businesses (participation)");
    expect(v.retention).toMatchObject({ kept: 2, lost: 1, new: 4, regained: 1, rate: "67%", lostWord: "Not yet this year" });
    expect(v.concentration).toBe("Fewer than 10 member businesses gave in this period, so the share given by the top tenth is not shown.");
    expect(v.fees).toBe("Not counted above: membership fees $60.00, store sales $30.00.");
    expect(v.recurring).toBeNull();
    expect(v.noCategory).toMatchObject({ now: "$240.00", before: "$90.00", change: "+167%" });
    expect(v.goals[0]).toMatchObject({ line: "$200.00 raised of $1,000.00 (20%); $500.00 pledged.", pace: "behind", paceText: "71% of its time has passed: behind the calendar." });
    expect(v.pledges.fulfilment).toBe("46%");
    expect(v.pipeline.overdue).toBe("$360.00 is past due on 3 pledges.");
    const text = JSON.stringify(v);
    for (const w of ["temple", "church", "Jain", "family", "families", "bhandar", "Pathshala"]) expect(text).not.toContain(w);
  });

  it("every sample draws: rupees for the temple, no top-tenth share for a small club, recurring only when its module is on", () => {
    for (const s of INSIGHTS_SAMPLES) expect(() => buildInsightsView(sampleInsights(s).data, sampleInsights(s).ctx)).not.toThrow();
    const temple = buildInsightsView(sampleInsights("temple").data, sampleInsights("temple").ctx);
    expect(temple.figures[0].value).toBe("₹1,47,60,000.00");
    expect(temple.fees).toContain("pathshala fees");
    const small = buildInsightsView(sampleInsights("small").data, sampleInsights("small").ctx);
    expect(small.concentration).toMatch(/^Fewer than 10 households gave/);
    expect(small.retention.lostWord).toBe("Lost");
    expect(small.recurring).toBeNull();
    expect(buildInsightsView(sampleInsights("church").data, sampleInsights("church").ctx).recurring).toMatch(/came through recurring gifts/);
  });

  it("words come from the kind: its own term for a household, no school for a kind without one", () => {
    expect(insightsWords(NEUTRAL_KIND)).toMatchObject({ household: "household", households: "households" });
    expect(insightsWords({ ...NEUTRAL_KIND, terms: { ...NEUTRAL_KIND.terms, household: "member business", households: "member businesses" } })).toMatchObject({
      household: "member business",
      households: "member businesses",
    });
    expect(insightsWords(LEGACY_KIND).school).toBe("Pathshala");
  });
});

describe("who sees Insights, and a module that is off", () => {
  afterEach(() => vi.useRealTimers());
  const treasurer = ROLE_PERMISSIONS.treasurer;

  it("the tab: giving staff with the module on; never a finance volunteer or a second approver", () => {
    const tabs = (permissions: string[], modulesOff: string[] = []) => givingTabs({ permissions, isPlatformAdmin: false, modulesOff, kind: NEUTRAL_KIND }).map((t) => t.key);
    expect(tabs(treasurer)).toContain("insights");
    expect(givingTabs({ permissions: treasurer, isPlatformAdmin: false, modulesOff: [], kind: NEUTRAL_KIND }).find((t) => t.key === "insights")).toMatchObject({
      label: "Insights",
      href: "/giving/insights",
    });
    expect(tabs(treasurer, ["giving_insights"])).not.toContain("insights");
    expect(tabs(ROLE_PERMISSIONS.volunteer)).not.toContain("insights");
    expect(tabs(ROLE_PERMISSIONS.approver)).not.toContain("insights");
    expect(canSeeInsights({ permissions: treasurer, isPlatformAdmin: false, modulesOff: ["giving_insights"] })).toBe(false);
  });

  it("the loader: switched off, no access, the database's refusal said in plain English, and the numbers", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-13T15:00:00Z"), toFake: ["Date"] });
    const session = (permissions: string[], modulesOff: string[] = [], db = fakeDb({ rpc: { giving_insights: SQL_157 } })) =>
      fakeSession({ db, permissions, modulesOff, kind: NEUTRAL_KIND, center: { ...fakeSession().center, currency: "CAD", country: "CA", time_zone: "America/Toronto" } });
    expect(await loadGivingInsights(session(treasurer, ["giving_insights"]), null)).toEqual({ state: "off" });
    expect(await loadGivingInsights(session(ROLE_PERMISSIONS.volunteer), null)).toEqual({ state: "no_access" });
    const refused = await loadGivingInsights(session(treasurer, [], fakeDb({ failRpc: { giving_insights: { code: "P0001", message: "The Insights module is switched off for this community." } } })), null);
    expect(refused).toMatchObject({ state: "error", year: 2026 });
    expect(refused.state === "error" && refused.error).toMatch(/^Could not add up the giving numbers — /);
    const db = fakeDb({ rpc: { giving_insights: SQL_157 } });
    const ok = await loadGivingInsights(session(treasurer, [], db), null);
    expect(ok.state).toBe("ok");
    expect(db.rpcCalls.find((c) => c.fn === "giving_insights")?.args).toEqual({ p_center: "center-1", p_from: "2026-01-01", p_to: "2026-10-13", p_today: "2026-10-13" });
    expect(ok.state === "ok" && ok.view.figures[0].value).toBe("$570.00");
  });
});
