// DEV ONLY. Invented events and tickets for the previews of "Add to an event" (the person slide-over's Events section at
// /dev/people-slideover and the Family page's Events tab at /dev/people-family), on the same neutral community. Nothing here is real.
//
// `?events=<state>` picks what the fake server answers:
//   ok (default)  slow     already   full       error      noaccess    loaderror   empty
//   view-only     nofamily off       noread     readerror  (the last five are about the section itself, not the panel)

import type { FamilyActions } from "@/components/people-v2/family/actions";
import { doneSentences, planAdd, type AddSetup, type Candidate, type EventChoice } from "@/lib/people-v2/event-add";
import { addToEventProps } from "@/lib/people-v2/event-add-props";
import { buildEventLines, type EventLine } from "@/lib/people-v2/family-events";
import type { FamilyModel } from "@/lib/people-v2/family-model";
import { personEventLines, type PersonEvents } from "@/lib/people-v2/person-events";
import { NO_ACCESS_TEXT, part, type Part } from "@/lib/people-v2/slideover";

import { familyFixture, type FamilyKey } from "../people-family/fixtures";

export const EVENT_STATES = ["ok", "slow", "already", "full", "error", "noaccess", "loaderror", "empty", "view-only", "nofamily", "off", "noread", "readerror"] as const;
export type EventState = (typeof EVENT_STATES)[number];

export const PREVIEW_TZ = "America/Chicago";

const choice = (o: Partial<EventChoice> & Pick<EventChoice, "id" | "name" | "startsAt">): EventChoice => ({
  capacity: null,
  waitlist: false,
  seatsTaken: null,
  audience: null,
  note: null,
  existing: null,
  problem: null,
  ...o,
});

const primaryOf = (model: FamilyModel) => (model.adults.find((a) => a.isPrimary) ?? model.adults[0]).id;

/** The upcoming events the server would offer this family. */
export function eventChoices(state: EventState, family: FamilyKey): EventChoice[] {
  if (state === "empty") return [];
  const model = familyFixture(family);
  const list = [
    choice({ id: "ev-picnic", name: "Spring Picnic", startsAt: "2026-10-18T17:00:00Z" }),
    choice({ id: "ev-harvest", name: "Harvest Dinner", startsAt: "2026-10-24T23:30:00Z", capacity: 120, waitlist: true, seatsTaken: 96, audience: "For members" }),
    choice({ id: "ev-cleanup", name: "Neighbourhood cleanup · 春の清掃", startsAt: "2026-11-01T15:00:00Z", capacity: 40, waitlist: true, seatsTaken: 40 }),
    choice({ id: "ev-camp", name: "Weekend camp", startsAt: "2026-11-07T14:00:00Z", capacity: 30, waitlist: false, seatsTaken: 29 }),
    choice({ id: "ev-open", name: "Open day", startsAt: "2026-11-14T16:00:00Z", note: "RSVPs are closed. You can still add a family by hand." }),
  ];
  if (state === "already") list[0] = { ...list[0], existing: { rsvpId: "r-existing", status: "confirmed", personIds: [primaryOf(model)] } };
  return list;
}

const candidate = (p: FamilyModel["adults"][number]): Candidate => ({ id: p.id, name: p.name, firstName: p.firstName, isChild: p.isChild });

