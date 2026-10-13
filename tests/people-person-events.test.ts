import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PERSON_EVENTS_LIMIT, loadPersonEvents } from "@/lib/people-v2/person-events-load";
import { cameText, personEventLines, personEventsSummary } from "@/lib/people-v2/person-events";

import { fakeDb, fakeSession } from "./commands/helpers";

// One person's own tickets, for the Events section of the slide-over. Names are in more than one script on purpose.
const EVENTS = [
  { id: "e-picnic", name: "Spring Picnic", starts_at: "2026-04-18T17:00:00Z" },
  { id: "e-gala", name: "Годовой вечер", starts_at: "2026-10-03T23:00:00Z" },
  { id: "e-cleanup", name: "春の清掃", starts_at: "2025-03-01T15:00:00Z" },
];
const rsvp = (id: string, event_id: string, status: string) => ({ id, event_id, status, source: "app", created_at: "2026-01-01T00:00:00Z" });
const seat = (rsvp_id: string, status: string, checked_in_at: string | null = null) => ({ rsvp_id, status, checked_in_at });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a person's own event lines", () => {
  it("shows one line per RSVP the person has a ticket on, the latest event first, and ignores RSVPs they are not on", () => {
    const lines = personEventLines(
      [rsvp("r1", "e-picnic", "confirmed"), rsvp("r2", "e-gala", "rsvpd"), rsvp("r3", "e-cleanup", "confirmed")],
      EVENTS,
      [seat("r1", "confirmed"), seat("r2", "rsvpd")],
    );
    expect(lines.map((l) => [l.eventName, l.answer])).toEqual([
      ["Годовой вечер", "RSVP'd"],
      ["Spring Picnic", "Confirmed"],
    ]);
  });

  it("reads 'Came' for a ticket that was checked in, and says so in the last column", () => {
    const [line] = personEventLines([rsvp("r1", "e-gala", "confirmed")], EVENTS, [seat("r1", "confirmed", "2026-10-03T23:30:00Z")]);
    expect(line).toMatchObject({ answer: "Came", checkedIn: 1, party: 1 });
    expect(cameText(line)).toBe("Yes");
    const [waiting] = personEventLines([rsvp("r1", "e-gala", "confirmed")], EVENTS, [seat("r1", "confirmed")]);
    expect(cameText(waiting)).toBe("—");
  });

  it("reads 'Cancelled' for a ticket the person released, even though the family's RSVP is still on", () => {
    const [line] = personEventLines([rsvp("r1", "e-gala", "confirmed")], EVENTS, [seat("r1", "cancelled")]);
    expect(line).toMatchObject({ answer: "Cancelled", party: 0 });
  });

  it("counts the live ticket when the person has a cancelled one and a new one on the same RSVP", () => {
    const lines = personEventLines([rsvp("r1", "e-gala", "confirmed")], EVENTS, [seat("r1", "cancelled"), seat("r1", "confirmed")]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ answer: "Confirmed", party: 1 });
  });

  it("does not turn a cancelled RSVP into 'Came'", () => {
    const [line] = personEventLines([rsvp("r1", "e-gala", "cancelled")], EVENTS, [seat("r1", "confirmed", "2026-10-03T23:30:00Z")]);
    expect(line.answer).toBe("Cancelled");
  });

  it("says plainly when the role cannot read the event, and still shows the ticket", () => {
    const [line] = personEventLines([rsvp("r1", "e-hidden", "rsvpd")], EVENTS, [seat("r1", "rsvpd")]);
    expect(line).toMatchObject({ eventVisible: false, answer: "RSVP'd" });
  });

  it("sums up the list", () => {
    const lines = personEventLines(
      [rsvp("r1", "e-picnic", "confirmed"), rsvp("r2", "e-gala", "confirmed")],
      EVENTS,
      [seat("r1", "confirmed"), seat("r2", "confirmed", "2026-10-03T23:30:00Z")],
    );
    expect(personEventsSummary(lines)).toBe("2 RSVPs · came to 1");
    expect(personEventsSummary(lines.slice(0, 1))).toBe("1 RSVP · came to 1");
    expect(personEventsSummary([])).toBe("");
  });
});

describe("loading a person's tickets", () => {
  const tables = {
    attendees: [
      { rsvp_id: "r1", status: "confirmed", checked_in_at: "2026-04-18T17:20:00Z", person_id: "p-1", center_id: "center-1" },
      { rsvp_id: "r2", status: "cancelled", checked_in_at: null, person_id: "p-1", center_id: "center-1" },
      { rsvp_id: "r1", status: "confirmed", checked_in_at: null, person_id: "p-2", center_id: "center-1" },
    ],
    rsvps: [
      { ...rsvp("r1", "e-picnic", "confirmed"), center_id: "center-1" },
      { ...rsvp("r2", "e-gala", "confirmed"), center_id: "center-1" },
    ],
    events: EVENTS,
  };
  const load = (over: { failTables?: Record<string, { message: string }>; tables?: typeof tables; personId?: string } = {}) =>
    loadPersonEvents(fakeSession({ db: fakeDb({ tables: (over.tables ?? tables) as never, failTables: over.failTables }) }), over.personId ?? "p-1");

  it("reads this person's own tickets only", async () => {
    const r = await load();
    expect(r.state).toBe("ok");
    if (r.state !== "ok") return;
    expect(r.data.lines.map((l) => [l.eventName, l.answer])).toEqual([
      ["Годовой вечер", "Cancelled"],
      ["Spring Picnic", "Came"],
    ]);
    expect(r.data.olderLeftOut).toBe(false);
  });

  it("is an empty list, not an error, for a person on no event", async () => {
    expect(await load({ personId: "p-nobody" })).toEqual({ state: "ok", data: { lines: [], olderLeftOut: false } });
  });

  it("asks for one more than it shows, to know when older tickets were left out", () => {
    expect(PERSON_EVENTS_LIMIT).toBe(50);
  });

  it("says which read failed, in words, for each of the three", async () => {
    const first = await load({ failTables: { attendees: { message: "boom" } } });
    expect(first).toMatchObject({ state: "error", message: expect.stringContaining("Could not load this person's event tickets") });
    expect(await load({ failTables: { rsvps: { message: "boom" } } })).toMatchObject({ state: "error", message: expect.stringContaining("Could not load the RSVPs these tickets are on") });
    expect(await load({ failTables: { events: { message: "boom" } } })).toMatchObject({ state: "error", message: expect.stringContaining("Could not load the events these tickets are for") });
    expect(console.error).toHaveBeenCalled();
  });
});
