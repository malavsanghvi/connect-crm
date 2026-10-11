import { describe, expect, it } from "vitest";

import { prepareClone, moveYears, type CloneSource } from "@/lib/events/clone";
import { isQuietHour, planSend } from "@/lib/events/quiet-hours";
import { eventReadiness, type ReadinessCounts, type ReadinessEvent } from "@/lib/events/readiness";
import { parseEventSummary, placesLeft, summarySentences } from "@/lib/events/summary";

const TZ = "America/Chicago";
const NIGHT = { quietStartHour: 21, quietEndHour: 7, eventDayDuringQuietHours: true };

describe("quiet hours", () => {
  it("knows which hours are quiet, across midnight or not", () => {
    expect([20, 21, 23, 0, 6, 7, 12].map((h) => isQuietHour(h, NIGHT))).toEqual([false, true, true, true, true, false, false]);
    expect([12, 13, 14, 15].map((h) => isQuietHour(h, { quietStartHour: 13, quietEndHour: 15 }))).toEqual([false, true, true, false]);
    expect(isQuietHour(3, { quietStartHour: 5, quietEndHour: 5 })).toBe(false);
  });

  it("sends at once outside quiet hours", () => {
    const at = new Date("2026-10-24T15:00:00Z"); // 10 AM in Chicago
    expect(planSend({ at, tz: TZ, settings: NIGHT, eventDay: false })).toEqual({ sendAt: at, held: false, why: null });
  });

  it("holds a late-evening send until the morning after, and an early-morning one until that morning", () => {
    const evening = planSend({ at: new Date("2026-10-24T03:30:00Z"), tz: TZ, settings: NIGHT, eventDay: false }); // 10:30 PM on Oct 23
    expect(evening.held).toBe(true);
    expect(evening.sendAt.toISOString()).toBe("2026-10-24T12:00:00.000Z"); // 7 AM CDT on Oct 24
    const early = planSend({ at: new Date("2026-10-24T09:00:00Z"), tz: TZ, settings: NIGHT, eventDay: false }); // 4 AM on Oct 24
    expect(early.sendAt.toISOString()).toBe("2026-10-24T12:00:00.000Z");
  });

  it("lets an event-day message through when the community allows it, and holds it when it does not", () => {
    const at = new Date("2026-10-24T11:00:00Z"); // 6 AM
    expect(planSend({ at, tz: TZ, settings: NIGHT, eventDay: true }).held).toBe(false);
    expect(planSend({ at, tz: TZ, settings: { ...NIGHT, eventDayDuringQuietHours: false }, eventDay: true }).held).toBe(true);
  });

  it("follows the clocks changing (7 AM is an hour later in UTC after November 1)", () => {
    const p = planSend({ at: new Date("2026-11-08T05:00:00Z"), tz: TZ, settings: NIGHT, eventDay: false }); // 11 PM on Nov 7 (CST)
    expect(p.sendAt.toISOString()).toBe("2026-11-08T13:00:00.000Z");
  });
});

const EVENT: ReadinessEvent = {
  name: "Diwali Dinner",
  status: "draft",
  starts_at: "2026-10-24T23:30:00Z",
  ends_at: "2026-10-25T02:00:00Z",
  venue: "Main Hall",
  description: "Dinner and aarti",
  capacity: 300,
  rsvp_opens_at: null,
  rsvp_closes_at: null,
  lunch_enabled: false,
  lunch_starts_at: null,
  is_paid: false,
  member_price_cents: null,
  guest_price_cents: null,
  audience: "members_and_guests",
  owner_person_id: "p-lead",
  flyer_path: "flyers/x.png",
};
const COUNTS: ReadinessCounts = { lunch_slots: 0, shifts: 0, shifts_empty: 0, checklist_overdue: 0, checklist_open: 0 };
const NOW = new Date("2026-10-11T15:00:00Z");
const check = (e: Partial<ReadinessEvent>, c: Partial<ReadinessCounts> = {}, goal: "publish" | "event_day" = "publish") => eventReadiness({ ...EVENT, ...e }, { ...COUNTS, ...c }, goal, NOW, TZ);

