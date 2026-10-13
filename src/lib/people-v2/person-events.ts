// One person's own RSVPs, for the Events section of the person slide-over: which events they hold a ticket for, the answer, and whether they
// were checked in. Pure; it reuses the Family page's Events lines (buildEventLines) so the two screens say the same words, and only adds
// the person's point of view: a ticket that was cancelled reads "Cancelled" even when the family's RSVP is still on, and a ticket that was
// checked in reads "Came".

import { buildEventLines, type AttendeeInput, type EventInput, type EventLine, type RsvpInput } from "./family-events";

/** What the section shows: the lines, and whether older tickets were left out. */
export type PersonEvents = { lines: EventLine[]; olderLeftOut: boolean };

/** The person's ticket on an RSVP (a row of app.attendees). */
export type PersonSeat = AttendeeInput;

const rank = (s: PersonSeat) => (s.status === "cancelled" ? 0 : 1);

/**
 * One line per RSVP the person holds (or held) a ticket on, the latest event first. When the person has more than one ticket row on the
 * same RSVP (one cancelled, then added again), the live one counts.
 */
export function personEventLines(rsvps: readonly RsvpInput[], events: readonly EventInput[], seats: readonly PersonSeat[]): EventLine[] {
  const mine = new Map<string, PersonSeat>();
  for (const s of seats) {
    const have = mine.get(s.rsvp_id);
    if (!have || rank(s) > rank(have)) mine.set(s.rsvp_id, s);
  }
  const effective = rsvps
    .filter((r) => mine.has(r.id))
    .map<RsvpInput>((r) => {
      const seat = mine.get(r.id)!;
      if (seat.status === "cancelled") return { ...r, status: "cancelled" };
      if (seat.checked_in_at && r.status !== "cancelled") return { ...r, status: "attended" };
      return r;
    });
  return buildEventLines(effective, events, [...mine.values()]);
}

/** "Came" for a ticket that was checked in, otherwise a dash: the section's last column. */
export function cameText(line: Pick<EventLine, "checkedIn">): string {
  return line.checkedIn > 0 ? "Yes" : "—";
}

/** One sentence over the list: "3 RSVPs · came to 2", or nothing to say. */
export function personEventsSummary(lines: readonly EventLine[]): string {
  if (lines.length === 0) return "";
  const came = lines.filter((l) => l.checkedIn > 0).length;
  return `${lines.length} RSVP${lines.length === 1 ? "" : "s"} · came to ${came}`;
}
