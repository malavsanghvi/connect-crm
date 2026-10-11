import { describe, expect, it } from "vitest";

import { draftReminder } from "@/lib/commands/catalog/reminder-text";
import type { EventSummary } from "@/lib/events/summary";
import {
  audienceTiles,
  checklistPreview,
  eventWhenLine,
  languageTabs,
  nivaOpening,
  readinessGoalFor,
  rsvpBars,
  sameDayNextYear,
  workspaceHref,
  workspaceTabs,
  workspaceTiles,
  workspaceView,
  type AudienceLike,
} from "@/lib/events/workspace";

// The new-look Events workspace, pure part: what the page shows from what was loaded. The sample community is a neighbourhood
// club (no faith, no tradition words) whose languages are its own, not a fixed English/Gujarati/Hindi list.

const ID = "00000000-0000-4000-8000-00000000e001";

function summary(over: Partial<EventSummary> = {}): EventSummary {
  return {
    event: { id: ID, name: "Spring Picnic 2027", status: "published", starts_at: "2027-04-17T16:00:00Z", capacity: 200, waitlist_enabled: false, lunch_enabled: true, is_paid: false },
    households: { rsvpd: 30, confirmed: 20 },
    households_total: 50,
    walk_in_households: 0,
    people: { rsvpd: 140, confirmed: 60, waitlisted: 0, walk_ins: 0, not_arrived: 140, checked_in: 0, served: 0, gifts_given: 0, children_under_12: 31, seniors: 9, needs_assistance: 2 },
    lunch: { enabled: true, slots: 2, slots_done: 0, seats: 160, unlimited_slots: 0, assigned: 120, served: 0 },
    volunteers: { visible: true, shifts: 6, spots_needed: 20, assigned: 14, shifts_empty: 1, shifts_open: 3 },
    checklist: { total: 8, done: 5, in_progress: 1, not_started: 2, overdue: 0 },
    ...over,
  };
}

describe("the sections", () => {
  it("draws the board's six tabs in its order; check-in opens the live check-in screen", () => {
    const tabs = workspaceTabs(ID, "overview");
    expect(tabs.map((t) => t.label)).toEqual(["Overview", "RSVPs", "Meals", "Volunteers", "Check-in", "Feedback"]);
    expect(tabs.find((t) => t.key === "checkin")?.href).toBe(`/events/live?event=${ID}`);
    expect(tabs.find((t) => t.key === "survey")?.href).toBe(`/events/${ID}?tab=survey`);
    expect(tabs.filter((t) => t.current).map((t) => t.key)).toEqual(["overview"]);
  });

  it("reads ?tab=, with the overview for anything else, and keeps the classic page's other views", () => {
    expect(workspaceView(undefined)).toBe("overview");
    expect(workspaceView("nonsense")).toBe("overview");
    expect(workspaceView("lunch")).toBe("lunch");
    expect(workspaceView("details")).toBe("details");
    expect(workspaceHref(ID, "overview")).toBe(`/events/${ID}`);
    expect(workspaceHref(ID, "report")).toBe(`/events/${ID}?tab=report`);
  });
});

describe("the four numbers", () => {
  it("counts people and households, never names; children are not a tile", () => {
    const [attending, households, meals, volunteers] = workspaceTiles(summary());
    expect(attending).toMatchObject({ label: "Attending", value: "140", sub: "of 200 places" });
    expect(households).toMatchObject({ label: "Households", value: "50", sub: "20 confirmed" });
    expect(meals).toMatchObject({ value: "120", sub: "of 160 seats in 2 slots" });
    expect(volunteers).toMatchObject({ value: "14 / 20", sub: "3 shifts open" });
  });

  it("says plainly when there is no limit, no meal, no shifts, or the role cannot see who volunteers", () => {
    const s = summary({
      event: { ...summary().event, capacity: null },
      households: { rsvpd: 1, waitlisted: 2, cancelled: 1 },
      lunch: { enabled: false, slots: 0, slots_done: 0, seats: 0, unlimited_slots: 0, assigned: 0, served: 0 },
      volunteers: { visible: false, shifts: 2, spots_needed: 5, assigned: null, shifts_empty: null, shifts_open: null },
    });
    const [attending, households, meals, volunteers] = workspaceTiles(s);
    expect(attending.sub).toBe("No capacity limit");
    expect(households.sub).toBe("0 confirmed · 2 waiting · 1 cancelled");
    expect(meals).toMatchObject({ value: "Off", sub: "No meal for this event" });
    expect(volunteers.sub).toContain("your role can't see who is assigned");
    const none = workspaceTiles(summary({ volunteers: { visible: true, shifts: 0, spots_needed: 0, assigned: 0, shifts_empty: 0, shifts_open: 0 } }))[3];
    expect(none).toMatchObject({ value: "0", sub: "No shifts yet" });
  });

  it("draws RSVP bars by status against the largest, leaving out empty waiting lists and cancellations", () => {
    expect(rsvpBars(summary()).map((b) => [b.label, b.households, b.pct])).toEqual([
      ["RSVP'd", 30, 100],
      ["Confirmed", 20, 67],
    ]);
    expect(rsvpBars(summary({ households: { rsvpd: 0, confirmed: 0, cancelled: 3 } })).map((b) => b.label)).toEqual(["RSVP'd", "Confirmed", "Cancelled"]);
  });
});

