import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// "Add to an event" is drawn from a state; here nothing is called, only rendered. The server parts (the section, the tab) are called as
// functions with a fake session and a fake database.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (orig) => ({ ...((await orig()) as object), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/households/[id]/inline-actions", () => ({ savePersonFieldsAction: vi.fn(), saveHouseholdFieldsAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/custom-actions", () => ({ saveCustomValueAction: vi.fn(), addCustomFieldAction: vi.fn(), setCustomFieldStatusAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/slideover-actions", () => ({ addPersonInlineAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/event-add-actions", () => ({ addToEventAction: vi.fn(), loadAddToEventAction: vi.fn() }));
vi.mock("@/app/(app)/identifiers/person-id-seam", () => ({ addPersonId: vi.fn(), retirePersonId: vi.fn() }));
vi.mock("@/app/(app)/people/deceased-actions", () => ({ markDeceasedAction: vi.fn(), undoDeceasedAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/lib/data/events", async () => {
  const { loadEventAccessFor } = await import("@/lib/events/access-load");
  return { loadEventAccess: (s: Parameters<typeof loadEventAccessFor>[0]) => loadEventAccessFor(s) };
});

import { EventsTab } from "@/app/(app)/households/[id]/events-tab";
import { PersonEventsServer } from "@/app/(app)/households/[id]/person-events";
import { PreviewShell } from "@/app/dev/people-shell";
import { eventChoices, personLines, readError } from "@/app/dev/people-event-add/fixtures";
import { familyFixture } from "@/app/dev/people-family/fixtures";
import { detailFixture } from "@/app/dev/people-slideover/fixtures";
import { AddToEvent, AddToEventView, CLOSED, derive, type PanelHandlers, type PanelState } from "@/components/people-v2/events/add-to-event";
import { PersonEventsBody } from "@/components/people-v2/events/person-events";
import { SlideOverBody } from "@/components/people-v2/slideover/person-slideover";
import { addToEventProps } from "@/lib/people-v2/event-add-props";
import { NO_ACCESS_TEXT, sectionPlan } from "@/lib/people-v2/slideover";

import { fakeDb, fakeSession } from "./commands/helpers";

void PreviewShell;

const model = familyFixture("hassan");
const props = addToEventProps(model, "p-samira", "America/Chicago");
const events = eventChoices("ok", "hassan");
const noop = () => {};
const on: PanelHandlers = { show: noop, close: noop, retry: noop, pickEvent: noop, toggle: noop, chooseEveryone: noop, setConfirmed: noop, ask: noop, back: noop, submit: noop };

const draw = (state: Partial<PanelState>, p = props) => renderToStaticMarkup(createElement(AddToEventView, { props: p, state: { ...CLOSED, ...state }, on }));
const open = (state: Partial<PanelState> = {}) => draw({ open: true, load: { state: "ready", events }, ...state });

describe("the Add to an event panel, state by state", () => {
  it("is a button when closed", () => {
    const html = draw({});
    expect(html).toContain("Add to an event");
    expect(html).not.toContain("Which event");
  });

  it("says the events are loading", () => {
    expect(draw({ open: true, load: { state: "loading" } })).toContain("Loading the upcoming events");
  });

  it("shows the family by its card line, never by its name alone", () => {
    const html = open();
    expect(html).toContain("Hassan household · No. 0301 · RCC-H-1102");
    expect(html).toContain("Riverside, North Riverside");
  });

  it("lists the events with date, places left and who they are for, and says when RSVPs are closed", () => {
    const html = open();
    for (const text of ["Spring Picnic", "Harvest Dinner", "No limit on places", "24 of 120 places left", "For members", "Full · new RSVPs go on the waitlist", "1 of 30 places left", "RSVPs are closed. You can still add a family by hand."]) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain("Oct 18, 2026");
  });

  it("lists the family's people with the person it was opened from ticked, children compact and marked staff only", () => {
    const html = open({ eventId: "ev-picnic", chosen: new Set(["p-samira"]) });
    expect(html).toContain("Who is coming");
    expect(html).toMatch(/<input type="checkbox"[^>]* checked=""\/><span[^>]*>Samira Hassan/);
    expect(html).toMatch(/<input type="checkbox" class="size-4 shrink-0"\/><span[^>]*>Karim Hassan/);
    expect(html).toContain("Children · staff only");
    expect(html).toContain("Layla Hassan");
    expect(html).toContain("age 11");
    expect(html).toContain("Choose the whole family");
  });

  it("asks for an event first: the button reads 'Choose an event' and does nothing", () => {
    const html = open();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Choose an event<\/button>/);
  });

  it("offers 'Add to <event>' once an event and a person are chosen, then asks the one question", () => {
    const choosing = open({ eventId: "ev-picnic", chosen: new Set(["p-samira", "p-layla"]) });
    expect(choosing).toMatch(/<button type="button" class="[^"]*">Add to Spring Picnic<\/button>/);
    const asking = open({ eventId: "ev-picnic", chosen: new Set(["p-samira", "p-layla"]), step: "ask" });
    expect(asking).toContain("Add Samira and Layla to Spring Picnic?");
    expect(asking).toContain("Yes, add them");
    expect(asking).toContain("No, go back");
  });

  it("disables everything while adding, and the button says 'Adding…'", () => {
    const html = open({ eventId: "ev-picnic", chosen: new Set(["p-samira"]), step: "adding" });
    expect(html).toContain("Adding…");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Adding…<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>No, go back<\/button>/);
  });

  it("says plainly that a person is already on the event, and does not let them be chosen again", () => {
    const already = eventChoices("already", "hassan");
    const html = open({ load: { state: "ready", events: already }, eventId: "ev-picnic", chosen: new Set(["p-samira"]) });
    expect(html).toContain("Already on it");
    expect(html).toContain("This family already has an RSVP");
    // Samira is on it: her box is off and cannot be ticked, so there is nothing to add until someone else is chosen.
    expect(html).toMatch(/<input type="checkbox" disabled=""[^>]*\/><span[^>]*>Samira Hassan/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add to Spring Picnic<\/button>/);
  });

  it("says the event is full and cannot wait, with the reason, before anything is sent", () => {
    const html = open({ eventId: "ev-camp", chosen: new Set(["p-samira", "p-layla"]) });
    expect(html).toContain('data-testid="add-to-event-refusal"');
    expect(html).toContain("Weekend camp has room for 1 more person, and 2 were chosen.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add to Weekend camp<\/button>/);
  });

  it("tells a family it will go on the waitlist, before the question", () => {
    const html = open({ eventId: "ev-cleanup", chosen: new Set(["p-samira"]), step: "ask" });
    expect(html).toContain("is full, so Samira will go on the waitlist.");
    expect(html).toContain("Add Samira to Neighbourhood cleanup · 春の清掃?");
  });

  it("offers 'already said yes' only for a family with no RSVP yet", () => {
    expect(open({ eventId: "ev-picnic", chosen: new Set(["p-samira"]) })).toContain("The family has already said yes");
    expect(open({ load: { state: "ready", events: eventChoices("already", "hassan") }, eventId: "ev-picnic", chosen: new Set(["p-layla"]) })).not.toContain("The family has already said yes");
  });

  it("says in words what went wrong next to what was done, with 'Try again'", () => {
    const html = open({
      eventId: "ev-picnic",
      chosen: new Set(["p-samira"]),
      step: "ask",
      failure: { kind: "other", error: "Could not add them to the event — the database could not be reached — check the connection and try again." },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not add them to the event — the database could not be reached");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Yes, add them");
  });

  it("says 'You don't have access to this area' for a role without the gate", () => {
    expect(draw({ open: true, load: { state: "failed", kind: "access", error: NO_ACCESS_TEXT } })).toContain("You don&#x27;t have access to this area");
    expect(open({ eventId: "ev-picnic", chosen: new Set(["p-samira"]), step: "ask", failure: { kind: "access", error: "x" } })).toContain("You don&#x27;t have access to this area");
  });

  it("says a failed load in words with a retry, and an empty list as empty, not as an error", () => {
    const failed = draw({ open: true, load: { state: "failed", kind: "other", error: "Could not load the events — the database could not be reached." } });
    expect(failed).toContain("Could not load the events");
    expect(failed).toContain("Try again");
    const none = draw({ open: true, load: { state: "ready", events: [] } });
    expect(none).toContain("There is no upcoming event you can add people to");
    expect(none).not.toContain('role="alert"');
  });

  it("says what was done after it worked, with a way to add to another event", () => {
    const html = draw({ done: "Samira and Layla are on Spring Picnic." });
    expect(html).toContain("Samira and Layla are on Spring Picnic.");
    expect(html).toContain("Add to another event");
    expect(html).toContain('role="status"');
  });

  it("works in any script", () => {
    const tanaka = familyFixture("tanaka");
    const p = addToEventProps(tanaka, "p-misaki", "Asia/Tokyo");
    const html = draw({ open: true, load: { state: "ready", events }, eventId: "ev-cleanup", chosen: new Set(["p-misaki"]), step: "ask" }, p);
    expect(html).toContain("田中・Haddad の家 · No. 0507");
    expect(html).toContain("Add 美咲 to Neighbourhood cleanup · 春の清掃?");
    expect(html).toContain("田中 空");
  });

  it("never lists someone in memory as a choice", () => {
    const people = props.people.map((p) => (p.id === "p-karim" ? { ...p, deceased: true } : p));
    const html = draw({ open: true, load: { state: "ready", events }, eventId: "ev-picnic" }, { ...props, people });
    expect(html).toContain("In memory");
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled=""[^>]*\/><span[^>]*>Karim Hassan/);
  });

  it("derives who is ticked and what adding them would do", () => {
    const d = derive(props, { ...CLOSED, load: { state: "ready", events }, eventId: "ev-picnic", chosen: new Set(["p-samira", "p-karim"]) });
    expect(d.picked.map((c) => c.id)).toEqual(["p-samira", "p-karim"]);
    expect(d.plan).toMatchObject({ kind: "add", mode: "create" });
  });

  it("the whole component starts closed (hooks and all) with the real Server Actions behind it", () => {
    const html = renderToStaticMarkup(createElement(AddToEvent, props));
    expect(html).toContain("Add to an event");
    expect(html).not.toContain("Which event");
  });
});

