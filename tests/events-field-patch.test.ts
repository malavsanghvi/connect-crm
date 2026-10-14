import { describe, expect, it } from "vitest";

import { EVENT_FIELDS, EVENT_FIELD_INFO, describeEventField, eventFieldConflict, isEventField, parseAudience, parseEventField, parseTimeOfDay, planEventFieldChange, type EventFieldRow } from "@/lib/events/field-patch";

const TZ = "America/Chicago";

describe("changing one detail of an event", () => {
  it("covers only the details that are safe to change in one go: no money, status or owner", () => {
    expect([...EVENT_FIELDS]).toEqual([
      "name",
      "description",
      "venue",
      "date",
      "start_time",
      "end_time",
      "starts_at",
      "ends_at",
      "capacity",
      "audience",
      "rsvp_opens_at",
      "rsvp_closes_at",
      "confirmation_hours_before",
      "waitlist_enabled",
    ]);
    for (const bad of ["member_price_cents", "guest_price_cents", "status", "owner_person_id", "confidential", "is_paid", "lunch_starts_at"]) expect(isEventField(bad)).toBe(false);
    for (const key of EVENT_FIELDS) expect(EVENT_FIELD_INFO[key].hint.length).toBeGreaterThan(3);
  });

  it("reads text, and clears what may be empty", () => {
    expect(parseEventField("venue", "  Hall B ", TZ)).toEqual({ ok: true, value: "Hall B" });
    expect(parseEventField("venue", "", TZ)).toEqual({ ok: true, value: null });
    expect(parseEventField("name", "", TZ)).toEqual({ ok: false, error: "Event name is required." });
    expect(parseEventField("name", "x".repeat(201), TZ)).toEqual({ ok: false, error: "Event name can be at most 200 characters." });
  });

  it("reads a date and time as the community's wall clock", () => {
    expect(parseEventField("starts_at", "2026-10-24T19:00", TZ)).toEqual({ ok: true, value: "2026-10-25T00:00:00.000Z" });
    expect(parseEventField("starts_at", "2026-10-24 19:00", TZ)).toEqual({ ok: true, value: "2026-10-25T00:00:00.000Z" });
    // After the clocks go back (Nov 1, 2026) the same wall time is an hour later in UTC.
    expect(parseEventField("starts_at", "2026-11-08T19:00", TZ)).toEqual({ ok: true, value: "2026-11-09T01:00:00.000Z" });
    expect(parseEventField("ends_at", "", TZ)).toEqual({ ok: true, value: null });
    expect(parseEventField("starts_at", "", TZ)).toEqual({ ok: false, error: "Starts is required." });
    for (const bad of ["tomorrow", "2026-13-01T10:00", "2026-02-30T10:00", "2026-10-24T25:00", "2026-10-24"]) {
      expect(parseEventField("starts_at", bad, TZ)).toEqual({ ok: false, error: "Starts must be a date and time like 2026-11-08T11:30." });
    }
  });

  it("reads whole numbers in range, and yes or no", () => {
    expect(parseEventField("capacity", "250", TZ)).toEqual({ ok: true, value: 250 });
    expect(parseEventField("capacity", "0", TZ)).toEqual({ ok: true, value: 0 });
    expect(parseEventField("capacity", "", TZ)).toEqual({ ok: true, value: null });
    expect(parseEventField("capacity", "2.5", TZ)).toEqual({ ok: false, error: "Capacity must be a whole number." });
    expect(parseEventField("confirmation_hours_before", "0", TZ)).toEqual({ ok: true, value: 0 });
    expect(parseEventField("confirmation_hours_before", "337", TZ)).toEqual({ ok: false, error: "Confirmation reminder must be at most 336." });
    expect(parseEventField("confirmation_hours_before", "", TZ)).toEqual({ ok: false, error: "Confirmation reminder is required." });
    expect(parseEventField("waitlist_enabled", "Yes", TZ)).toEqual({ ok: true, value: true });
    expect(parseEventField("waitlist_enabled", "off", TZ)).toEqual({ ok: true, value: false });
    expect(parseEventField("waitlist_enabled", "", TZ)).toEqual({ ok: false, error: "Waitlist must be yes or no." });
  });

  it("describes a stored value the way a person reads it", () => {
    expect(describeEventField("capacity", null, TZ)).toBe("No limit");
    expect(describeEventField("venue", null, TZ)).toBe("Not set");
    expect(describeEventField("confirmation_hours_before", 0, TZ)).toBe("Off");
    expect(describeEventField("confirmation_hours_before", 24, TZ)).toBe("24 hours before the event");
    expect(describeEventField("waitlist_enabled", false, TZ)).toBe("No");
    expect(describeEventField("starts_at", "2026-10-24T23:30:00+00:00", TZ)).toBe("Sat, Oct 24, 6:30 PM");
  });

  it("keeps the dates in order, comparing moments not text", () => {
    const current = { starts_at: "2026-10-24T23:30:00+00:00", ends_at: "2026-10-25T02:00:00+00:00", rsvp_opens_at: "2026-10-01T14:00:00+00:00", rsvp_closes_at: "2026-10-22T14:00:00+00:00" };
    expect(eventFieldConflict("starts_at", "2026-10-25T02:00:00.000Z", current)).toMatch(/must end after it starts/);
    expect(eventFieldConflict("starts_at", "2026-10-25T01:59:00.000Z", current)).toBeNull();
    expect(eventFieldConflict("ends_at", "2026-10-24T23:30:00.000Z", current)).toMatch(/must end after it starts/);
    expect(eventFieldConflict("ends_at", null, current)).toBeNull();
    expect(eventFieldConflict("rsvp_closes_at", "2026-10-01T14:00:00.000Z", current)).toBe("RSVPs must close after they open.");
    expect(eventFieldConflict("rsvp_opens_at", "2026-10-23T00:00:00.000Z", current)).toBe("RSVPs must close after they open.");
    expect(eventFieldConflict("venue", "Hall", current)).toBeNull();
  });
});