describe("the checklist preview", () => {
  it("shows done actions first, then open ones with their due label, and leaves removed ones out", () => {
    const items = checklistPreview(
      [
        { id: "1", name: "Book the park shelter", state: "not_started", due_on: "2027-03-01" },
        { id: "2", name: "Order the grill", state: "completed", due_on: "2027-02-01" },
        { id: "3", name: "Old idea", state: "removed", due_on: null },
        { id: "4", name: "Thank the sponsors", state: "in_progress", due_on: null },
      ],
      "2027-03-03",
    );
    expect(items.map((i) => [i.name, i.done, i.due?.label ?? null])).toEqual([
      ["Order the grill", true, null],
      ["Book the park shelter", false, "Overdue 2d"],
      ["Thank the sponsors", false, null],
    ]);
  });
});

describe("Niva beside the event", () => {
  it("checks a draft for opening RSVPs and an open event for its day", () => {
    expect(readinessGoalFor("draft")).toBe("publish");
    expect(readinessGoalFor("published")).toBe("event_day");
  });

  it("says the numbers and the community's own languages, by rule", () => {
    expect(nivaOpening(summary(), 0, ["en", "es", "fr"])).toBe("50 households have RSVP'd so far, 140 people in all. Nothing is blocking it. I drafted the reminder in English, Spanish and French.");
    expect(nivaOpening(null, 2, ["pt-BR"])).toBe("2 things need fixing first. I drafted the reminder in Brazilian Portuguese.");
  });

  it("gives one tab per language the community uses: built-in wording where Weaver has it, else English marked needs translation", () => {
    const event = { name: "Spring Picnic 2027", starts_at: "2027-04-17T16:00:00Z", venue: "Riverside Park" };
    const center = { name: "Maple Street Neighbours", short_name: null };
    const drafts = ["en", "es", "hi"].map((language) => draftReminder({ kind: "event_reminder", language, event, tz: "America/Chicago", country: "US", center }));
    const tabs = languageTabs(drafts);
    expect(tabs.map((t) => t.code)).toEqual(["en", "es", "hi"]);
    expect(tabs.map((t) => t.label)).toEqual(["English", "Español", "हिन्दी"]);
    const es = tabs[1];
    expect(es.needsTranslation).toBe(true);
    expect(es.note).toContain("Weaver has no Spanish wording for this yet");
    expect(es.body).toContain("Spring Picnic 2027");
    expect(tabs[2].needsTranslation).toBe(false);
    expect(tabs[2].note).toContain("someone who reads Hindi");
    // Not a fixed list: a French and Arabic community gets French and Arabic tabs, nothing else.
    const other = languageTabs(["fr", "ar"].map((language) => draftReminder({ kind: "event_reminder", language, event, tz: "Europe/Paris", country: "FR", center })));
    expect(other.map((t) => t.code)).toEqual(["fr", "ar"]);
    expect(other.every((t) => t.needsTranslation)).toBe(true);
    expect(other[1].dir).toBe("ltr");
  });

  it("counts the audience by channel and says what quiet hours do; a count the role can't see is a question mark", () => {
    const a: AudienceLike = {
      who: "Families who RSVP'd (RSVP'd or confirmed)",
      households: 50,
      adults: null,
      channels: { email: null, sms: 4, whatsapp: 0 },
      adults_with_no_channel: 3,
      quiet_hours: { window: "9 pm to 8 am", goes_out_at: "Sunday, April 11, 2027, 8:00 AM", held: true, note: "" },
      notes: [],
    };
    expect(audienceTiles(a).map((t) => `${t.strong} ${t.text}`)).toEqual([
      "? by email",
      "4 by text",
      "0 by WhatsApp",
      "Held until Sunday, April 11, 2027, 8:00 AM (quiet hours)",
      "3 adults cannot be reached",
    ]);
    const open = audienceTiles({ ...a, adults_with_no_channel: 0, quiet_hours: { ...a.quiet_hours, held: false } });
    expect(open.map((t) => t.key)).toEqual(["email", "sms", "whatsapp", "quiet"]);
    expect(open[3].text).toBe("quiet hours are 9 pm to 8 am");
  });
});

describe("dates", () => {
  it("suggests the same day a year on for the copy, and 28 February for 29 February", () => {
    expect(sameDayNextYear("2026-11-07", "2026-10-11")).toBe("2027-11-07");
    expect(sameDayNextYear("2028-02-29", "2026-10-11")).toBe("2029-02-28");
    expect(sameDayNextYear(null, "2026-10-11")).toBe("2027-10-11");
  });

  it("writes when the event is in the community's time zone and locale", () => {
    expect(eventWhenLine(null, "America/Chicago")).toBe("No date yet");
    expect(eventWhenLine("2026-11-08T00:00:00Z", "America/Chicago", "en-US")).toBe("Saturday, November 7, 2026 · 6:00 PM");
    expect(eventWhenLine("2026-11-08T00:00:00Z", "Europe/London", "en-GB")).toMatch(/^Sunday,? 8 November 2026 · 00:00$/);
  });
});
