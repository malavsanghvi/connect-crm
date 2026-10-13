import "server-only";

import { revalidatePath } from "next/cache";

import { chunk } from "@/lib/data/fetch-all";
import { personName } from "@/lib/data/lookups";
import { dateInTz } from "@/lib/dates";
import { explainError, isStepUpError } from "@/lib/errors";
import { eventAreas, type EventAccess } from "@/lib/events/access";
import { isUuid } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

import {
  ADDABLE_STATUSES,
  addableEvents,
  attendeeFlags,
  audienceNote,
  doneSentences,
  isUpcoming,
  mayAddToAnyEvent,
  planAdd,
  windowNote,
  type AddLoad,
  type AddPlan,
  type AddResult,
  type Candidate,
  type EventChoice,
  type EventRow,
} from "./event-add";
import { NO_ACCESS_TEXT } from "./slideover";

// Adding a family's people to an event from the People area (docs: the Events section of the person slide-over and the Family page's
// Events tab). Everything is read and written as the signed-in person, so row level security stays the final word; the gate in code is
// the one that already guards editing an event (eventAreas.edit: event managers and the event's lead), and a role without it is told
// "You don't have access to this area".
//
// What it writes (nothing else: no pledge, no money, no message, no permission, no migration):
//   - the family's live RSVP for the event is reused when there is one (people are added to it); otherwise a new RSVP is made with the
//     household, source "admin" and commitment mode "none", RSVP'd (or confirmed when staff say the family already said yes)
//   - one attendee per person with their person id, name and the two flags worked out from their birth date and the event's date;
//     the database issues each ticket (trigger attendees_ticket)
// Seats follow the member app's rule (event-add.ts seatCheck). The database does not stop two RSVPs for the same family and event, so
// this guards twice: a second add for the same family and event while one is under way is turned away, and after a new RSVP is made
// the family's live RSVPs are read again; if another one was made first, this one is cancelled and the people join that one.

export type AddContext = {
  session: Pick<CrmSession, "db" | "center" | "userId">;
  access: EventAccess;
  /** Tests give a fixed clock. */
  now?: () => Date;
};

export type AddInput = { householdId: string; eventId: string; personIds: string[]; /** The family already said yes. */ confirmed?: boolean };

const EVENT_COLUMNS = "id, name, starts_at, ends_at, status, capacity, waitlist_enabled, audience, rsvp_opens_at, rsvp_closes_at";
/** Events that began up to this long ago are still looked at (a camp that runs for days is still upcoming until it ends). */
const LOOKBACK_MS = 14 * 24 * 3600 * 1000;
const MAX_PEOPLE = 40;

/** A read or write that failed: what it was doing, and the database's own error (logged, never shown raw). */
class Step extends Error {
  constructor(
    readonly what: string,
    readonly cause: unknown,
  ) {
    super(what);
  }
}

function ok<T>(res: { data: T; error: unknown }, what: string): T {
  if (res.error) throw new Step(what, res.error);
  return res.data;
}

const other = (error: string): Extract<AddResult, { ok: false }> => ({ ok: false, kind: "other", error });

/** A failure in words ("Could not add them to the event — <reason>."); the technical detail is logged on the server, never shown. */
function fail(doing: string, error: unknown, extra: Partial<Extract<AddResult, { ok: false }>> = {}, logAs?: string): Extract<AddResult, { ok: false }> & { stepUp?: boolean } {
  console.error(`[event-add] ${logAs ?? doing}:`, error);
  const reason = explainError(error);
  return { ok: false, kind: "other", error: `${doing} — ${reason}${/[.!?]$/.test(reason) ? "" : "."}`, ...(isStepUpError(error) ? { stepUp: true } : {}), ...extra };
}

/** Two quick clicks, or two staff at once, for the same family and event: the second waits. (This process only; see the race check.) */
const inFlight = new Set<string>();

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------
type RsvpRow = { id: string; event_id: string; status: string; created_at: string };

