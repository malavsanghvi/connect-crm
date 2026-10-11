import { describe, expect, it } from "vitest";

import { pageFigures } from "@/lib/reports/figures";
import { parseMembershipMatrix, parsePaymentsSummary, parsePeopleOverview, parsePledgesSummary } from "@/lib/reports/parse";

import {
  CAMPAIGN_A,
  CAMPAIGN_B,
  MATRIX,
  PAY_2025_TO_DATE,
  PAY_2026_BY_METHOD,
  PEOPLE_2026,
  PLEDGES_2026,
} from "./answers";
import { FIXTURE_2026, legacyFigures } from "./legacy";

// The Reports page used to add the figures up from the rows. This holds the page's new figures (what the database answers for the same
// community, supabase/tests/128_reports_reads_test.sql, drawn by src/lib/reports/figures.ts) against the old arithmetic on the same rows:
// the page must show the same numbers it always did.
describe("the Reports page shows the numbers it always did", () => {
  const old = legacyFigures(FIXTURE_2026);
  const fig = pageFigures({
    people: parsePeopleOverview(PEOPLE_2026),
    matrix: parseMembershipMatrix(MATRIX),
    payments: parsePaymentsSummary(PAY_2026_BY_METHOD),
    prevPayments: parsePaymentsSummary(PAY_2025_TO_DATE),
    pledges: parsePledgesSummary(PLEDGES_2026),
  });

  it("households, new ones, the share on the app, and the zones", () => {
    expect(fig.households).toBe(old.households);
    expect(fig.newInYear).toBe(old.newThisYear);
    expect(fig.onAppPct).toBe(old.onAppPct);
    expect(fig.zones.map((z) => [z.zone, z.households])).toEqual(old.zoneRows.map(([zone, n]) => [zone, n]).sort((a, b) => (b[1] as number) - (a[1] as number) || String(a[0]).localeCompare(String(b[0]))));
  });

  it("memberships by tier and status, households counted once per tier, applications by status", () => {
    for (const tier of ["life", "yearly", "community"]) {
      for (const status of ["active", "pending", "lapsed", "suspended", "ended"]) {
        expect(fig.membershipCell(tier, status), `${tier} ${status}`).toBe(old.matrix.get(`${tier}|${status}`) ?? 0);
      }
      expect(fig.activeHouseholds(tier), tier).toBe(old.activeHouseholds.get(tier)?.size ?? 0);
    }
    expect(fig.applicationCounts).toEqual(Object.fromEntries(old.appCounts));
  });

  it("money given, last year's, and open pledges", () => {
    expect(fig.givenYtd).toBe(old.givenYtd);
    expect(fig.givenPrev).toBe(old.givenPrev);
    expect(fig.openPledgesCents).toBe(old.openCents);
    expect(old.givenYtd).toBe(101700);
  });

  it("money received by method, the largest net first", () => {
    const expected = [...old.byMethod.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([method, t]) => ({ method, payments: t.count, netCents: t.amount }));
    expect(fig.methods).toEqual(expected);
  });

  it("each campaign: pledges, pledged, paid, written off and what is still owed", () => {
    const name: Record<string, string | null> = { A: CAMPAIGN_A, B: CAMPAIGN_B, none: null };
    const expected = old.campaignRows.map(([key, t]) => ({
      campaignId: name[key],
      pledges: t.count,
      pledgedCents: t.pledged,
      paidCents: t.paid,
      writtenOffCents: t.writtenOff,
      outstandingCents: t.pledged - t.paid - t.writtenOff,
    }));
    expect(fig.campaigns.map(({ campaignId, pledges, pledgedCents, paidCents, writtenOffCents, outstandingCents }) => ({ campaignId, pledges, pledgedCents, paidCents, writtenOffCents, outstandingCents }))).toEqual(expected);
  });
});

describe("a section the person cannot see draws nothing", () => {
  it("gives empty figures, never numbers nobody counted", () => {
    const fig = pageFigures({ people: null, matrix: null, payments: null, prevPayments: null, pledges: null });
    expect(fig.households).toBeNull();
    expect(fig.onAppPct).toBeNull();
    expect(fig.openPledgesCents).toBeNull();
    expect(fig.methods).toEqual([]);
    expect(fig.campaigns).toEqual([]);
    expect(fig.membershipCell("yearly", "active")).toBe(0);
  });
});