describe("the Events section of the person slide-over", () => {
  const list = personLines("hassan", "p-samira");
  const body = (o: Partial<Parameters<typeof PersonEventsBody>[0]> = {}) =>
    renderToStaticMarkup(createElement(PersonEventsBody, { firstName: "Samira", list, timeZone: "America/Chicago", add: { kind: "add", props }, ...o }));

  it("lists this person's own tickets: the event, its date, the answer and whether they were checked in", () => {
    const html = body();
    expect(html).toContain("Founders&#x27; Day lunch");
    expect(html).toContain("May 3, 2026");
    expect(html).toContain("Came");
    expect(html).toContain("Winter concert");
    expect(html).toContain("Confirmed");
    // A ticket she released reads Cancelled for her.
    expect(html).toContain("Garden workday");
    expect(html).toContain("Cancelled");
    expect(html).toContain("3 RSVPs · came to 1");
    expect(html).toContain('href="/events/ev-winter"');
  });

  it("says plainly when the person is on no event's list", () => {
    expect(body({ list: { state: "ok", data: { lines: [], olderLeftOut: false } } })).toContain("Samira is not on the list for any event yet.");
  });

  it("says a read that failed, and keeps the control", () => {
    const html = body({ list: readError() });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not load this person&#x27;s event tickets");
    expect(html).toContain("Add to an event");
  });

  it("says a role may only look, and that a person in no family cannot be added from here", () => {
    expect(body({ add: { kind: "view-only" } })).toContain("Adding someone to an event needs the event manager role");
    expect(body({ add: { kind: "view-only" } })).not.toContain(">Add to an event<");
    expect(body({ add: { kind: "no-family" } })).toContain("Not in a family yet, so they cannot be added to an event from here.");
    expect(body({ add: { kind: "none" } })).not.toContain("Add to an event");
  });

  it("is a section of the slide-over only with the Events module, right after Memberships", () => {
    const keys = (hasEvents: boolean) => sectionPlan({ isChild: false, givingByPerson: true, givingOn: true, hasHistory: true, hasEvents }).map((s) => s.key);
    expect(keys(true)).toEqual(["profile", "custom_fields", "account", "roles", "privacy", "ids", "memberships", "events", "giving", "notes", "history"]);
    expect(keys(false)).not.toContain("events");
    expect(sectionPlan({ isChild: false, givingByPerson: true, givingOn: true, hasHistory: true }).map((s) => s.key)).not.toContain("events");
  });

  it("is drawn inside the slide-over with its title, and the slot is what the server passed", () => {
    const detail = detailFixture("hassan", "p-samira", { access: "full", standalone: false })!;
    const plan = sectionPlan({ isChild: false, givingByPerson: false, givingOn: false, hasHistory: false, hasEvents: true });
    const slideover = (events?: React.ReactNode) =>
      renderToStaticMarkup(
        createElement(SlideOverBody, { detail, plan, slots: { events }, hrefs: { details: "/d", move: "/m", merge: "/g" }, mode: "panel", closeHref: "/c", closeLabel: "Hassan household", onClose: noop }),
      );
    const withSlot = slideover(createElement(PersonEventsBody, { firstName: "Samira", list, timeZone: "America/Chicago", add: { kind: "add", props } }));
    expect(withSlot).toContain('data-section="events"');
    expect(withSlot).toContain(">Events<");
    expect(withSlot).toContain("Winter concert");
    // A slide-over whose server left the slot out says it, instead of an empty section.
    expect(slideover(undefined)).toContain("You don&#x27;t have access to this area");
  });

  it("a child's section has the same list, read only, and the panel lists the whole family", () => {
    const child = body({ firstName: "Layla", list: personLines("hassan", "p-layla") });
    expect(child).toContain("Winter concert");
    expect(child).not.toContain("Founders");
  });
});