/** The fake server for the panel: it uses the same plan and the same sentences as the real one, so what is drawn is what would be said. */
export function fakeEventAdd(state: EventState, family: FamilyKey): FamilyActions["eventAdd"] {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const model = familyFixture(family);
  const people = [...model.adults, ...model.children];
  return {
    async load() {
      await wait(450);
      if (state === "noaccess") return { ok: false, kind: "access", error: NO_ACCESS_TEXT };
      if (state === "loaderror") return { ok: false, kind: "other", error: "Could not load the events — the database could not be reached — check the connection and try again." };
      return { ok: true, events: eventChoices(state, family) };
    },
    async add(call) {
      await wait(state === "slow" ? 60000 : 450);
      const event = eventChoices(state, family).find((e) => e.id === call.eventId);
      if (!event) return { ok: false, kind: "other", error: "Could not add them to the event — the event was not found, or you can't see it." };
      if (state === "error") return { ok: false, kind: "other", error: "Could not add them to the event — the database could not be reached — check the connection and try again." };
      if (state === "full") {
        return { ok: false, kind: "full", error: `${event.name} has room for 1 more person, and ${call.personIds.length} were chosen. Choose fewer people, or ask an event manager to raise the limit or turn on the waitlist.` };
      }
      const chosen = call.personIds.map((id) => people.find((p) => p.id === id)).filter((p): p is FamilyModel["adults"][number] => Boolean(p)).map(candidate);
      const plan = planAdd({
        eventName: event.name,
        capacity: event.capacity,
        waitlist: event.waitlist,
        seatsTaken: event.seatsTaken,
        existingStatus: event.existing?.status ?? null,
        onIt: event.existing?.personIds ?? [],
        chosen,
        confirmed: call.confirmed === true,
      });
      if (plan.kind === "refuse") return { ok: false, kind: plan.why === "full" ? "full" : "other", error: plan.text };
      if (plan.kind === "unchanged") {
        return { ok: true, outcome: "unchanged", status: "rsvpd", waitlisted: false, message: plan.text, toast: plan.text, added: [], already: plan.already.map((c) => c.id), rsvpId: "r-existing" };
      }
      const said = doneSentences(plan, event.name);
      return {
        ok: true,
        outcome: plan.mode === "create" ? "created" : "extended",
        status: plan.attendeeStatus,
        waitlisted: plan.waitlisted,
        message: said.message,
        toast: said.toast,
        added: plan.toAdd.map((c) => c.id),
        already: plan.already.map((c) => c.id),
        rsvpId: "r-new",
      };
    },
  };
}

/** What the page gives the section: the control (with the family), or the sentence for why there is none. */
export function addSetup(state: EventState, model: FamilyModel, openedFrom: string | null, standalone: boolean): AddSetup {
  if (state === "view-only") return { kind: "view-only" };
  if (state === "nofamily" || standalone) return { kind: "no-family" };
  return { kind: "add", props: addToEventProps(model, openedFrom, PREVIEW_TZ) };
}

// ---------------------------------------------------------------------------
// This person's own tickets (the section's list) and the family's RSVPs (the Events tab's table)
// ---------------------------------------------------------------------------
const EVENTS = [
  { id: "ev-founders", name: "Founders' Day lunch", starts_at: "2026-05-03T17:00:00Z" },
  { id: "ev-winter", name: "Winter concert", starts_at: "2026-12-06T00:00:00Z" },
  { id: "ev-workday", name: "Garden workday", starts_at: "2026-03-14T15:00:00Z" },
];

const RSVPS = [
  { id: "r-a", event_id: "ev-founders", status: "attended", source: "app", created_at: "2026-04-20T12:00:00Z" },
  { id: "r-b", event_id: "ev-winter", status: "confirmed", source: "admin", created_at: "2026-10-01T12:00:00Z" },
  { id: "r-c", event_id: "ev-workday", status: "rsvpd", source: "app", created_at: "2026-03-01T12:00:00Z" },
];

export function personLines(family: FamilyKey, personId: string): Part<PersonEvents> {
  if (family === "empty") return part.ok({ lines: [], olderLeftOut: false });
  const model = familyFixture(family);
  const child = [...model.adults, ...model.children].find((p) => p.id === personId)?.isChild ?? false;
  const seats = child
    ? [{ rsvp_id: "r-b", status: "confirmed", checked_in_at: null }]
    : [
        { rsvp_id: "r-a", status: "attended", checked_in_at: "2026-05-03T17:20:00Z" },
        { rsvp_id: "r-b", status: "confirmed", checked_in_at: null },
        // Released her own ticket: reads Cancelled for her, whatever the family's RSVP says.
        { rsvp_id: "r-c", status: "cancelled", checked_in_at: null },
      ];
  return part.ok({ lines: personEventLines(RSVPS, EVENTS, seats), olderLeftOut: false });
}

export function readError(): Part<PersonEvents> {
  return part.error("Could not load this person's event tickets: the database could not be reached — check the connection and try again");
}

export function familyLines(): EventLine[] {
  return buildEventLines(
    RSVPS,
    EVENTS,
    [
      { rsvp_id: "r-a", status: "attended", checked_in_at: "2026-05-03T17:20:00Z" },
      { rsvp_id: "r-a", status: "attended", checked_in_at: "2026-05-03T17:21:00Z" },
      { rsvp_id: "r-b", status: "confirmed", checked_in_at: null },
      { rsvp_id: "r-b", status: "confirmed", checked_in_at: null },
      { rsvp_id: "r-b", status: "confirmed", checked_in_at: null },
      { rsvp_id: "r-c", status: "rsvpd", checked_in_at: null },
    ],
  );
}
