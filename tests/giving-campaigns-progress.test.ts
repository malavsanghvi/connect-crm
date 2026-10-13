import { describe, expect, it } from "vitest";

import { totalsByCampaign, orderCampaigns } from "@/lib/giving-campaigns/model";
import { campaignProgress, percentOf, progressWords } from "@/lib/giving-campaigns/progress";

const base = { goalCents: 5_000_000, pledgedCents: 1_240_000, receivedCents: 800_000, startsOn: "2026-09-01", endsOn: "2026-12-31", today: "2026-10-13" };

describe("campaign progress (integer cents, the campaign's own goal and dates)", () => {
  it("pledged and received against the goal, rounded down, in whole per cent", () => {
    const p = campaignProgress(base);
    expect(p).toMatchObject({ goalCents: 5_000_000, pledgedPercent: 24, receivedPercent: 16, pledgedBar: 24, receivedBar: 16 });
    // 49.999 % is still 49 %: a goal is never shown as reached before it is.
    expect(campaignProgress({ ...base, goalCents: 1_000_000, pledgedCents: 999_999 }).pledgedPercent).toBe(99);
    expect(percentOf(1, 3)).toBe(33);
  });

  it("a beaten goal says how far past it, and the bar stops at the goal", () => {
    const p = campaignProgress({ ...base, goalCents: 1_000_000, pledgedCents: 1_200_000, receivedCents: 1_150_000 });
    expect(p.pledgedPercent).toBe(120);
    expect(p.pledgedBar).toBe(100);
    expect(p.receivedBar).toBe(100);
  });

  it("a gift too small to round to 1 % still shows a sliver; nothing pledged shows nothing", () => {
    expect(campaignProgress({ ...base, goalCents: 100_000_000, pledgedCents: 500 }).pledgedBar).toBe(1);
    expect(campaignProgress({ ...base, goalCents: 100_000_000, pledgedCents: 500 }).pledgedPercent).toBe(0);
    expect(campaignProgress({ ...base, pledgedCents: 0, receivedCents: 0 }).pledgedBar).toBe(0);
  });

  it("no goal: no per cent and no bar, never an invented target", () => {
    const p = campaignProgress({ ...base, goalCents: null });
    expect(p).toMatchObject({ goalCents: null, pledgedPercent: null, receivedPercent: null, pledgedBar: 0, receivedBar: 0 });
    expect(campaignProgress({ ...base, goalCents: 0 }).goalCents).toBeNull();
    const w = progressWords(p, { pledgedCents: 320_000, receivedCents: 150_000 }, "USD");
    expect(w.pledged).toBe("No goal set · $3,200.00 pledged");
    expect(w.received).toBe("Received $1,500.00");
  });

  it("very large amounts stay exact", () => {
    expect(percentOf(9_000_000_000_000_00, 10_000_000_000_000_00)).toBe(90);
    expect(campaignProgress({ ...base, goalCents: 10 ** 17, pledgedCents: 9 * 10 ** 16 }).pledgedPercent).toBe(90);
  });

  it("time: before, during, after, open-ended and end-only campaigns; no dates means no line", () => {
    expect(campaignProgress({ ...base, startsOn: "2026-10-01", endsOn: "2026-10-30" }).time).toEqual({ state: "running", elapsedDays: 13, totalDays: 30, percent: 43 });
    expect(campaignProgress({ ...base, startsOn: "2026-10-13", endsOn: "2026-10-13" }).time).toEqual({ state: "running", elapsedDays: 1, totalDays: 1, percent: 100 });
    expect(campaignProgress({ ...base, startsOn: "2026-10-20", endsOn: null }).time).toEqual({ state: "not_started", days: 7 });
    expect(campaignProgress({ ...base, startsOn: "2026-05-01", endsOn: "2026-08-31" }).time).toEqual({ state: "ended" });
    expect(campaignProgress({ ...base, startsOn: "2026-10-01", endsOn: null }).time).toEqual({ state: "open_ended", elapsedDays: 13 });
    expect(campaignProgress({ ...base, startsOn: null, endsOn: "2026-10-20" }).time).toEqual({ state: "days_left", days: 7 });
    expect(campaignProgress({ ...base, startsOn: null, endsOn: null }).time).toBeNull();
    expect(campaignProgress({ ...base, startsOn: "not a date", endsOn: "" }).time).toBeNull();
  });

  it("words in the community's currency and locale", () => {
    const p = campaignProgress(base);
    const totals = { pledgedCents: 1_240_000, receivedCents: 800_000 };
    expect(progressWords(p, totals, "USD")).toEqual({ pledged: "Pledged $12,400.00 of $50,000.00 (24%)", received: "Received $8,000.00 (16%)", time: "43 of 122 days passed" });
    const eur = progressWords(p, totals, "EUR", "de-DE");
    expect(eur.pledged).toContain("12.400,00");
    expect(eur.pledged).toContain("€");
    const inr = progressWords(p, totals, "INR", "en-IN");
    expect(inr.pledged).toContain("₹");
    expect(progressWords(campaignProgress({ ...base, startsOn: "2026-10-14", endsOn: null }), totals, "USD").time).toBe("Starts in 1 day");
    expect(progressWords(campaignProgress({ ...base, startsOn: null, endsOn: "2026-10-13" }), totals, "USD").time).toBe("Ends today");
    expect(progressWords(campaignProgress({ ...base, startsOn: "2026-10-13", endsOn: null }), totals, "USD").time).toBe("Running for 1 day, no end date");
  });
});

describe("totals and order", () => {
  it("adds pledged and received per campaign in integer cents", () => {
    const t = totalsByCampaign([
      { campaign_id: "a", amount_cents: 10_001, paid_cents: 5_000 },
      { campaign_id: "a", amount_cents: 20_002, paid_cents: 0 },
      { campaign_id: "b", amount_cents: 7, paid_cents: 7 },
      { campaign_id: null, amount_cents: 99_999, paid_cents: 99_999 },
    ]);
    expect(t.get("a")).toEqual({ pledgedCents: 30_003, receivedCents: 5_000, pledges: 2 });
    expect(t.get("b")).toEqual({ pledgedCents: 7, receivedCents: 7, pledges: 1 });
    expect(t.size).toBe(2);
  });

  it("running campaigns first, then drafts, then closed; newest first inside each", () => {
    const rows = [
      { id: "d1", status: "draft" },
      { id: "c1", status: "closed" },
      { id: "p1", status: "published" },
      { id: "d2", status: "draft" },
      { id: "p2", status: "published" },
    ];
    expect(orderCampaigns(rows).map((r) => r.id)).toEqual(["p1", "p2", "d1", "d2", "c1"]);
  });
});
