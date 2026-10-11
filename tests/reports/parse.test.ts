import { describe, expect, it } from "vitest";

import {
  cellCount,
  onAppPercent,
  outstandingCents,
  parseAttendance,
  parseCommunitySummary,
  parseMembershipChanges,
  parseMembershipMatrix,
  parsePaymentsSummary,
  parsePeopleOverview,
  parsePeriodFigures,
  parsePlatformWaiting,
  parsePledgesSummary,
  parseStoreSales,
} from "@/lib/reports/parse";

import {
  ATTENDANCE_2026,
  CHANGES,
  FIGURES_SEP,
  MATRIX,
  PAY_2026_BY_FUND,
  PAY_2026_BY_METHOD,
  PEOPLE_2026,
  PLEDGES_2026,
  SHOP_2026,
} from "./answers";

describe("reading what the database answers", () => {
  it("reads the household figures", () => {
    const p = parsePeopleOverview(PEOPLE_2026);
    expect(p).toMatchObject({ households: 4, newInYear: 3, householdsOnApp: 2, renewalsDue: 1 });
    expect(p?.zones).toEqual(PEOPLE_2026.zones);
    expect(onAppPercent(p!)).toBe(50);
    expect(onAppPercent({ households: 0, householdsOnApp: 0 })).toBeNull();
    expect(onAppPercent({ households: 3, householdsOnApp: 1 })).toBe(33);
    expect(onAppPercent({ households: 8, householdsOnApp: 5 })).toBe(63);
  });

  it("reads the membership table", () => {
    const m = parseMembershipMatrix(MATRIX)!;
    expect(cellCount(m, "yearly", "active")).toBe(2);
    expect(cellCount(m, "yearly", "pending")).toBe(0);
    expect(m.activeHouseholds).toEqual({ life: 1, yearly: 2 });
    expect(m.applications).toEqual({ awaiting_center: 2, withdrawn: 1 });
    expect(parseMembershipChanges(CHANGES)).toMatchObject({ startedTotal: 2, endedTotal: 2, applicationsTotal: 2, activeNow: 3, renewalsDue60Days: 1 });
  });

  it("reads money, keeping refunds apart and leaving them out where the database did not split them", () => {
    const p = parsePaymentsSummary(PAY_2026_BY_METHOD)!;
    expect(p.totals).toEqual({ payments: 5, receivedCents: 102700, refundedCents: 1000, netCents: 101700 });
    expect(p.groups[4]).toEqual({ key: "ach", label: "ach", payments: 1, receivedCents: 3000, refundedCents: 1000, netCents: 2000 });
    const f = parsePaymentsSummary(PAY_2026_BY_FUND)!;
    expect(f.groups[0]).toMatchObject({ key: "unallocated", receivedCents: 84700, refundedCents: null, netCents: null });
  });

  it("reads pledges and what is still owed", () => {
    const p = parsePledgesSummary(PLEDGES_2026)!;
    expect(p.totals).toEqual({ pledges: 4, pledgedCents: 84000, paidCents: 20000, writtenOffCents: 6000 });
    expect(p.campaigns.map((c) => outstandingCents(c))).toEqual([35000, 17000, 6000]);
    expect(outstandingCents(p.totals)).toBe(58000);
    expect(p.campaigns[2]).toMatchObject({ campaignId: null, campaign: null });
    expect(p.openNow).toEqual({ pledges: 4, openCents: 62000 });
  });

  it("reads check-ins, store sales and a period's figures", () => {
    expect(parseAttendance(ATTENDANCE_2026)).toMatchObject({ checkIns: 4, events: 1 });
    expect(parseAttendance(ATTENDANCE_2026)?.topEvents[0]).toMatchObject({ name: "G128 Diwali dinner", checkIns: 4 });
    expect(parseStoreSales(SHOP_2026)).toMatchObject({ orders: 3, salesCents: 4500 });
    expect(parseStoreSales(SHOP_2026)?.topItems[1]).toEqual({ item: "G128 Chakli", units: 6, salesCents: 1500 });
    expect(parsePeriodFigures(FIGURES_SEP)).toMatchObject({ newHouseholds: 0, applicationsReceived: 1, checkIns: 3, giving: { netCents: 2000 }, store: { orders: 2, salesCents: 3500 } });
  });

  it("says 'could not read' (null) for anything that is not the shape, never zeros", () => {
    for (const bad of [null, undefined, [], "text", 42, {}, { error: "boom" }]) {
      expect(parsePeopleOverview(bad)).toBeNull();
      expect(parseMembershipMatrix(bad)).toBeNull();
      expect(parseMembershipChanges(bad)).toBeNull();
      expect(parsePaymentsSummary(bad)).toBeNull();
      expect(parsePledgesSummary(bad)).toBeNull();
      expect(parseAttendance(bad)).toBeNull();
      expect(parseStoreSales(bad)).toBeNull();
      expect(parsePeriodFigures(bad)).toBeNull();
      expect(parsePlatformWaiting(bad)).toBeNull();
      expect(parseCommunitySummary(bad)).toBeNull();
    }
  });
});

