// The Family page's Events tab, as rows. Pure: the loader hands in what the database returned for one household and this decides what the
// tab says. Read-only. A party is counted, never named: the seats of an RSVP can include children, and nothing here needs their names.

import { CONTACT_SOURCE_LABEL, isUnverifiedContactRsvp } from "@/lib/rsvp-contact";

export const RSVP_STATUSES = ["invited", "rsvpd", "confirmed", "cancelled", "waitlisted", "no_show", "attended"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

/** The tones of the shared Badge, without importing the component (this file stays free of UI). */
export type AnswerTone = "neutral" | "navy" | "success" | "warning" | "danger";

const ANSWERS: Record<RsvpStatus, { label: string; tone: AnswerTone }> = {
  invited: { label: "Invited", tone: "neutral" },
  rsvpd: { label: "RSVP'd", tone: "navy" },
  confirmed: { label: "Confirmed", tone: "success" },
  attended: { label: "Came", tone: "success" },
  waitlisted: { label: "On the waitlist", tone: "warning" },
  no_show: { label: "Did not come", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const SOURCES: Record<string, string> = {
  app: "Member app",
  guest_web: "Guest page",
  admin: "Entered by staff",
  walk_in: "Walk-in",
  kiosk: "Kiosk",
  import: "Imported",
  guest_contact: CONTACT_SOURCE_LABEL,
};

/** `contact_verified_at` is read for RSVPs made without signing in (source guest_contact): empty means nobody has proved the phone or email yet. */
export type RsvpInput = { id: string; event_id: string; status: string; source: string | null; created_at: string; contact_verified_at?: string | null };
export type EventInput = { id: string; name: string; starts_at: string | null };
export type AttendeeInput = { rsvp_id: string; status: string; checked_in_at: string | null };

export type EventLine = {
  rsvpId: string;
  eventId: string;
  /** The event's name, or a plain sentence when the viewer's role cannot read that event. */
  eventName: string;
  /** False when the event row is not visible to the viewer (the RSVP is). */
  eventVisible: boolean;
  startsAt: string | null;
  status: string;
  answer: string;
  tone: AnswerTone;
  /** Seats on this RSVP that are still held (a cancelled seat is not counted). */
  party: number;
  /** How many of those seats were checked in at the door. */
  checkedIn: number;
  source: string | null;
  /** Made without signing in and not yet checked with the family (docs/RSVP_WITHOUT_LOGIN.md): staff should not trust it as much as one made in the app. */
  unverified: boolean;
};

export const EVENT_NOT_VISIBLE = "An event your role cannot open";

/** The words and tone for any status, including one the database may add later: the words from the key, never a blank. */
function answerFor(status: string): { label: string; tone: AnswerTone } {
  const known = ANSWERS[status as RsvpStatus];
  if (known) return known;
  const words = status.replace(/_/g, " ").trim();
  return { label: words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown", tone: "neutral" };
}

/** One line per RSVP, the latest event first; an event with no date goes last. */
export function buildEventLines(rsvps: readonly RsvpInput[], events: readonly EventInput[], attendees: readonly AttendeeInput[]): EventLine[] {
  const eventById = new Map(events.map((e) => [e.id, e]));
  const party = new Map<string, { seats: number; checkedIn: number }>();
  for (const a of attendees) {
    if (a.status === "cancelled") continue;
    const p = party.get(a.rsvp_id) ?? { seats: 0, checkedIn: 0 };
    p.seats += 1;
    if (a.checked_in_at) p.checkedIn += 1;
    party.set(a.rsvp_id, p);
  }
  const lines = rsvps.map<EventLine>((r) => {
    const event = eventById.get(r.event_id);
    const seats = party.get(r.id);
    const { label, tone } = answerFor(r.status);
    return {
      rsvpId: r.id,
      eventId: r.event_id,
      eventName: event ? event.name : EVENT_NOT_VISIBLE,
      eventVisible: !!event,
      startsAt: event?.starts_at ?? null,
      status: r.status,
      answer: label,
      tone,
      party: seats?.seats ?? 0,
      checkedIn: seats?.checkedIn ?? 0,
      source: r.source ? (SOURCES[r.source] ?? r.source.replace(/_/g, " ")) : null,
      unverified: isUnverifiedContactRsvp(r),
    };
  });
  return lines.sort((a, b) => {
    if (a.startsAt && b.startsAt && a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? 1 : -1;
    if (!!a.startsAt !== !!b.startsAt) return a.startsAt ? -1 : 1;
    return a.rsvpId < b.rsvpId ? -1 : 1;
  });
}

/** "9 RSVPs · came to 6": the line over the table. A household counts as having come when the RSVP says so or a seat was checked in. */
export function eventsSummary(lines: readonly EventLine[]): { total: number; came: number; text: string } {
  const total = lines.length;
  const came = lines.filter((l) => l.status === "attended" || l.checkedIn > 0).length;
  if (total === 0) return { total, came, text: "" };
  return { total, came, text: `${total} RSVP${total === 1 ? "" : "s"} · came to ${came}` };
}
