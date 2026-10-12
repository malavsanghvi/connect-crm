import { describe, expect, it } from "vitest";

import { defaultFlyerDesign, flyerMadeFor, type FlyerDesign } from "@/lib/events/flyer";
import {
  approvalProblem,
  approvalState,
  channelRows,
  checkPublishTime,
  drawnTakes,
  flyerDesignKey,
  isGuestVisible,
  makeFlyerApproval,
  nextDrawnTake,
  publishProblems,
  publishState,
  readFlyerApproval,
  suggestedPublishTime,
} from "@/lib/events/publish-schedule";
import type { ReadinessEvent } from "@/lib/events/readiness";

const TZ = "America/Chicago";
const NOW = new Date("2026-10-11T17:00:00Z"); // noon in Chicago

// A chamber's expo, a church's service and a temple's festival: the rules are the same for every kind of organization.
const expo = { name: "Small Business Expo", starts_at: "2026-11-12T23:00:00Z", ends_at: "2026-11-13T02:00:00Z", venue: "Main Hall" };

function design(over: Partial<FlyerDesign> = {}): FlyerDesign {
  return {
    ...defaultFlyerDesign({ name: expo.name, description: "Meet local businesses.", venue: expo.venue, startsAt: expo.starts_at, endsAt: expo.ends_at, tz: TZ, qrAvailable: true }),
    ...over,
  };
}

/** The saved row after "Approve this flyer": the design, what it was made for, the approval. */
function savedRow(d: FlyerDesign, event = expo, approvedName = event.name) {
  return {
    flyer_source: "designed",
    flyer_path: "c/events/e/flyer-1.png",
    flyer_design: { ...d, made_for: flyerMadeFor(event), approval: makeFlyerApproval(d, approvedName, "user-1", NOW) } as unknown,
  };
}

const readyEvent = (over: Partial<ReadinessEvent> = {}): ReadinessEvent => ({
  name: expo.name,
  status: "draft",
  starts_at: expo.starts_at,
  ends_at: expo.ends_at,
  venue: expo.venue,
  description: "Meet local businesses.",
  capacity: 200,
  rsvp_opens_at: null,
  rsvp_closes_at: null,
  lunch_enabled: false,
  lunch_starts_at: null,
  is_paid: false,
  member_price_cents: null,
  guest_price_cents: null,
  audience: "members_and_guests",
  owner_person_id: null,
  flyer_path: "c/events/e/flyer-1.png",
  ...over,
});

describe("the flyer approval", () => {
  it("is a stable fingerprint of the design as the flyer maker saves it", () => {
    expect(flyerDesignKey(design())).toMatch(/^[0-9a-f]{8}$/);
    expect(flyerDesignKey(design())).toBe(flyerDesignKey(JSON.parse(JSON.stringify(design()))));
    expect(flyerDesignKey(design({ size: "story" }))).not.toBe(flyerDesignKey(design()));
    expect(flyerDesignKey({ nonsense: true })).toBe("");
  });

  it("is read defensively from the saved design", () => {
    expect(readFlyerApproval(null)).toBeNull();
    expect(readFlyerApproval({ approval: "yes" })).toBeNull();
    expect(readFlyerApproval({ approval: { at: "not a date" } })).toBeNull();
    expect(readFlyerApproval(savedRow(design()).flyer_design)).toMatchObject({ v: 1, by: "user-1", name: expo.name, at: NOW.toISOString() });
  });

  it("is approved while the event and the design on screen are what was approved", () => {
    const d = design();
    expect(approvalState(savedRow(d), expo, d).state).toBe("approved");
    expect(approvalState(savedRow(d), expo).state).toBe("approved");
  });

  it("is none without an approval, for an uploaded flyer, or with no flyer file", () => {
    const d = design();
    expect(approvalState({ flyer_source: "designed", flyer_path: "x", flyer_design: d }, expo).state).toBe("none");
    expect(approvalState({ ...savedRow(d), flyer_source: "manual" }, expo).state).toBe("none");
    expect(approvalState({ ...savedRow(d), flyer_path: null }, expo).state).toBe("none");
    expect(approvalProblem({ state: "none" })).toMatch(/^Approve the flyer first/);
  });

  it("is 'changed' once the person switches the template, size or art after approving", () => {
    const d = design();
    const a = approvalState(savedRow(d), expo, design({ template: "minimal" }));
    expect(a.state).toBe("changed");
    expect(approvalProblem(a)).toBe("You changed the flyer after approving it. Approve it again.");
  });

  it("is stale when the event's name, date or venue changed after it (the flyer shows the old words)", () => {
    const d = design();
    const renamed = approvalState(savedRow(d), { ...expo, name: "Spring Business Expo" }, d);
    expect(renamed).toMatchObject({ state: "stale", what: "name" });
    expect(approvalState(savedRow(d), { ...expo, starts_at: "2026-11-19T23:00:00Z" })).toMatchObject({ state: "stale", what: "date" });
    expect(approvalState(savedRow(d), { ...expo, venue: "Library" })).toMatchObject({ state: "stale", what: "venue" });
    const both = approvalState(savedRow(d), { ...expo, starts_at: "2026-11-19T23:00:00Z", venue: "Library" });
    expect(approvalProblem(both)).toBe("The event's date and venue changed after the flyer was approved, so the flyer shows the old date and venue. Approve it again.");
  });
});

