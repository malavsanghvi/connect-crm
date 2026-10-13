// The pure core of "Add to an event": putting a person (and, if staff choose, the rest of their family) on an event's RSVP from the
// People area. No server imports and no React: the loader and the Server Action (event-add-server.ts) read and write the database, the
// panel (components/people-v2/events/add-to-event.tsx) draws, and the tests need no database.
//
// What this module decides, in one place, so the screen and the server give the same answer:
//   - which events can be offered (upcoming, not a draft, not cancelled, not over) and the plain note when RSVPs are closed or not open
//   - who can be chosen (a family's living people; anyone already on that event's RSVP is shown as such, never added twice)
//   - the two flags an attendee carries, from the birth date and the event's date (never guessed: no birth date, no flag)
//   - the seat answer, the SAME rule the member app's RSVP uses (app.submit_rsvp, migrations 0018 and 0104): a new RSVP that does not fit
//     goes on the waitlist when the event has one and is refused when it does not
//   - what happens to the RSVP: reuse the family's existing one, or create it; and the sentences, before and after
//
// Built for every organization: nothing here names a community or a tradition. Money is untouched: an RSVP made here has no pledge and
// commitment mode "none".

import { ageOn } from "@/lib/dates";
import { eventAreas, hasRoleAnywhere, type EventAccess } from "@/lib/events/access";

// ---------------------------------------------------------------------------
// Who may
// ---------------------------------------------------------------------------
/**
 * The gate for adding people to an event is the one that already guards editing it (eventAreas.edit): event managers, and the event's
 * lead for that event. This is "may they add to any event at all" (to offer the control); each event is checked on its own too.
 * Convenience only: row level security in the database is the enforcement.
 */
export const mayAddToAnyEvent = (a: EventAccess): boolean => eventAreas.manage(a) || hasRoleAnywhere(a, "event_lead");
export const mayAddToEvent = (a: EventAccess, eventId: string): boolean => eventAreas.edit(a, eventId);

// ---------------------------------------------------------------------------
// The two flags (as the member app and the door both mean them)
// ---------------------------------------------------------------------------
/** A child under 12 on the day of the event (lunch groups seat them with the first slot). Mirrors the member app's rules.ts. */
export const CHILD_FLAG_AGE = 12;
/** A senior is 65 or older on the day of the event. */
export const SENIOR_FLAG_AGE = 65;

export type AttendeeFlags = { is_child_under_12: boolean; is_senior: boolean };

/**
 * The attendee flags for a person on the day of an event (YYYY-MM-DD in the community's time zone). No birth date, or no event date,
 * means neither flag: nothing is guessed, and staff can set the flags on the event's own screen.
 */
export function attendeeFlags(dateOfBirth: string | null | undefined, eventDate: string | null | undefined): AttendeeFlags {
  const age = eventDate ? ageOn(dateOfBirth, eventDate) : null;
  return { is_child_under_12: age !== null && age < CHILD_FLAG_AGE, is_senior: age !== null && age >= SENIOR_FLAG_AGE };
}

// ---------------------------------------------------------------------------
// Events that can be offered
// ---------------------------------------------------------------------------
export type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  capacity: number | null;
  waitlist_enabled: boolean;
  audience: string | null;
  rsvp_opens_at: string | null;
  rsvp_closes_at: string | null;
};

/** Staff can add people to an event that is published, has its RSVPs closed, or is under way. A draft, a finished or a cancelled one is not offered. */
export const ADDABLE_STATUSES = ["published", "rsvp_closed", "live"] as const;

const SIX_HOURS_MS = 6 * 3600 * 1000;

/** The event has not finished: it ends in the future, or (with no end time) started less than six hours ago, as the member app reads it. */
export function isUpcoming(e: Pick<EventRow, "starts_at" | "ends_at">, now: Date): boolean {
  if (!e.starts_at) return false;
  const end = e.ends_at ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + SIX_HOURS_MS;
  return Number.isFinite(end) && end >= now.getTime();
}

/** Events with a date that are upcoming and in a status staff can add to, soonest first. */
export function addableEvents<E extends EventRow>(rows: readonly E[], now: Date): E[] {
  return rows
    .filter((e) => (ADDABLE_STATUSES as readonly string[]).includes(e.status) && isUpcoming(e, now))
    .sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? "") || a.name.localeCompare(b.name));
}

