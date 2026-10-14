import "server-only";

import { chunk } from "@/lib/data/fetch-all";
import { explainError } from "@/lib/errors";
import type { CrmSession } from "@/lib/session";

import { part, type Part } from "./slideover";
import { personEventLines, type PersonEvents } from "./person-events";

/** How many of a person's latest tickets the section reads. One more is asked for, to know whether older ones were left out. */
export const PERSON_EVENTS_LIMIT = 50;

const failed = (what: string, error: unknown): Part<never> => {
  console.error(`[person-events] ${what}:`, error);
  return part.error(`Could not load ${what}: ${explainError(error)}`);
};

/**
 * The events one person holds (or held) a ticket for, as the signed-in person: the tickets, the family RSVPs they sit on and the
 * events, three reads. A read that fails says so with its own sentence (never an empty list in its place). Read only.
 */
export async function loadPersonEvents(session: Pick<CrmSession, "db" | "center">, personId: string): Promise<Part<PersonEvents>> {
  const { db, center } = session;
  const seatRes = await db
    .from("attendees")
    .select("rsvp_id, status, checked_in_at")
    .eq("center_id", center.id)
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(PERSON_EVENTS_LIMIT + 1);
  if (seatRes.error) return failed("this person's event tickets", seatRes.error);
  const allSeats = seatRes.data ?? [];
  const olderLeftOut = allSeats.length > PERSON_EVENTS_LIMIT;
  const seats = allSeats.slice(0, PERSON_EVENTS_LIMIT);
  if (seats.length === 0) return part.ok({ lines: [], olderLeftOut: false });

  const rsvps = [];
  for (const ids of chunk([...new Set(seats.map((s) => s.rsvp_id))])) {
    const res = await db.from("rsvps").select("id, event_id, status, source, created_at").eq("center_id", center.id).in("id", ids);
    if (res.error) return failed("the RSVPs these tickets are on", res.error);
    rsvps.push(...(res.data ?? []));
  }
  const events = [];
  for (const ids of chunk([...new Set(rsvps.map((r) => r.event_id))])) {
    const res = await db.from("events").select("id, name, starts_at").in("id", ids);
    if (res.error) return failed("the events these tickets are for", res.error);
    events.push(...(res.data ?? []));
  }
  return part.ok({ lines: personEventLines(rsvps, events, seats), olderLeftOut });
}
