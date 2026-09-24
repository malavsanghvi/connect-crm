import { describe, expect, it } from "vitest";

import { hasScopedRole, pickCurrentEvent, scopedEventIds, type EventAccess } from "@/lib/events/access";
import { dueBadge } from "@/lib/events/checklist";
import { formatEventRange, fromDateTimeLocal, toDateTimeLocal, toE164 } from "@/lib/events/format";
import { centsList, FormError } from "@/lib/events/forms";
import { createScanQueue, memoryStorage } from "@/lib/events/offline-queue";
import {
  audienceChips,
  audienceLabel,
  commitmentSummary,
  eventReport,
  formatSeconds,
  lunchPriorityText,
  lunchSlotCounts,
  medianCheckinSeconds,
  parsePartyLines,
  planLunchSlots,
  recentCheckins,
  slotBoard,
  slotPreview,
} from "@/lib/events/report";
import { lunchRulesFromCenter } from "@/lib/events/rules";
import { eventRowHref, eventStatusLabel } from "@/lib/events/status";
import { extractTicketToken } from "@/lib/events/tokens";
import { NAV } from "@/lib/permissions";

const TZ = "America/Chicago";

function att(id: string, rsvp: string, extra: Partial<Parameters<typeof eventReport>[1][number]> = {}) {
  return {
    id,
    rsvp_id: rsvp,
    status: "rsvpd",
    checked_in_at: null,
    served_food_at: null,
    lunch_slot_id: null,
    is_child_under_12: false,
    is_senior: false,
    needs_assistance: false,
    ...extra,
  };
}

describe("eventReport", () => {
  const rsvps = [
    { id: "r1", status: "confirmed", source: "app", confirmed_at: "2026-09-01T00:00:00Z" },
    { id: "r2", status: "rsvpd", source: "app", confirmed_at: null },
    { id: "r3", status: "waitlisted", source: "app", confirmed_at: null },
    { id: "r4", status: "attended", source: "walk_in", confirmed_at: null },
    { id: "r5", status: "cancelled", source: "app", confirmed_at: null },
  ];
  const attendees = [
    att("a1", "r1", { checked_in_at: "2026-09-27T15:00:00Z", is_child_under_12: true }),
    att("a2", "r1"),
    att("a3", "r2"),
    att("a4", "r3"),
    att("a5", "r3"),
    att("a6", "r4", { checked_in_at: "2026-09-27T15:05:00Z" }),
    att("a7", "r5"),
  ];
  const r = eventReport(rsvps, attendees);
  it("counts people by RSVP state, keeping walk-ins and the waitlist apart", () => {
    expect(r.rsvpdPeople).toBe(3);
    expect(r.confirmedPeople).toBe(2);
    expect(r.checkedIn).toBe(2);
    expect(r.walkIns).toBe(1);
    expect(r.walkInHouseholds).toBe(1);
    expect(r.waitlistedPeople).toBe(2);
    expect(r.waitlistedHouseholds).toBe(1);
    expect(r.noShows).toBe(2);
    expect(r.flags.childUnder12).toBe(1);
  });
});

describe("lunch slots", () => {
  it("plans slots from lunch start to the event end", () => {
    const plan = planLunchSlots({ lunchStartsAt: "2026-11-08T18:00:00Z", eventEndsAt: "2026-11-08T19:00:00Z", slotMinutes: 15, seatsPerSlot: 120 });
    expect(plan).toHaveLength(4);
    expect(plan[1].starts_at).toBe("2026-11-08T18:15:00.000Z");
    expect(plan[0].seats).toBe(120);
  });

  it("labels the board Serving / Next / Queued / Open / Done", () => {
    const slots = [
      { id: "s1", starts_at: "2026-11-08T18:00:00Z", seats: 120, status: "done" },
      { id: "s2", starts_at: "2026-11-08T18:15:00Z", seats: 120, status: "now_serving" },
      { id: "s3", starts_at: "2026-11-08T18:30:00Z", seats: 120, status: "scheduled" },
      { id: "s4", starts_at: "2026-11-08T18:45:00Z", seats: 120, status: "scheduled" },
      { id: "s5", starts_at: "2026-11-08T19:00:00Z", seats: 120, status: "scheduled" },
    ];
    const people = [att("a", "r", { lunch_slot_id: "s4" }), att("b", "r", { lunch_slot_id: "s3" })];
    const board = slotBoard(lunchSlotCounts(slots, people)).map((s) => s.board);
    expect(board).toEqual(["Done", "Serving", "Next", "Queued", "Open"]);
  });

  it("makes the first scheduled slot Next when nothing is served yet", () => {
    const board = slotBoard([
      { starts_at: "a", status: "scheduled", assignedCount: 3 },
      { starts_at: "b", status: "scheduled", assignedCount: 0 },
    ]).map((s) => s.board);
    expect(board).toEqual(["Next", "Open"]);
  });

  it("previews the slot engine with the settings", () => {
    const rules = { childAtStart: true, seniorAtStart: true, reminderMinutes: 5 };
    const clock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
    const lines = slotPreview({ lunchStartMinutes: 12 * 60, slotMinutes: 15, seatsPerSlot: 40, rules, formatMinutes: clock });
    expect(lines[0].text).toContain("12:00 together");
    // Arrival #87 with 40 seats a slot lands in the third slot.
    expect(lines[2].text).toContain("#87 → 12:30");
    expect(lines[3].text).toContain("5 minutes");
    expect(slotPreview({ lunchStartMinutes: null, slotMinutes: 15, seatsPerSlot: 40, rules, formatMinutes: clock })[0].tone).toBe("muted");
    expect(lunchPriorityText({ ...rules, seniorAtStart: false })).toMatch(/^Families with a child under 12 eat together at start/);
  });

  it("reads lunch rules from the center with the database defaults", () => {
    expect(lunchRulesFromCenter({})).toEqual({ childAtStart: true, seniorAtStart: true, reminderMinutes: 5 });
    expect(lunchRulesFromCenter({ lunch: { senior_at_start: false, reminder_minutes_before: 10 } })).toEqual({
      childAtStart: true,
      seniorAtStart: false,
      reminderMinutes: 10,
    });
  });
});