/** The family's live (not cancelled) RSVPs for these events, the earliest first per event. */
async function liveRsvps(db: AddContext["session"]["db"], centerId: string, householdId: string, eventIds: string[]): Promise<RsvpRow[]> {
  const out: RsvpRow[] = [];
  for (const part of chunk(eventIds)) {
    const rows = ok(
      await db.from("rsvps").select("id, event_id, status, created_at").eq("center_id", centerId).eq("household_id", householdId).in("event_id", part).neq("status", "cancelled"),
      "read the family's RSVPs",
    );
    out.push(...(rows ?? []));
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

type SeatRow = { id: string; rsvp_id: string; person_id: string | null; status: string; checked_in_at: string | null };

async function seatsOf(db: AddContext["session"]["db"], rsvpIds: string[]): Promise<SeatRow[]> {
  const out: SeatRow[] = [];
  for (const part of chunk(rsvpIds)) {
    const rows = ok(await db.from("attendees").select("id, rsvp_id, person_id, status, checked_in_at").in("rsvp_id", part), "read the people on the RSVP");
    out.push(...(rows ?? []));
  }
  return out;
}

/**
 * Places taken on an event, by the member app's rule: people on RSVPs that are not cancelled or waitlisted, a released ticket not
 * counted, walk-ins counted. It is the Events workspace's own count (app.event_summary, migration 0653). Null when it cannot be read.
 */
async function placesTaken(db: AddContext["session"]["db"], eventId: string): Promise<number | null> {
  const res = await db.rpc("event_summary", { p_event: eventId });
  if (res.error || !res.data || typeof res.data !== "object") {
    console.error("[event-add] could not count the places taken; the event is not offered until it can be:", res.error);
    return null;
  }
  const people = (res.data as { people?: { people_rsvpd?: unknown; walk_in_people?: unknown } }).people;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return n(people?.people_rsvpd) + n(people?.walk_in_people);
}

const MERGED = "This family was merged into another one. Open that family to add people to an event.";

async function householdProblem(db: AddContext["session"]["db"], centerId: string, householdId: string, doing: string): Promise<string | null> {
  const hh = ok(await db.from("households").select("id, merged_into_id").eq("id", householdId).eq("center_id", centerId).maybeSingle(), "read the family");
  if (!hh) return `${doing} — that family was not found, or you can't see it.`;
  if (hh.merged_into_id) return `${doing} — ${MERGED.charAt(0).toLowerCase()}${MERGED.slice(1)}`;
  return null;
}

// ---------------------------------------------------------------------------
// Reading: the events the person may add to
// ---------------------------------------------------------------------------
/** The upcoming events this role may add people to, with this family's RSVP on each and the places left. */
export async function loadAddChoices(ctx: AddContext, input: { householdId: string }): Promise<AddLoad> {
  if (!mayAddToAnyEvent(ctx.access)) return { ok: false, kind: "access", error: NO_ACCESS_TEXT };
  const doing = "Could not load the events";
  if (!input || !isUuid(input.householdId)) return { ok: false, kind: "other", error: `${doing} — the family was not found.` };
  const { db, center } = ctx.session;
  const now = (ctx.now ?? (() => new Date()))();
  try {
    const problem = await householdProblem(db, center.id, input.householdId, doing);
    if (problem) return { ok: false, kind: "other", error: problem };
    const cutoff = new Date(now.getTime() - LOOKBACK_MS).toISOString();
    const rows = ok(
      await db
        .from("events")
        .select(EVENT_COLUMNS)
        .eq("center_id", center.id)
        .in("status", [...ADDABLE_STATUSES])
        .gte("starts_at", cutoff)
        .order("starts_at", { ascending: true })
        .limit(100),
      "read the events",
    );
    const offered = addableEvents((rows ?? []) as EventRow[], now).filter((e) => eventAreas.edit(ctx.access, e.id));
    if (offered.length === 0) return { ok: true, events: [] };

    const live = await liveRsvps(db, center.id, input.householdId, offered.map((e) => e.id));
    const seats = live.length > 0 ? await seatsOf(db, live.map((r) => r.id)) : [];
    const taken = await Promise.all(offered.map((e) => (e.capacity === null ? Promise.resolve(null) : placesTaken(db, e.id))));

    const events = offered.map<EventChoice>((e, i) => {
      const rsvp = live.find((r) => r.event_id === e.id);
      return {
        id: e.id,
        name: e.name,
        startsAt: e.starts_at as string,
        capacity: e.capacity,
        waitlist: e.waitlist_enabled,
        seatsTaken: taken[i],
        audience: audienceNote(e.audience),
        note: windowNote(e, now),
        existing: rsvp
          ? { rsvpId: rsvp.id, status: rsvp.status, personIds: seats.filter((s) => s.rsvp_id === rsvp.id && s.status !== "cancelled" && s.person_id).map((s) => s.person_id as string) }
          : null,
        problem: e.capacity !== null && taken[i] === null ? "Could not check how many places are left. Try again in a moment." : null,
      };
    });
    return { ok: true, events };
  } catch (error) {
    const f = error instanceof Step ? fail(doing, error.cause, {}, error.what) : fail(doing, error);
    return { ok: false, kind: "other", error: f.error, ...(f.stepUp ? { stepUp: true } : {}) };
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
/** Put these people on the event: reuse the family's RSVP or make one, then add the people. */
export async function addToEvent(ctx: AddContext, input: AddInput): Promise<AddResult> {
  const doing = "Could not add them to the event";
  if (!input || !isUuid(input.householdId) || !isUuid(input.eventId)) return other(`${doing} — the family or the event was not found.`);
  const ids = [...new Set(Array.isArray(input.personIds) ? input.personIds : [])];
  if (ids.length === 0) return other(`${doing} — choose at least one person.`);
  if (ids.length > MAX_PEOPLE || ids.some((id) => !isUuid(id))) return other(`${doing} — the people chosen were not understood.`);
  if (!eventAreas.edit(ctx.access, input.eventId)) return { ok: false, kind: "access", error: NO_ACCESS_TEXT };

  const key = `${ctx.session.center.id}:${input.eventId}:${input.householdId}`;
  if (inFlight.has(key)) {
    return { ok: false, kind: "busy", error: "Adding this family to that event is already under way. Wait a moment, then check the Events list before trying again." };
  }
  inFlight.add(key);
  try {
    return await write(ctx, { ...input, personIds: ids }, doing);
  } catch (error) {
    return error instanceof Step ? fail(doing, error.cause, {}, error.what) : fail(doing, error);
  } finally {
    inFlight.delete(key);
  }
}

type PersonRow = { id: string; first_name: string; last_name: string; preferred_name: string | null; date_of_birth: string | null; is_deceased: boolean | null; merged_into_id: string | null };

async function write(ctx: AddContext, input: AddInput & { personIds: string[] }, doing: string): Promise<AddResult> {
  const { db, center } = ctx.session;
  const now = (ctx.now ?? (() => new Date()))();

  const hhProblem = await householdProblem(db, center.id, input.householdId, doing);
  if (hhProblem) return other(hhProblem);

  const event = ok(await db.from("events").select(EVENT_COLUMNS).eq("id", input.eventId).eq("center_id", center.id).maybeSingle(), "read the event") as EventRow | null;
  if (!event) return other(`${doing} — the event was not found, or you can't see it.`);
  if (!(ADDABLE_STATUSES as readonly string[]).includes(event.status)) {
    return other(`${doing} — ${event.name} is ${event.status.replace(/_/g, " ")}. People can be added to an event that is published, closed for RSVPs or under way.`);
  }
  if (!isUpcoming(event, now)) return other(`${doing} — ${event.name} is over.`);

  // Who: only living, unmerged people who are in this family now. The browser's list is never trusted.
  const members = ok(await db.from("household_members").select("person_id").eq("center_id", center.id).eq("household_id", input.householdId).is("left_at", null), "read the family's members") ?? [];
  const inFamily = new Set(members.map((m) => m.person_id));
  if (input.personIds.some((id) => !inFamily.has(id))) return other(`${doing} — someone you chose is not in this family any more. Reload the page and try again.`);
  const people = (ok(
    await db.from("people").select("id, first_name, last_name, preferred_name, date_of_birth, is_deceased, merged_into_id").eq("center_id", center.id).in("id", input.personIds),
    "read the people",
  ) ?? []) as PersonRow[];
  const byId = new Map(people.map((p) => [p.id, p]));
  if (input.personIds.some((id) => !byId.has(id))) return other(`${doing} — you can't see one of the people you chose.`);
  const chosen = input.personIds.map((id) => byId.get(id) as PersonRow);
  const dead = chosen.find((p) => p.is_deceased === true || p.merged_into_id);
  if (dead) return other(`${doing} — ${personName(dead)} ${dead.is_deceased === true ? "is recorded as deceased" : "was merged into another record"}.`);
  const candidates: Candidate[] = chosen.map((p) => ({ id: p.id, name: personName(p), firstName: p.preferred_name || p.first_name, isChild: false }));

  // The family's live RSVP, if any, and who is on it.
  const live = await liveRsvps(db, center.id, input.householdId, [event.id]);
  const rsvp = live[0] ?? null;
  const seats = rsvp ? await seatsOf(db, [rsvp.id]) : [];
  const onIt = seats.filter((s) => s.status !== "cancelled" && s.person_id).map((s) => s.person_id as string);
  const taken = event.capacity === null ? null : await placesTaken(db, event.id);

  const plan = planAdd({
    eventName: event.name,
    capacity: event.capacity,
    waitlist: event.waitlist_enabled,
    seatsTaken: taken,
    existingStatus: rsvp?.status ?? null,
    onIt,
    chosen: candidates,
    confirmed: input.confirmed === true,
  });
  if (plan.kind === "refuse") return plan.why === "full" ? { ok: false, kind: "full", error: plan.text } : other(plan.text);
  if (plan.kind === "unchanged") {
    return { ok: true, outcome: "unchanged", status: statusWord(rsvp?.status), waitlisted: rsvp?.status === "waitlisted", message: plan.text, toast: plan.text, added: [], already: plan.already.map((c) => c.id), rsvpId: rsvp?.id ?? "" };
  }

  const eventDate = event.starts_at ? dateInTz(event.starts_at, center.time_zone) : null;
  const nowIso = now.toISOString();
  const flagsFor = (id: string) => attendeeFlags(byId.get(id)?.date_of_birth, eventDate);
  const who = (list: readonly Candidate[]) => list.map((c) => c.firstName).join(", ");

  // 1. The RSVP: reuse the family's, or make it.
  let target: { id: string; status: string } | null = rsvp ? { id: rsvp.id, status: rsvp.status } : null;
  let made: string | null = null;
  let mode = plan.mode;
  let toAdd = plan.toAdd;
  let attendeeStatus = plan.attendeeStatus;
  let existingSeats = seats;
  if (!target) {
    const inserted = ok(
      await db
        .from("rsvps")
        .insert({
          center_id: center.id,
          event_id: event.id,
          household_id: input.householdId,
          status: plan.rsvpStatus,
          confirmed_at: plan.rsvpStatus === "confirmed" ? nowIso : null,
          commitment_mode: "none",
          source: "admin",
        })
        .select("id")
        .single(),
      "make the RSVP",
    );
    made = inserted?.id ?? null;
    if (!made) throw new Step("make the RSVP", "the database did not return the new RSVP");
    target = { id: made, status: plan.rsvpStatus };

    // Did another RSVP for this family and event land first (a second click, a second member of staff)? The earliest keeps it.
    const now2 = await liveRsvps(db, center.id, input.householdId, [event.id]);
    const first = now2[0];
    if (first && first.id !== made) {
      const cancelled = await db.from("rsvps").update({ status: "cancelled", cancelled_at: nowIso }).eq("id", made).eq("center_id", center.id);
      if (cancelled.error) console.error("[event-add] could not cancel the duplicate RSVP it made; it has no people on it:", cancelled.error);
      made = null;
      target = { id: first.id, status: first.status };
      mode = "extend";
      attendeeStatus = first.status === "confirmed" ? "confirmed" : first.status === "waitlisted" ? "waitlisted" : "rsvpd";
      existingSeats = await seatsOf(db, [first.id]);
      const there = new Set(existingSeats.filter((s) => s.status !== "cancelled" && s.person_id).map((s) => s.person_id as string));
      toAdd = toAdd.filter((c) => !there.has(c.id));
    }
  }
  const rsvpId = target.id;

  // 2. The people. A person whose earlier ticket on this RSVP was released is given that ticket back (not a second row); the rest are new.
  const back = new Map(existingSeats.filter((s) => s.status === "cancelled" && s.person_id && !s.checked_in_at).map((s) => [s.person_id as string, s.id]));
  const revive = toAdd.filter((c) => back.has(c.id));
  const fresh = toAdd.filter((c) => !back.has(c.id));
  if (fresh.length > 0) {
    const added = await db.from("attendees").insert(
      fresh.map((c) => ({
        center_id: center.id,
        event_id: event.id,
        rsvp_id: rsvpId,
        person_id: c.id,
        display_name: c.name,
        ...flagsFor(c.id),
        status: attendeeStatus,
      })),
    );
    if (added.error) {
      // Nothing was added to the RSVP. If this call made the RSVP, release it so it holds no places.
      let tidy = "Nothing was added.";
      if (made) {
        const undone = await db.from("rsvps").update({ status: "cancelled", cancelled_at: nowIso }).eq("id", made).eq("center_id", center.id);
        if (undone.error) {
          console.error("[event-add] could not cancel the empty RSVP after the people could not be added:", undone.error);
          tidy = "Nothing was added, but an empty RSVP may remain: open the event's RSVPs to remove it.";
        }
      }
      const f = fail(`Could not add ${who(toAdd)} to ${event.name}`, added.error);
      return { ...f, error: `${f.error} ${tidy}` };
    }
  }
  for (const c of revive) {
    const back1 = await db
      .from("attendees")
      .update({ status: attendeeStatus, ticket_revoked: false, ...flagsFor(c.id) })
      .eq("id", back.get(c.id) as string)
      .eq("center_id", center.id);
    if (back1.error) {
      const done = fresh.length + revive.slice(0, revive.indexOf(c)).length;
      const f = fail(`Could not bring back ${c.firstName}'s ticket for ${event.name}`, back1.error, { partial: done > 0 || made !== null });
      return { ...f, error: done > 0 ? `${f.error} Others were added: reload to see who is on it.` : f.error };
    }
  }

  revalidatePath(`/households/${input.householdId}`);
  revalidatePath("/events", "layout");
  revalidatePath("/people", "layout");

  const final: Extract<AddPlan, { kind: "add" }> = { ...plan, mode, toAdd, attendeeStatus, rsvpStatus: attendeeStatus, waitlisted: attendeeStatus === "waitlisted" };
  if (toAdd.length === 0) {
    // Everyone chosen turned out to be on the RSVP that won the race.
    const sentence = `${who(plan.toAdd)} ${plan.toAdd.length === 1 ? "is" : "are"} already on ${event.name}. Nothing was changed.`;
    return { ok: true, outcome: "unchanged", status: attendeeStatus, waitlisted: final.waitlisted, message: sentence, toast: sentence, added: [], already: plan.toAdd.map((c) => c.id), rsvpId };
  }
  const said = doneSentences(final, event.name);
  return {
    ok: true,
    outcome: mode === "create" ? "created" : "extended",
    status: attendeeStatus,
    waitlisted: final.waitlisted,
    message: said.message,
    toast: said.toast,
    added: toAdd.map((c) => c.id),
    already: plan.already.map((c) => c.id),
    rsvpId,
  };
}

function statusWord(status: string | undefined): "rsvpd" | "confirmed" | "waitlisted" {
  return status === "confirmed" ? "confirmed" : status === "waitlisted" ? "waitlisted" : "rsvpd";
}