const ROW: EventFieldRow = {
  name: "Diwali Dinner",
  description: null,
  venue: "Main Hall",
  starts_at: "2026-10-24T23:30:00+00:00", // 6:30 PM CDT, Sat Oct 24
  ends_at: "2026-10-25T02:00:00+00:00", // 9:00 PM
  rsvp_opens_at: "2026-10-10T14:00:00+00:00",
  rsvp_closes_at: "2026-10-22T23:00:00+00:00",
  capacity: 300,
  audience: "members_and_guests",
  confirmation_hours_before: 24,
  waitlist_enabled: true,
  lunch_starts_at: "2026-10-24T17:00:00+00:00", // noon
};
const NOW = new Date("2026-10-11T15:00:00Z");
const plan = (field: Parameters<typeof planEventFieldChange>[0], raw: string, row: EventFieldRow = ROW) => planEventFieldChange(field, raw, row, TZ, NOW);

describe("who can RSVP", () => {
  it("reads the words a person would say", () => {
    expect(parseAudience("Everyone")).toBe("members_and_guests");
    expect(parseAudience("everyone", "public")).toBe("public");
    expect(parseAudience("members only")).toBe("members_only");
    expect(parseAudience("Life members")).toBe("life_members_only");
    expect(parseAudience("pathshala families")).toBe("pathshala_families");
    expect(parseAudience("life_members_only")).toBe("life_members_only");
    expect(parseAudience("the whole world")).toBeNull();
  });

  it("is changed as a field, described in words, and refuses words it does not know", () => {
    const p = plan("audience", "members");
    expect(p).toMatchObject({ ok: true, label: "Who can RSVP", before: "Everyone (members and their guests)", after: "Members only", changed: true, patch: { audience: "members_only" } });
    expect(plan("audience", "everyone")).toMatchObject({ ok: true, changed: false });
    expect(plan("audience", "robots")).toEqual({ ok: false, error: "Who can RSVP must be everyone, members, life members or pathshala families." });
  });
});