describe("median check-in", () => {
  it("measures gaps between successful entry scans per device, ignoring idle gaps", () => {
    const s = (t: string, device = "d1", result = "ok", station = "entry") => ({ scanned_at: `2026-09-27T15:${t}Z`, device_id: device, station, result });
    const scans = [s("00:00"), s("00:06"), s("00:12"), s("00:20"), s("09:00"), s("00:00", "d2"), s("00:05", "d2"), s("00:07", "d1", "duplicate"), s("00:30", "d1", "ok", "food")];
    expect(medianCheckinSeconds(scans)).toBe(6);
    expect(medianCheckinSeconds([s("00:00")])).toBeNull();
    expect(formatSeconds(6)).toBe("6 s");
    expect(formatSeconds(80)).toBe("1 min 20 s");
    expect(formatSeconds(null)).toBe("—");
  });
});

describe("recent check-ins", () => {
  it("groups a family's arrival and says why they have their slot", () => {
    const rows = [
      { rsvp_id: "r1", checked_in_at: "2026-09-27T15:42:00Z", lunch_slot_id: "s1", is_child_under_12: true, is_senior: false, needs_assistance: false },
      { rsvp_id: "r1", checked_in_at: "2026-09-27T15:42:10Z", lunch_slot_id: "s1", is_child_under_12: false, is_senior: false, needs_assistance: false },
      { rsvp_id: "r2", checked_in_at: "2026-09-27T15:41:00Z", lunch_slot_id: null, is_child_under_12: false, is_senior: false, needs_assistance: false },
    ];
    const out = recentCheckins(rows, (id) => (id === "r1" ? "Shah family" : "Kothari family"), () => "2026-09-27T17:00:00Z");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ family: "Shah family", count: 2, group: "child under 12", lunchSlotStartsAt: "2026-09-27T17:00:00Z" });
    expect(out[1]).toMatchObject({ family: "Kothari family", count: 1, group: "adults", lunchSlotStartsAt: null });
  });
});

describe("builder helpers", () => {
  it("maps the four audience chips onto the five audiences", () => {
    expect(audienceChips("public")[0].value).toBe("public");
    expect(audienceChips("members_only")[0].value).toBe("members_and_guests");
    expect(audienceLabel("members_and_guests")).toBe("Everyone");
    expect(audienceLabel("life_members_only")).toBe("Life members only");
  });

  it("summarises commitments as the prototype does", () => {
    const fmt = (c: number) => `$${c / 100}`;
    expect(commitmentSummary({ per_person: [300, 500, 700], lump_sum: [1000, 2500, 5000], open: true }, fmt)).toBe(
      "Per person $3/$5/$7 or lump sum $10/$25/$50/open",
    );
    expect(commitmentSummary({ lump_sum: [1000], open: false }, fmt)).toBe("Lump sum $10");
  });

  it("parses amounts and party lines", () => {
    expect(centsList("3, 5 7.50", "Amounts")).toEqual([300, 500, 750]);
    expect(() => centsList("3, x", "Amounts")).toThrow(FormError);
    expect(parsePartyLines("Priya Shah\nAnya Shah, child\n\nKanta Shah, senior, wheelchair")).toEqual([
      { name: "Priya Shah", child_under_12: false, senior: false, assistance: false },
      { name: "Anya Shah", child_under_12: true, senior: false, assistance: false },
      { name: "Kanta Shah", child_under_12: false, senior: true, assistance: true },
    ]);
  });

  it("round-trips datetime-local values in the center's zone", () => {
    const iso = fromDateTimeLocal("2026-11-08T12:00", TZ)!;
    expect(iso).toBe("2026-11-08T18:00:00.000Z");
    expect(toDateTimeLocal(iso, TZ)).toBe("2026-11-08T12:00");
    expect(fromDateTimeLocal("2026-07-04T12:00", TZ)).toBe("2026-07-04T17:00:00.000Z");
    expect(toE164("(713) 555-0198")).toBe("+17135550198");
    expect(toE164("123")).toBeNull();
  });

  it("formats multi-day ranges", () => {
    const now = new Date("2026-09-01T00:00:00Z");
    expect(formatEventRange("2026-10-17T15:00:00Z", "2026-10-25T23:00:00Z", TZ, now)).toBe("Oct 17–25");
    expect(formatEventRange("2026-11-08T15:00:00Z", "2026-11-08T20:00:00Z", TZ, now)).toBe("Sun, Nov 8");
    expect(formatEventRange(null, null, TZ, now)).toBe("No date yet");
  });
});

