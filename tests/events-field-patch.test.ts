import { describe, expect, it } from "vitest";

import { EVENT_FIELDS, EVENT_FIELD_INFO, describeEventField, eventFieldConflict, isEventField, parseEventField } from "@/lib/events/field-patch";

const TZ = "America/Chicago";

describe("changing one detail of an event", () => {
  it("covers only the details the builder lets anyone change in one go: no money, status, audience or owner", () => {
    expect([...EVENT_FIELDS]).toEqual(["name", "description", "venue", "starts_at", "ends_at", "capacity", "rsvp_opens_at", "rsvp_closes_at", "confirmation_hours_before", "waitlist_enabled"]);
    for (const bad of ["member_price_cents", "guest_price_cents", "status", "audience", "owner_person_id", "confidential", "is_paid"]) expect(isEventField(bad)).toBe(false);
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