describe("reading the Platform answers", () => {
  it("reads the team's inbox", () => {
    const w = parsePlatformWaiting({
      as_of: "2026-10-11T00:00:00Z",
      counts: { golive: 1, promote: 0, verification: 1, access_requests: 2, readiness: 1, access_requests_waiting_on_them: 1 },
      items: [
        { kind: "golive", center_id: "c1", slug: "sa", community: "Sandbox A", since: "2026-10-06T00:00:00Z", detail: "Asked to go live. It needs a first approval.", more: [] },
        { kind: "access_request", center_id: null, slug: null, community: "Fremont Sangh", since: null, detail: "Temple, Fremont, CA", more: null },
      ],
      consent: [{ center_id: "c1", slug: "sa", community: "Sandbox A", environment: "sandbox", activity_recording: "not_agreed", shares_with_weaver: false, support_access_until: null }],
    })!;
    expect(w.counts).toEqual({ golive: 1, promote: 0, verification: 1, accessRequests: 2, readiness: 1, accessRequestsWaitingOnThem: 1 });
    expect(w.items[1]).toMatchObject({ kind: "access_request", centerId: null, slug: null, more: [] });
    expect(w.consent[0]).toMatchObject({ activityRecording: "not_agreed", sharesWithWeaver: false, supportAccessUntil: null });
  });

  it("reads a community's summary, keeping a missing part missing", () => {
    const s = parseCommunitySummary({
      community: { id: "c1", slug: "sa", name: "Sandbox A", status: "onboarding", environment: "sandbox", kind: "jain_center", tradition: "jain", time_zone: "America/Chicago", created_at: "2026-09-01T00:00:00Z", moved_to_production_as: null, owner: null },
      size: { households: 0, people: 0, signed_in_accounts: 1, active_memberships: 0 },
      setup: null,
      readiness: { passing: 3, total: 5, failing: [{ check: "Setup data complete", detail: "Add your address." }] },
      go_live: null,
      verification: { status: "submitted", submitted_at: "2026-10-08T00:00:00Z", verified_at: null },
      consent: { activity_recording: "not_agreed", shares_with_weaver: false, support_access_until: null, niva_actions_switched_on: 2 },
      modules_off: ["store"],
      ways_to_pay: ["zelle"],
      portal_addresses: 1,
      last_staff_activity_at: null,
    })!;
    expect(s.setup).toBeNull();
    expect(s.goLive).toBeNull();
    expect(s.readiness).toEqual({ passing: 3, total: 5, failing: [{ check: "Setup data complete", detail: "Add your address." }] });
    expect(s.consent.nivaActionsSwitchedOn).toBe(2);
    expect(s.modulesOff).toEqual(["store"]);
  });
});