describe("status and rows", () => {
  it("reads status as the prototype's coloured words", () => {
    expect(eventStatusLabel("draft")).toEqual({ label: "Draft", tone: "warn" });
    expect(eventStatusLabel("published")).toEqual({ label: "RSVP open", tone: "ok" });
    expect(eventStatusLabel("published", { waitlistEnabled: true, waitlisted: 12, capacity: 150, booked: 146 }).label).toBe("Waitlist on");
    expect(eventStatusLabel("published", { capacity: 10, booked: 10 }).label).toBe("Full");
  });
  it("opens drafts in the builder and live events on the dashboard", () => {
    expect(eventRowHref({ id: "x", status: "draft" })).toBe("/events/builder?event=x");
    expect(eventRowHref({ id: "x", status: "live" })).toBe("/events/live?event=x");
    expect(eventRowHref({ id: "x", status: "published" })).toBe("/events/x");
  });
  it("due badges always carry words", () => {
    expect(dueBadge({ state: "not_started", due_on: "2026-09-20" }, "2026-09-24")).toEqual({ label: "Overdue 4d", tone: "bad" });
    expect(dueBadge({ state: "completed", due_on: null }, "2026-09-24").label).toBe("Done");
    expect(dueBadge({ state: "not_started", due_on: "2026-09-29" }, "2026-09-24")).toEqual({ label: "Due in 5d", tone: "warn" });
  });
});

describe("event-scoped access", () => {
  const base: EventAccess = {
    permissions: [],
    isPlatformAdmin: false,
    grants: [
      { role_key: "checkin_volunteer", scope_kind: "event", scope_id: "e1", starts_at: "2020-01-01T00:00:00Z", ends_at: null },
      { role_key: "event_lead", scope_kind: "event", scope_id: "e2", starts_at: "2020-01-01T00:00:00Z", ends_at: "2021-01-01T00:00:00Z" },
    ],
  };
  it("honours a role granted for one event only, and only while active", () => {
    expect(hasScopedRole(base, "e1", "checkin_volunteer")).toBe(true);
    expect(hasScopedRole(base, "e3", "checkin_volunteer")).toBe(false);
    expect(hasScopedRole(base, "e2", "event_lead")).toBe(false);
    expect(scopedEventIds(base)).toEqual(["e1"]);
  });
  it("picks the live event, else today's, else the next", () => {
    const day = (iso: string) => iso.slice(0, 10);
    const evs = [
      { id: "past", starts_at: "2026-09-01T15:00:00Z", ends_at: null, status: "completed" },
      { id: "next", starts_at: "2026-10-01T15:00:00Z", ends_at: null, status: "published" },
      { id: "draft", starts_at: "2026-09-24T15:00:00Z", ends_at: null, status: "draft" },
    ];
    const now = new Date("2026-09-24T12:00:00Z");
    expect(pickCurrentEvent(evs, day, "2026-09-24", now)?.id).toBe("next");
    expect(pickCurrentEvent([...evs, { id: "live", starts_at: null, ends_at: null, status: "live" }], day, "2026-09-24", now)?.id).toBe("live");
    expect(pickCurrentEvent([evs[0]], day, "2026-09-24", now)?.id).toBe("past");
  });
});

describe("check-in plumbing", () => {
  it("extracts ticket tokens from what a scanner reads", () => {
    expect(extractTicketToken("https://x.test/t?t=abc123")).toBe("abc123");
    expect(extractTicketToken(" 0123456789ABCDEF0123456789abcdef ")).toBe("0123456789abcdef0123456789abcdef");
    expect(extractTicketToken("M-0417")).toBe("M-0417");
  });
  it("queues offline scans once and replays them in order", async () => {
    let n = 0;
    const q = createScanQueue(memoryStorage(), "k", () => `id${n++}`);
    q.enqueue({ eventId: "e", token: "a", station: "entry" });
    q.enqueue({ eventId: "e", token: "a", station: "entry" });
    q.enqueue({ eventId: "e", token: "b", station: "entry" });
    expect(q.size()).toBe(2);
    const report = await q.replay(async (s) => (s.token === "a" ? { kind: "sent" } : { kind: "retry", error: "offline" }));
    expect(report).toMatchObject({ sent: 1, remaining: 1 });
  });
});

describe("nav", () => {
  it("lists Events after People with the prototype's four tabs", () => {
    const keys = NAV.map((m) => m.key);
    expect(keys.indexOf("events")).toBe(keys.indexOf("people") + 1);
    expect(NAV.find((m) => m.key === "events")!.tabs.map((t) => t.label)).toEqual(["All events", "Event builder", "Live check-in", "Feedback"]);
  });
});
