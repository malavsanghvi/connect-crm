import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Events tab now offers "Add to an event" (a client panel that reaches the family page's Server Actions): nothing is called here, only rendered.
vi.mock("@/app/(app)/households/[id]/inline-actions", () => ({ savePersonFieldsAction: vi.fn(), saveHouseholdFieldsAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/custom-actions", () => ({ saveCustomValueAction: vi.fn(), addCustomFieldAction: vi.fn(), setCustomFieldStatusAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/slideover-actions", () => ({ addPersonInlineAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/event-add-actions", () => ({ addToEventAction: vi.fn(), loadAddToEventAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/profile-details-actions", () => ({ saveProfileDetailsAction: vi.fn() }));
vi.mock("@/app/(app)/identifiers/person-id-seam", () => ({ addPersonId: vi.fn(), retirePersonId: vi.fn() }));
vi.mock("@/app/(app)/people/deceased-actions", () => ({ markDeceasedAction: vi.fn(), undoDeceasedAction: vi.fn() }));

import { EventsTable } from "@/components/people-v2/family/events-table";
import { EVENT_NOT_VISIBLE, buildEventLines, eventsSummary, type AttendeeInput, type EventInput, type RsvpInput } from "@/lib/people-v2/family-events";
import { familyTabs, pickFamilyTab } from "@/lib/people-v2/family-model";

import { EVENTS_TAB_LIMIT, EventsTab } from "@/app/(app)/households/[id]/events-tab";

import { fakeDb, fakeSession } from "./commands/helpers";

// A household's RSVPs for events of several kinds of community; the names are in more than one script on purpose.
const EVENTS: EventInput[] = [
  { id: "e-picnic", name: "Spring Picnic", starts_at: "2026-04-18T17:00:00Z" },
  { id: "e-gala", name: "Годовой вечер", starts_at: "2026-10-03T23:00:00Z" },
  { id: "e-cleanup", name: "春の清掃", starts_at: "2025-03-01T15:00:00Z" },
  { id: "e-undated", name: "To be announced", starts_at: null },
];
const rsvp = (id: string, event_id: string, status: string, over: Partial<RsvpInput> = {}): RsvpInput => ({ id, event_id, status, source: "app", created_at: "2026-01-01T00:00:00Z", ...over });
const seat = (rsvp_id: string, status: string, checked_in_at: string | null = null): AttendeeInput => ({ rsvp_id, status, checked_in_at });

describe("the Family page's Events lines", () => {
  it("puts the latest event first and an undated one last, with the words a person reads", () => {
    const lines = buildEventLines(
      [rsvp("r1", "e-cleanup", "attended"), rsvp("r2", "e-gala", "confirmed"), rsvp("r3", "e-undated", "invited"), rsvp("r4", "e-picnic", "no_show")],
      EVENTS,
      [],
    );
    expect(lines.map((l) => l.eventName)).toEqual(["Годовой вечер", "Spring Picnic", "春の清掃", "To be announced"]);
    expect(lines.map((l) => l.answer)).toEqual(["Confirmed", "Did not come", "Came", "Invited"]);
    expect(lines.find((l) => l.rsvpId === "r4")?.tone).toBe("danger");
  });

  it("counts the seats still held and who was checked in, and leaves a cancelled seat out", () => {
    const [line] = buildEventLines(
      [rsvp("r1", "e-gala", "attended")],
      EVENTS,
      [seat("r1", "attended", "2026-10-03T23:30:00Z"), seat("r1", "attended", "2026-10-03T23:31:00Z"), seat("r1", "rsvpd"), seat("r1", "cancelled", "2026-10-03T23:40:00Z")],
    );
    expect(line).toMatchObject({ party: 3, checkedIn: 2 });
  });

  it("says plainly when the role cannot read the event, and still shows the RSVP", () => {
    const [line] = buildEventLines([rsvp("r1", "e-hidden", "rsvpd")], EVENTS, []);
    expect(line).toMatchObject({ eventName: EVENT_NOT_VISIBLE, eventVisible: false, startsAt: null, answer: "RSVP'd" });
  });

  it("never leaves a blank for a status or a source it does not know yet", () => {
    const [line] = buildEventLines([rsvp("r1", "e-gala", "tentative_maybe", { source: "text_message" })], EVENTS, []);
    expect(line).toMatchObject({ answer: "Tentative maybe", tone: "neutral", source: "text message" });
    expect(buildEventLines([rsvp("r2", "e-gala", "")], EVENTS, [])[0].answer).toBe("Unknown");
  });

  it("names nobody in the party: seats are only counted", () => {
    const [line] = buildEventLines([rsvp("r1", "e-gala", "rsvpd")], EVENTS, [seat("r1", "rsvpd")]);
    expect(Object.keys(line)).not.toContain("names");
    expect(JSON.stringify(line)).not.toMatch(/display_name|first_name|is_child/);
  });

  it("sums up the tab: a household came when the RSVP says so or a seat was checked in", () => {
    const lines = buildEventLines(
      [rsvp("r1", "e-cleanup", "attended"), rsvp("r2", "e-gala", "confirmed"), rsvp("r3", "e-picnic", "rsvpd")],
      EVENTS,
      [seat("r2", "confirmed", "2026-10-03T23:30:00Z")],
    );
    expect(eventsSummary(lines)).toEqual({ total: 3, came: 2, text: "3 RSVPs · came to 2" });
    expect(eventsSummary([]).text).toBe("");
    expect(eventsSummary(lines.slice(0, 1)).text).toBe("1 RSVP · came to 1");
  });
});

describe("the Events tab on the tab row", () => {
  it("is offered only with the Events module, between Memberships and History", () => {
    expect(familyTabs({ giving: true, events: true, history: true }).map((t) => t.key)).toEqual(["giving", "memberships", "events", "history"]);
    expect(familyTabs({ giving: true, events: false, history: true }).map((t) => t.key)).toEqual(["giving", "memberships", "history"]);
  });
  it("opens when asked for, and falls back to the first tab when the viewer does not have it", () => {
    const withEvents = familyTabs({ giving: true, events: true, history: true });
    expect(pickFamilyTab("events", withEvents)).toBe("events");
    expect(pickFamilyTab("events", familyTabs({ giving: true, events: false, history: true }))).toBe("giving");
  });
});

describe("the Events table", () => {
  const lines = buildEventLines(
    [rsvp("r1", "e-gala", "attended", { source: "kiosk" }), rsvp("r2", "e-hidden", "rsvpd")],
    EVENTS,
    [seat("r1", "attended", "2026-10-03T23:30:00Z"), seat("r1", "attended")],
  );

  it("draws each RSVP with its event as a link, the answer, the seats and who was checked in", () => {
    const html = renderToStaticMarkup(createElement(EventsTable, { lines, timeZone: "America/Chicago" }));
    expect(html).toContain("Годовой вечер");
    expect(html).toContain('href="/events/e-gala"');
    expect(html).toContain("Came");
    expect(html).toContain("1 of 2");
    expect(html).toContain("Kiosk");
    expect(html).toContain("2 RSVPs · came to 1");
  });

  it("does not link an event the role cannot open", () => {
    const html = renderToStaticMarkup(createElement(EventsTable, { lines, timeZone: "America/Chicago" }));
    expect(html).toContain(EVENT_NOT_VISIBLE);
    expect(html).not.toContain('href="/events/e-hidden"');
  });

  it("says so when nothing was recorded, and when older RSVPs were left out", () => {
    expect(renderToStaticMarkup(createElement(EventsTable, { lines: [], timeZone: "UTC" }))).toContain("No RSVPs from this household");
    expect(renderToStaticMarkup(createElement(EventsTable, { lines, timeZone: "UTC", olderLeftOut: true }))).toContain("older ones are on each event");
  });
});

describe("the Events tab (what it reads)", () => {
  const HH = "hh-1";
  const tables = {
    rsvps: [
      { id: "r1", center_id: "center-1", household_id: HH, event_id: "e-gala", status: "attended", source: "app", created_at: "2026-09-01T00:00:00Z" },
      { id: "r2", center_id: "center-1", household_id: "hh-other", event_id: "e-gala", status: "rsvpd", source: "app", created_at: "2026-09-02T00:00:00Z" },
    ],
    events: EVENTS.map((e) => ({ ...e, center_id: "center-1" })),
    attendees: [
      { rsvp_id: "r1", status: "attended", checked_in_at: "2026-10-03T23:30:00Z" },
      { rsvp_id: "r2", status: "rsvpd", checked_in_at: null },
    ],
  };
  const render = async (over: { permissions?: string[]; failTables?: Record<string, { message: string }> } = {}) =>
    renderToStaticMarkup(
      await EventsTab({
        session: fakeSession({ permissions: over.permissions ?? ["events.view"], db: fakeDb({ tables, failTables: over.failTables }) }),
        householdId: HH,
      }),
    );

  it("shows this household's RSVPs only, with who came", async () => {
    const html = await render();
    expect(html).toContain("Годовой вечер");
    expect(html).toContain("Came");
    expect(html).toContain("1 of 1");
    expect(html).toContain("1 RSVP · came to 1");
  });

  it("says 'You don't have access to this area' to a role without events access, never an empty table", async () => {
    const html = await render({ permissions: ["people.view"] });
    expect(html).toContain("have access to this area");
    expect(html).not.toContain("No RSVPs from this household");
    expect(html).not.toContain("Годовой вечер");
  });

  it("shows an empty household as empty, not as an error", async () => {
    const html = renderToStaticMarkup(await EventsTab({ session: fakeSession({ permissions: ["events.view"], db: fakeDb({ tables }) }), householdId: "hh-none" }));
    expect(html).toContain("No RSVPs from this household");
  });

  it("says what could not be read, with a retry, for each of the three reads", async () => {
    const first = await render({ failTables: { rsvps: { message: "boom" } } });
    expect(first).toContain("Could not load this household&#x27;s RSVPs");
    expect(first).toContain('href="/households/hh-1?tab=events"');
    expect(await render({ failTables: { events: { message: "boom" } } })).toContain("Could not load the events these RSVPs are for");
    expect(await render({ failTables: { attendees: { message: "boom" } } })).toContain("Could not load who was checked in");
  });

  it("asks for one more than it shows, so it knows when older RSVPs were left out", () => {
    expect(EVENTS_TAB_LIMIT).toBe(100);
  });
});