describe("when to publish", () => {
  it("suggests 10 days before the event at 9:00 am in the community's time zone", () => {
    expect(suggestedPublishTime(expo.starts_at, TZ, NOW)).toBe("2026-11-02T09:00");
    // The same instant in another zone is another local day and time.
    expect(suggestedPublishTime("2026-11-12T23:00:00Z", "Asia/Kolkata", NOW)).toBe("2026-11-03T09:00");
  });

  it("suggests tomorrow at 9:00 am when ten days before has passed, and nothing when the event is about to start", () => {
    expect(suggestedPublishTime("2026-10-15T23:00:00Z", TZ, NOW)).toBe("2026-10-12T09:00");
    expect(suggestedPublishTime("2026-10-12T13:00:00Z", TZ, NOW)).toBe("");
    expect(suggestedPublishTime(null, TZ, NOW)).toBe("");
  });

  it("takes a time in the future and before the event, read in the community's zone", () => {
    expect(checkPublishTime("2026-11-02T09:00", TZ, expo.starts_at, NOW)).toEqual({ ok: true, iso: "2026-11-02T15:00:00.000Z" });
    expect(checkPublishTime("", TZ, expo.starts_at, NOW)).toEqual({ ok: false, error: "Pick a date and time to publish." });
    expect(checkPublishTime("2026-10-01T09:00", TZ, expo.starts_at, NOW)).toEqual({ ok: false, error: "Pick a time in the future." });
    const after = checkPublishTime("2026-11-20T09:00", TZ, expo.starts_at, NOW);
    expect(after.ok).toBe(false);
    expect(!after.ok && after.error).toMatch(/^Pick a time before the event starts \(/);
    expect(checkPublishTime("2026-11-02T09:00", TZ, null, NOW)).toMatchObject({ ok: false, error: expect.stringContaining("no start date") });
  });
});

describe("what stops a publish", () => {
  const approved = approvalState(savedRow(design()), expo);

  it("is nothing for a ready draft with an approved flyer", () => {
    expect(publishProblems(readyEvent(), approved, NOW, TZ)).toEqual([]);
  });

  it("puts the approval first, then the readiness list's publish blockers", () => {
    const out = publishProblems(readyEvent({ is_paid: true, lunch_enabled: true }), { state: "none" }, NOW, TZ);
    expect(out[0]).toMatch(/^Approve the flyer first/);
    expect(out.some((p) => p.includes("paid event with no member price"))).toBe(true);
    expect(out.some((p) => p.includes("Lunch is switched on but has no start time"))).toBe(true);
  });

  it("is checked at the scheduled time: RSVPs that close before then stop a schedule", () => {
    const ev = readyEvent({ rsvp_closes_at: "2026-11-01T00:00:00Z" });
    expect(publishProblems(ev, approved, NOW, TZ)).toEqual([]);
    expect(publishProblems(ev, approved, new Date("2026-11-02T15:00:00Z"), TZ, NOW).join(" ")).toMatch(/^RSVPs close on .*, before the publish time./);
  });

  it("refuses an event that is not a draft", () => {
    expect(publishProblems(readyEvent({ status: "published" }), approved, NOW, TZ)).toEqual(["The event is already published."]);
    expect(publishProblems(readyEvent({ status: "cancelled" }), approved, NOW, TZ)).toEqual(["The event is cancelled. Restore it as a draft first."]);
  });
});

describe("the channels", () => {
  const snap = (over: Partial<Parameters<typeof channelRows>[0]> = {}) => ({ status: "draft", publish_at: null, publish_failure: null, guestVisible: true, ...over });

  it("lists the website, the member app and the calendar as built, Facebook and Instagram as Coming next", () => {
    const rows = channelRows(snap(), TZ);
    expect(rows.map((r) => [r.key, r.built])).toEqual([["website", true], ["app", true], ["calendar", true], ["facebook", false], ["instagram", false]]);
    expect(rows.filter((r) => !r.built).every((r) => r.state === "coming_next" && r.status === "Coming next")).toBe(true);
    expect(rows.filter((r) => r.built).every((r) => r.status === "When you publish")).toBe(true);
  });

  it("shows one state for the three built channels: scheduled, live, not published", () => {
    expect(channelRows(snap({ publish_at: "2026-11-02T15:00:00Z" }), TZ)[1]).toMatchObject({ state: "scheduled", status: expect.stringMatching(/^Scheduled · /) });
    expect(channelRows(snap({ status: "published" }), TZ).slice(0, 3).map((r) => r.status)).toEqual(["Live", "Live", "Live"]);
    expect(channelRows(snap({ publish_failure: "Not published at the scheduled time: x" }), TZ)[2]).toMatchObject({ state: "failed" });
    expect(publishState(snap({ status: "rsvp_closed" }))).toBe("live");
    expect(publishState(snap({ status: "cancelled", publish_at: "2026-11-02T15:00:00Z" }))).toBe("cancelled");
  });

  it("says the website is not used when guests cannot see the event", () => {
    const web = channelRows(snap({ guestVisible: false, status: "published" }), TZ)[0];
    expect(web).toMatchObject({ state: "not_shown", status: "Members only" });
    expect(isGuestVisible({ audience: "public", confidential: false })).toBe(true);
    expect(isGuestVisible({ audience: "members_and_guests", confidential: true })).toBe(false);
    expect(isGuestVisible({ audience: "members", confidential: false })).toBe(false);
  });
});

describe("another drawn take", () => {
  it("cycles the kind's art packs, then the first pack with one layer, and comes back round", () => {
    const takes = drawnTakes(["general"]);
    expect(takes).toEqual([
      { occasion: "general", frame: true, scene: true },
      { occasion: "general", frame: true, scene: false },
      { occasion: "general", frame: false, scene: true },
    ]);
    expect(nextDrawnTake(takes, { occasion: "general", frame: true, scene: true })).toEqual(takes[1]);
    expect(nextDrawnTake(takes, { occasion: "general", frame: false, scene: true })).toEqual(takes[0]);
    // A poster showing something else (an AI layer) starts the cycle again.
    expect(nextDrawnTake(takes, { occasion: "diwali", frame: false, scene: false })).toEqual(takes[0]);
    expect(drawnTakes(["diwali", "general"]).slice(0, 2).map((t) => t.occasion)).toEqual(["diwali", "general"]);
  });
});