describe("the Events section and tab, as the server builds them", () => {
  const tables = (extra: Record<string, unknown[]> = {}) => ({
    attendees: [{ rsvp_id: "r1", status: "confirmed", checked_in_at: null, person_id: "p-samira", center_id: "center-1", created_at: "2026-10-01T00:00:00Z" }],
    rsvps: [{ id: "r1", center_id: "center-1", household_id: "hh-hassan", event_id: "e1", status: "confirmed", source: "admin", created_at: "2026-10-01T00:00:00Z" }],
    events: [{ id: "e1", center_id: "center-1", name: "Spring Picnic", starts_at: "2026-10-18T17:00:00Z" }],
    role_grants: [],
    ...extra,
  });
  const session = (permissions: string[], over: { modulesOff?: string[]; tables?: Record<string, unknown[]> } = {}) =>
    fakeSession({ permissions, modulesOff: over.modulesOff ?? [], db: fakeDb({ tables: (over.tables ?? tables()) as never }) });
  const section = async (s = session(["events.view", "events.manage"])) =>
    renderToStaticMarkup(await PersonEventsServer({ session: s, person: { id: "p-samira", firstName: "Samira" }, model }));

  it("lists the person's tickets and offers the control to an event manager", async () => {
    const html = await section();
    expect(html).toContain("Spring Picnic");
    expect(html).toContain("Confirmed");
    expect(html).toContain("Add to an event");
    expect(html).not.toContain("Adding someone to an event needs");
  });

  it("offers the control to an event's lead too", async () => {
    const lead = session(["events.view"], { tables: tables({ role_grants: [{ center_id: "center-1", user_id: "user-1", role_key: "event_lead", scope_kind: "event", scope_id: "e1", starts_at: "2026-01-01T00:00:00Z", ends_at: null }] }) });
    expect(await section(lead)).toContain(">Add to an event<");
  });

  it("says a role that can read events but not change them may only look", async () => {
    const html = await section(session(["events.view"]));
    expect(html).toContain("Spring Picnic");
    expect(html).toContain("Adding someone to an event needs the event manager role");
    expect(html).not.toContain(">Add to an event<");
  });

  it("says 'You don't have access to this area' to a role that cannot read events, never an empty list", async () => {
    const html = await section(session(["people.view"]));
    expect(html).toContain("You don&#x27;t have access to this area");
    expect(html).not.toContain("not on the list for any event");
    expect(html).not.toContain("Spring Picnic");
  });

  it("says a read that failed, in words", async () => {
    const html = await section(fakeSession({ permissions: ["events.view", "events.manage"], db: fakeDb({ tables: tables() as never, failTables: { attendees: { message: "fetch failed" } } }) }));
    expect(html).toContain("Could not load this person&#x27;s event tickets");
    expect(html).not.toContain("not on the list for any event");
  });

  it("puts the control above the Family page's Events table, and the sentence for a role that may only look", async () => {
    const s = session(["events.view", "events.manage"]);
    const add = { kind: "add" as const, props };
    const withControl = renderToStaticMarkup(await EventsTab({ session: s, householdId: "hh-hassan", add }));
    expect(withControl.indexOf("Add to an event")).toBeGreaterThan(-1);
    expect(withControl.indexOf("Add to an event")).toBeLessThan(withControl.indexOf("Spring Picnic"));
    const look = renderToStaticMarkup(await EventsTab({ session: s, householdId: "hh-hassan", add: { kind: "view-only" } }));
    expect(look).toContain("Adding someone to an event needs the event manager role");
    // Without the argument the tab is what it always was.
    const plain = renderToStaticMarkup(await EventsTab({ session: s, householdId: "hh-hassan" }));
    expect(plain).not.toContain("Add to an event");
    expect(plain).toContain("Spring Picnic");
  });

  it("keeps the control above an empty table too", async () => {
    const s = session(["events.view", "events.manage"], { tables: { rsvps: [], events: [], attendees: [], role_grants: [] } });
    const html = renderToStaticMarkup(await EventsTab({ session: s, householdId: "hh-hassan", add: { kind: "add", props } }));
    expect(html).toContain("No RSVPs from this household");
    expect(html).toContain("Add to an event");
  });
});