/** A plain note under an event when members cannot RSVP right now but staff still can. Null when RSVPs are open. */
export function windowNote(e: Pick<EventRow, "status" | "rsvp_opens_at" | "rsvp_closes_at">, now: Date): string | null {
  if (e.status === "rsvp_closed" || (e.rsvp_closes_at && Date.parse(e.rsvp_closes_at) < now.getTime())) return "RSVPs are closed. You can still add a family by hand.";
  if (e.rsvp_opens_at && Date.parse(e.rsvp_opens_at) > now.getTime()) return "RSVPs have not opened yet. You can still add a family by hand.";
  return null;
}

const AUDIENCE_WORDS: Record<string, string> = {
  members_only: "For members",
  life_members_only: "For life members",
  pathshala_families: "For families enrolled in classes",
};

/** Who the event is meant for, when it is not open to everyone. Staff are not stopped by it (as when they add a guest). */
export function audienceNote(audience: string | null | undefined): string | null {
  return audience ? (AUDIENCE_WORDS[audience] ?? null) : null;
}

/** What the panel needs to know about one offered event (all serializable: it crosses from the server to the browser). */
export type EventChoice = {
  id: string;
  name: string;
  /** An instant (ISO); the panel shows it in the community's time zone. */
  startsAt: string;
  capacity: number | null;
  waitlist: boolean;
  /** Seats taken, by the rule below (null: the event has no limit, or the count could not be read: see `problem`). */
  seatsTaken: number | null;
  audience: string | null;
  note: string | null;
  /** This family's RSVP for the event, when it has a live one (not cancelled), and the people on it. */
  existing: { rsvpId: string; status: string; personIds: string[] } | null;
  /** Set when the event cannot be offered right now, in words (the seat count could not be read). */
  problem: string | null;
};

// ---------------------------------------------------------------------------
// Who can be chosen
// ---------------------------------------------------------------------------
export type FamilyMember = { id: string; name: string; firstName: string; isChild: boolean; age: number | null; deceased: boolean };
export type PersonChoice = FamilyMember & { state: "free" | "on_it" | "deceased" };

/** Everyone in the family with what can be done with them for this event: chosen, already on its RSVP, or not selectable (in memory). */
export function personChoices(members: readonly FamilyMember[], onIt: ReadonlySet<string> | readonly string[]): PersonChoice[] {
  const set = onIt instanceof Set ? onIt : new Set(onIt as readonly string[]);
  return members.map((m) => ({ ...m, state: m.deceased ? "deceased" : set.has(m.id) ? "on_it" : "free" }));
}