describe("what blocks an event going live", () => {
  it("has nothing in the way of a complete draft", () => {
    const r = check({});
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.summary).toBe("Nothing is blocking Diwali Dinner from being published.");
  });

  it("blocks on what the builder refuses or what would be wrong the moment members see it", () => {
    const r = check({ starts_at: null, lunch_enabled: true, is_paid: true });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toEqual(["no_start", "lunch_time", "price"]);
    expect(check({ ends_at: "2026-10-24T20:00:00Z" }).blockers.map((b) => b.code)).toEqual(["ends_before_start"]);
    expect(check({ rsvp_opens_at: "2026-10-20T12:00:00Z", rsvp_closes_at: "2026-10-19T12:00:00Z" }).blockers.map((b) => b.code)).toEqual(["rsvp_window"]);
    expect(check({ starts_at: "2026-10-01T23:30:00Z", ends_at: null }).blockers.map((b) => b.code)).toEqual(["start_passed"]);
    expect(check({ rsvp_closes_at: "2026-10-05T12:00:00Z" }).blockers.map((b) => b.code)).toEqual(["rsvp_closed_already"]);
  });

  it("says what is worth a look without stopping anything", () => {
    const r = check({ venue: null, description: null, capacity: null, owner_person_id: null, flyer_path: null }, { shifts_empty: 2, checklist_overdue: 1 });
    expect(r.ready).toBe(true);
    expect(r.checks.map((c) => c.code)).toEqual(["no_venue", "no_description", "no_capacity", "no_lead", "no_flyer", "empty_shifts", "overdue"]);
    expect(r.checks.find((c) => c.code === "empty_shifts")!.text).toBe("2 volunteer shifts have nobody assigned.");
    expect(r.summary).toBe("Nothing is blocking Diwali Dinner from being published. 7 things worth a look.");
  });

  it("does not guess about volunteers when the person's role cannot see assignments", () => {
    expect(check({}, { shifts_empty: null }).checks.map((c) => c.code)).not.toContain("empty_shifts");
  });

  it("does not call a started event's start time a problem once it is published", () => {
    const r = check({ status: "published", starts_at: "2026-10-01T23:30:00Z", ends_at: null });
    expect(r.blockers).toEqual([]);
    expect(r.checks.map((c) => c.code)).toContain("already_published");
  });

  it("checks the day itself: it must be published, and lunch needs its slots", () => {
    expect(check({ status: "draft" }, {}, "event_day").blockers.map((b) => b.code)).toEqual(["not_published"]);
    const lunch = check({ status: "published", lunch_enabled: true, lunch_starts_at: "2026-10-25T00:30:00Z" }, { lunch_slots: 0 }, "event_day");
    expect(lunch.blockers.map((b) => b.code)).toEqual(["no_slots"]);
    expect(check({ status: "published", lunch_enabled: true, lunch_starts_at: "2026-10-25T00:30:00Z" }, { lunch_slots: 6 }, "event_day").ready).toBe(true);
  });

  it("cannot take a cancelled or completed event live", () => {
    expect(check({ status: "cancelled" }).blockers.map((b) => b.code)).toEqual(["cancelled"]);
    expect(check({ status: "completed" }).blockers.map((b) => b.code)).toEqual(["completed"]);
  });
});

const SOURCE: CloneSource = {
  name: "Diwali Dinner 2025",
  description: "Dinner and aarti",
  venue: "Main Hall",
  starts_at: "2025-10-18T23:30:00Z", // 6:30 PM CDT on Oct 18
  ends_at: "2025-10-19T02:00:00Z", // 9:00 PM
  program_year: "2025-26",
  capacity: 300,
  waitlist_enabled: true,
  audience: "members_and_guests",
  rsvp_opens_at: "2025-10-04T14:00:00Z", // 9 AM, 14 days before
  rsvp_closes_at: "2025-10-16T23:00:00Z", // 6 PM, 2 days before
  confirmation_hours_before: 24,
  attendee_flags: ["child_under_12"],
  commitment_options: { per_person: [], lump_sum: [], open: false },
  lunch_enabled: true,
  lunch_starts_at: "2025-10-18T17:00:00Z", // noon
  lunch_slot_minutes: 15,
  lunch_seats_per_slot: 40,
  lunch_priority_rules: {},
  is_paid: true,
  member_price_cents: 1500,
  guest_price_cents: 2500,
  owner_person_id: "p-lead",
  confidential: false,
};