describe("times of day", () => {
  it("reads 24-hour and 12-hour times", () => {
    expect(parseTimeOfDay("19:00")).toBe("19:00");
    expect(parseTimeOfDay("7:30 pm")).toBe("19:30");
    expect(parseTimeOfDay("7pm")).toBe("19:00");
    expect(parseTimeOfDay("12 am")).toBe("00:00");
    expect(parseTimeOfDay("12:15 PM")).toBe("12:15");
    for (const bad of ["25:00", "7:75", "13 pm", "noon", ""]) expect(parseTimeOfDay(bad)).toBeNull();
  });
});

describe("moving an event by sentence", () => {
  it("moves the whole event to another day and keeps the times of day, the end and the lunch start with it", () => {
    const p = plan("date", "2026-11-08");
    if (!p.ok) throw new Error(p.error);
    // 6:30 PM CST on Nov 8 (the clocks went back on Nov 1).
    expect(p.patch).toEqual({ starts_at: "2026-11-09T00:30:00.000Z", ends_at: "2026-11-09T03:00:00.000Z", lunch_starts_at: "2026-11-08T18:00:00.000Z" });
    expect(p.before).toBe("Sat, Oct 24, 6:30 PM");
    expect(p.after).toBe("Sun, Nov 8, 6:30 PM");
    expect(p.changed).toBe(true);
    expect(p.warnings.join(" ")).toContain("Lunch slots that already exist are not moved");
  });

  it("warns when the RSVP dates no longer fit, and when the day has passed", () => {
    const later = plan("date", "2026-10-20");
    expect(later).toMatchObject({ ok: true });
    expect(later.ok && later.warnings.join(" ")).toContain("RSVPs are set to close after the new start time");
    const past = plan("date", "2026-10-01", { ...ROW, rsvp_opens_at: null, rsvp_closes_at: null });
    expect(past.ok && past.warnings.join(" ")).toContain("already passed");
  });

  it("does nothing when it is already that day, and needs a day that exists", () => {
    expect(plan("date", "2026-10-24")).toMatchObject({ ok: true, changed: false });
    expect(plan("date", "2026-02-30")).toEqual({ ok: false, error: "Date must be a day like 2026-11-08." });
    expect(plan("date", "")).toEqual({ ok: false, error: "Date is required." });
    expect(plan("date", "2026-11-08", { ...ROW, starts_at: null })).toMatchObject({ ok: false });
  });

  it("changes only the start or the end time, on the same day, and keeps them in order", () => {
    const start = plan("start_time", "5:30 pm");
    expect(start).toMatchObject({ ok: true, changed: true, patch: { starts_at: "2026-10-24T22:30:00.000Z" }, after: "Sat, Oct 24, 5:30 PM" });
    expect(plan("end_time", "22:00")).toMatchObject({ ok: true, patch: { ends_at: "2026-10-25T03:00:00.000Z" } });
    expect(plan("start_time", "9:30 pm")).toEqual({ ok: false, error: "The event must end after it starts. Change the end time as well, or choose a later one." });
    expect(plan("end_time", "6:00 pm")).toEqual({ ok: false, error: "The event must end after it starts. Change the end time as well, or choose a later one." });
    expect(plan("start_time", "teatime")).toEqual({ ok: false, error: "Start time must be a time like 11:30 or 2:00 pm." });
  });

  it("changes one plain column for every other detail, as before", () => {
    expect(plan("venue", "Hall B")).toMatchObject({ ok: true, patch: { venue: "Hall B" }, before: "Main Hall", after: "Hall B" });
    expect(plan("capacity", "")).toMatchObject({ ok: true, patch: { capacity: null }, after: "No limit" });
    expect(plan("ends_at", "")).toMatchObject({ ok: true, patch: { ends_at: null } });
    expect(plan("ends_at", "2026-10-24T18:00")).toEqual({ ok: false, error: "The event must end after it starts. Change the end time as well, or choose a later one." });
    expect(plan("venue", "Main Hall")).toMatchObject({ ok: true, changed: false });
    expect(plan("ends_at", "2026-10-24T21:00")).toMatchObject({ ok: true, changed: false });
    expect(plan("ends_at", "", { ...ROW, ends_at: null })).toMatchObject({ ok: true, changed: false });
  });
});