/** Who is ticked when the panel opens: the person it was opened from, if they can be added; otherwise nobody. */
export function defaultChosen(choices: readonly PersonChoice[], openedFrom: string | null): string[] {
  return choices.filter((c) => c.id === openedFrom && c.state === "free").map((c) => c.id);
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------
/** "Samira", "Samira and Layla", "Samira, Layla and Omar". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The names to say: first names, unless two people share one (then their full names, so the sentence is never ambiguous). */
export function sayNames(people: readonly Pick<FamilyMember, "name" | "firstName">[]): string {
  const counts = new Map<string, number>();
  for (const p of people) counts.set(p.firstName, (counts.get(p.firstName) ?? 0) + 1);
  return joinNames(people.map((p) => ((counts.get(p.firstName) ?? 0) > 1 ? p.name : p.firstName)));
}

const was = (n: number) => (n === 1 ? "is" : "are");
const placesWord = (n: number) => (n === 1 ? "person" : "people");

// ---------------------------------------------------------------------------
// Seats (the member app's rule: app.submit_rsvp)
// ---------------------------------------------------------------------------
export type SeatCheck =
  | { kind: "open"; left: number | null }
  /** The new RSVP does not fit and the event has a waitlist: it goes on the waitlist. */
  | { kind: "waitlist"; left: number }
  /** It does not fit and cannot wait: refused. */
  | { kind: "full"; left: number }
  /** There is a limit but the count could not be read. */
  | { kind: "unknown" };

/**
 * Does `adding` more people fit? The member app's rule: seats taken are the people on RSVPs that are not cancelled or waitlisted; a new
 * RSVP that would go over the limit is waitlisted when the event has a waitlist and refused when it does not. Adding to an RSVP that
 * is already on the waitlist takes no seat. Adding to a live RSVP that would go over the limit is refused even with a waitlist: one
 * RSVP cannot be partly waitlisted.
 */
export function seatCheck(o: { capacity: number | null; waitlist: boolean; seatsTaken: number | null; adding: number; existing: "none" | "live" | "waitlisted" }): SeatCheck {
  if (o.capacity === null) return { kind: "open", left: null };
  if (o.seatsTaken === null) return { kind: "unknown" };
  const left = Math.max(0, o.capacity - o.seatsTaken);
  if (o.existing === "waitlisted") return { kind: "waitlist", left };
  if (o.adding <= left) return { kind: "open", left };
  return o.existing === "none" && o.waitlist ? { kind: "waitlist", left } : { kind: "full", left };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------
export type Candidate = Pick<FamilyMember, "id" | "name" | "firstName" | "isChild">;
export type RsvpWord = "rsvpd" | "confirmed" | "waitlisted";

/** The status an attendee takes from the RSVP they are on (the same sync app.event_set_rsvp_status keeps). */
export function attendeeStatusFor(rsvpStatus: string): RsvpWord {
  return rsvpStatus === "confirmed" ? "confirmed" : rsvpStatus === "waitlisted" ? "waitlisted" : "rsvpd";
}

export type AddPlan =
  | { kind: "refuse"; why: "nobody" | "full" | "unknown"; text: string }
  /** Everyone chosen is already on it: nothing to write. */
  | { kind: "unchanged"; already: Candidate[]; text: string }
  | {
      kind: "add";
      /** create: a new RSVP for the family. extend: the family's live RSVP gets more people. */
      mode: "create" | "extend";
      rsvpStatus: RsvpWord;
      attendeeStatus: RsvpWord;
      toAdd: Candidate[];
      already: Candidate[];
      waitlisted: boolean;
      /** Things to know before pressing the button, in words. */
      notes: string[];
    };

export type PlanInput = {
  eventName: string;
  capacity: number | null;
  waitlist: boolean;
  /** People already on RSVPs that count (see seatCheck); null when the event has no limit. */
  seatsTaken: number | null;
  /** The family's live RSVP for this event, or null. */
  existingStatus: string | null;
  /** People with a live ticket on that RSVP. */
  onIt: ReadonlySet<string> | readonly string[];
  chosen: readonly Candidate[];
  /** The family already said yes: a NEW RSVP is made "confirmed" rather than "RSVP'd". */
  confirmed: boolean;
};

export function planAdd(i: PlanInput): AddPlan {
  if (i.chosen.length === 0) return { kind: "refuse", why: "nobody", text: "Choose at least one person." };
  const onIt = i.onIt instanceof Set ? i.onIt : new Set(i.onIt as readonly string[]);
  const already = i.chosen.filter((c) => onIt.has(c.id));
  const toAdd = i.chosen.filter((c) => !onIt.has(c.id));
  if (toAdd.length === 0) {
    return { kind: "unchanged", already, text: `${sayNames(already)} ${was(already.length)} already on ${i.eventName}. Nothing was changed.` };
  }
  const existing = i.existingStatus === null ? "none" : i.existingStatus === "waitlisted" ? "waitlisted" : "live";
  const seats = seatCheck({ capacity: i.capacity, waitlist: i.waitlist, seatsTaken: i.seatsTaken, adding: toAdd.length, existing });
  if (seats.kind === "unknown") {
    return { kind: "refuse", why: "unknown", text: `Could not check how many places are left on ${i.eventName}, so nobody was added. Try again.` };
  }
  if (seats.kind === "full") {
    const lead =
      seats.left === 0
        ? `${i.eventName} is full: all ${i.capacity} places are taken.`
        : `${i.eventName} has room for ${seats.left} more ${placesWord(seats.left)}, and ${toAdd.length} ${toAdd.length === 1 ? "was" : "were"} chosen.`;
    const why =
      existing === "live" && i.waitlist
        ? " The family already has an RSVP, so the extra people cannot go on the waitlist. Choose fewer people, or ask an event manager to raise the limit."
        : i.waitlist
          ? " Choose fewer people, or ask an event manager to raise the limit."
          : " Choose fewer people, or ask an event manager to raise the limit or turn on the waitlist.";
    return { kind: "refuse", why: "full", text: lead + why };
  }

  const waitlisted = seats.kind === "waitlist";
  const mode = existing === "none" ? "create" : "extend";
  const rsvpStatus: RsvpWord = mode === "create" ? (waitlisted ? "waitlisted" : i.confirmed ? "confirmed" : "rsvpd") : attendeeStatusFor(i.existingStatus ?? "rsvpd");
  const notes: string[] = [];
  const who = sayNames(toAdd);
  if (mode === "extend") notes.push(`The family already has an RSVP for ${i.eventName}, so ${who} will be added to it.`);
  if (waitlisted) {
    notes.push(
      mode === "extend"
        ? "That RSVP is on the waitlist, so they will wait too."
        : `${i.eventName} is full, so ${who} will go on the waitlist${seats.left > 0 ? ` (there is room for ${seats.left}, and ${toAdd.length} were chosen)` : ""}.`,
    );
  }
  if (already.length > 0) notes.push(`${sayNames(already)} ${was(already.length)} already on it.`);
  return { kind: "add", mode, rsvpStatus, attendeeStatus: attendeeStatusFor(rsvpStatus), toAdd, already, waitlisted, notes };
}

/** The one inline question before anything is written: "Add Samira and Layla to Spring Picnic?" */
export function confirmQuestion(toAdd: readonly Candidate[], eventName: string): string {
  return `Add ${sayNames(toAdd)} to ${eventName}?`;
}

export const CONFIRM_YES = "Yes, add them";

/** What is said after it worked: the sentence for the panel, and a shorter one for the toast. */
export function doneSentences(plan: Extract<AddPlan, { kind: "add" }>, eventName: string): { message: string; toast: string } {
  const who = sayNames(plan.toAdd);
  const also = plan.already.length > 0 ? ` ${sayNames(plan.already)} ${was(plan.already.length)} already on it.` : "";
  if (plan.mode === "extend") {
    const where = plan.waitlisted ? "the family's RSVP on the waitlist" : "the family's RSVP";
    return { message: `Added ${who} to ${eventName}, on ${where}.${also}`, toast: `Added ${who} to ${eventName}.` };
  }
  if (plan.waitlisted) return { message: `${who} ${was(plan.toAdd.length)} on the waitlist for ${eventName}.`, toast: `${who} on the waitlist for ${eventName}.` };
  return {
    message: `${who} ${was(plan.toAdd.length)} on ${eventName}${plan.rsvpStatus === "confirmed" ? ", confirmed" : ""}.${also}`,
    toast: `Added ${who} to ${eventName}.`,
  };
}

// ---------------------------------------------------------------------------
// What the panel is given, and what crosses between it and the server
// ---------------------------------------------------------------------------
export type AddLoad =
  | { ok: true; events: EventChoice[] }
  | { ok: false; kind: "access" | "other"; error: string };

export type AddResult =
  | {
      ok: true;
      outcome: "created" | "extended" | "unchanged";
      status: RsvpWord;
      waitlisted: boolean;
      message: string;
      toast: string;
      /** The people now on the event because of this, and those who already were. */
      added: string[];
      already: string[];
      rsvpId: string;
    }
  | {
      ok: false;
      /** access: the role may not; full: no room; busy: another add for the same family and event is under way; other: try again. */
      kind: "access" | "full" | "busy" | "other";
      error: string;
      /** Some of the people were added before something failed: the screen refreshes so it shows what is there. */
      partial?: boolean;
    };

/** What to say when the role may see events but not change them. */
/** What the panel is given by the page: the family (as its card line, never a name alone), its people, and where it was opened from. */
export type AddToEventProps = {
  householdId: string;
  /** The family's card line in parts (name, number, the organization's id, adults, place). */
  cardLine: string[];
  /** Everyone in the family, adults first. */
  people: FamilyMember[];
  /** The person it was opened from (ticked first); null on the family's tab. */
  openedFrom: string | null;
  timeZone: string;
};

/** Whether and how a page offers the control: with the panel, as a note that this role may only look, because the person is in no family, or not at all. */
export type AddSetup = { kind: "add"; props: AddToEventProps } | { kind: "view-only" } | { kind: "no-family" } | { kind: "none" };

export const NO_FAMILY_NOTE = "Not in a family yet, so they cannot be added to an event from here. Add them to a family first.";

export const VIEW_ONLY_NOTE = "Adding someone to an event needs the event manager role, or being that event's lead.";