describe("copying an earlier event", () => {
  it("moves the year in the name and program year", () => {
    expect(moveYears("Diwali Dinner 2025", 1)).toBe("Diwali Dinner 2026");
    expect(moveYears("2025-26", 1)).toBe("2026-27");
    expect(moveYears("Garba Night", 1)).toBe("Garba Night");
    expect(moveYears("Diwali Dinner 2025", 0)).toBe("Diwali Dinner 2025");
  });

  it("puts everything on the new day, keeping times of day and the distance of the RSVP window", () => {
    const r = prepareClone(SOURCE, { newDay: "2026-11-08", tz: TZ });
    if (!r.ok) throw new Error(r.error);
    const p = r.prepared;
    expect(p.status).toBe("draft");
    expect(p.name).toBe("Diwali Dinner 2026");
    expect(p.program_year).toBe("2026-27");
    // 6:30 PM on Nov 8 is after the clocks went back: CST, an hour later in UTC than in October.
    expect(p.starts_at).toBe("2026-11-09T00:30:00.000Z");
    expect(p.ends_at).toBe("2026-11-09T03:00:00.000Z");
    expect(p.rsvp_opens_at).toBe("2026-10-25T14:00:00.000Z"); // 14 days before, 9 AM CDT
    expect(p.rsvp_closes_at).toBe("2026-11-07T00:00:00.000Z"); // 2 days before, 6 PM CST
    expect(p.lunch_starts_at).toBe("2026-11-08T18:00:00.000Z"); // noon CST
    expect(p.capacity).toBe(300);
    expect(p.member_price_cents).toBe(1500);
    expect(r.copied).toContain("prices");
    expect(r.left_out).toContain("RSVPs and attendees");
    expect(r.notes.join(" ")).toContain("prices were copied");
  });

  it("uses the name it is given, and warns when the name would be the same", () => {
    const named = prepareClone(SOURCE, { newDay: "2026-11-08", name: "Diwali Mahotsav", tz: TZ });
    expect(named.ok && named.prepared.name).toBe("Diwali Mahotsav");
    const same = prepareClone({ ...SOURCE, name: "Garba Night", program_year: null }, { newDay: "2026-11-08", tz: TZ });
    expect(same.ok && same.notes.join(" ")).toContain("same name");
  });

  it("cannot copy an event that has no date", () => {
    expect(prepareClone({ ...SOURCE, starts_at: null }, { newDay: "2026-11-08", tz: TZ })).toEqual({ ok: false, error: "Diwali Dinner 2025 has no start date, so there is nothing to base the new dates on." });
  });
});

describe("an event in numbers", () => {
  const raw = {
    event: { id: "e1", name: "Diwali Dinner", status: "published", starts_at: "2026-10-24T23:30:00Z", capacity: 50, waitlist_enabled: true, lunch_enabled: true, is_paid: false },
    households: { rsvpd: 2, confirmed: 1 },
    people: { households_total: 3, walk_in_households: 0, people_rsvpd: 7, people_confirmed: 3, people_waitlisted: 2, walk_in_people: 0, not_arrived: 7, checked_in: 0, served: 0, gifts_given: 0, children_under_12: 2, seniors: 1, needs_assistance: 0 },
    lunch: { enabled: true, slots: 4, slots_done: 0, seats: 80, unlimited_slots: 0, assigned: 5, served: 0 },
    volunteers: { visible: true, shifts: 3, spots_needed: 9, assigned: 4, shifts_empty: 1, shifts_open: 2 },
    checklist: { total: 6, done: 2, in_progress: 1, not_started: 3, overdue: 1 },
  };

  it("reads what the database returns, and nothing else", () => {
    const s = parseEventSummary(raw)!;
    expect(s.people.rsvpd).toBe(7);
    expect(s.households).toEqual({ rsvpd: 2, confirmed: 1 });
    expect(placesLeft(s)).toBe(43);
    expect(parseEventSummary(null)).toBeNull();
    expect(parseEventSummary({ event: {} })).toBeNull();
    expect(parseEventSummary("nope")).toBeNull();
  });

  it("keeps an unknown number as null instead of turning it into 0", () => {
    const s = parseEventSummary({ ...raw, volunteers: { visible: false, shifts: 3, spots_needed: 9, assigned: null, shifts_empty: null, shifts_open: null } })!;
    expect(s.volunteers.assigned).toBeNull();
    expect(summarySentences(s).join(" ")).toContain("Your role can't see who is assigned.");
  });

  it("says it in short sentences with counts only", () => {
    const text = summarySentences(parseEventSummary(raw)!).join("\n");
    expect(text).toContain("7 people have RSVP'd (3 confirmed); 50 places, 43 left.");
    expect(text).toContain("2 people on the waitlist.");
    expect(text).toContain("Among them: 2 under 12, 1 seniors, 0 needing assistance.");
    expect(text).toContain("Lunch: 4 slots (80 seats); 5 seated, 0 served.");
    expect(text).toContain("Volunteers: 3 shifts needing 9; 4 assigned, 1 shift with nobody.");
    expect(text).toContain("Checklist: 2 of 6 done, 1 overdue.");
  });

  it("has no capacity left to count when there is no limit", () => {
    expect(placesLeft(parseEventSummary({ ...raw, event: { ...raw.event, capacity: null } })!)).toBeNull();
  });
});
