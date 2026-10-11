// An event in numbers, read from app.event_summary (migration 0653) and put into a shape the screens and Niva can use. Pure.
// Counts only: nothing here has a name, and the counts of children, seniors and people needing help are totals (D2).

export type EventSummary = {
  event: { id: string; name: string; status: string; starts_at: string | null; capacity: number | null; waitlist_enabled: boolean; lunch_enabled: boolean; is_paid: boolean };
  /** RSVPs (households) by status: rsvpd, confirmed, cancelled, waitlisted, no_show, attended, invited. */
  households: Record<string, number>;
  households_total: number;
  walk_in_households: number;
  people: {
    rsvpd: number;
    confirmed: number;
    waitlisted: number;
    walk_ins: number;
    not_arrived: number;
    checked_in: number;
    served: number;
    gifts_given: number;
    children_under_12: number;
    seniors: number;
    needs_assistance: number;
  };
  lunch: { enabled: boolean; slots: number; slots_done: number; seats: number; unlimited_slots: number; assigned: number; served: number };
  /** `visible` is false when the person's role cannot see who is assigned; assigned, shifts_empty and shifts_open are then null. */
  volunteers: { visible: boolean; shifts: number; spots_needed: number; assigned: number | null; shifts_empty: number | null; shifts_open: number | null };
  checklist: { total: number; done: number; in_progress: number; not_started: number; overdue: number };
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The database's answer as an EventSummary, or null when it is not one (the caller says so, it never guesses). */
export function parseEventSummary(raw: unknown): EventSummary | null {
  if (!isObj(raw) || !isObj(raw.event) || typeof raw.event.id !== "string") return null;
  const e = raw.event;
  const p = isObj(raw.people) ? raw.people : {};
  const l = isObj(raw.lunch) ? raw.lunch : {};
  const v = isObj(raw.volunteers) ? raw.volunteers : {};
  const c = isObj(raw.checklist) ? raw.checklist : {};
  const households: Record<string, number> = {};
  if (isObj(raw.households)) for (const [k, n] of Object.entries(raw.households)) households[k] = num(n);
  return {
    event: {
      id: e.id as string,
      name: typeof e.name === "string" ? e.name : "",
      status: typeof e.status === "string" ? e.status : "",
      starts_at: typeof e.starts_at === "string" ? e.starts_at : null,
      capacity: numOrNull(e.capacity),
      waitlist_enabled: e.waitlist_enabled === true,
      lunch_enabled: e.lunch_enabled === true,
      is_paid: e.is_paid === true,
    },
    households,
    households_total: num(p.households_total),
    walk_in_households: num(p.walk_in_households),
    people: {
      rsvpd: num(p.people_rsvpd),
      confirmed: num(p.people_confirmed),
      waitlisted: num(p.people_waitlisted),
      walk_ins: num(p.walk_in_people),
      not_arrived: num(p.not_arrived),
      checked_in: num(p.checked_in),
      served: num(p.served),
      gifts_given: num(p.gifts_given),
      children_under_12: num(p.children_under_12),
      seniors: num(p.seniors),
      needs_assistance: num(p.needs_assistance),
    },
    lunch: {
      enabled: l.enabled === true,
      slots: num(l.slots),
      slots_done: num(l.slots_done),
      seats: num(l.seats),
      unlimited_slots: num(l.unlimited_slots),
      assigned: num(l.assigned),
      served: num(l.served),
    },
    volunteers: {
      visible: v.visible === true,
      shifts: num(v.shifts),
      spots_needed: num(v.spots_needed),
      assigned: numOrNull(v.assigned),
      shifts_empty: numOrNull(v.shifts_empty),
      shifts_open: numOrNull(v.shifts_open),
    },
    checklist: { total: num(c.total), done: num(c.done), in_progress: num(c.in_progress), not_started: num(c.not_started), overdue: num(c.overdue) },
  };
}

/** Places left under the capacity (RSVP'd people count against it), or null when there is no limit. */
export function placesLeft(s: Pick<EventSummary, "event" | "people">): number | null {
  return s.event.capacity === null ? null : Math.max(0, s.event.capacity - s.people.rsvpd);
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The numbers as short plain sentences, the way Niva would say them. */
export function summarySentences(s: EventSummary): string[] {
  const out: string[] = [];
  const left = placesLeft(s);
  const cap = s.event.capacity === null ? "no capacity limit" : `${s.event.capacity} places${left === null ? "" : `, ${left} left`}`;
  out.push(`${n(s.people.rsvpd, "person", "people")} ${s.people.rsvpd === 1 ? "has" : "have"} RSVP'd (${s.people.confirmed} confirmed); ${cap}.`);
  if (s.people.waitlisted > 0) out.push(`${n(s.people.waitlisted, "person", "people")} on the waitlist.`);
  if (s.people.children_under_12 + s.people.seniors + s.people.needs_assistance > 0) {
    out.push(`Among them: ${s.people.children_under_12} under 12, ${s.people.seniors} seniors, ${s.people.needs_assistance} needing assistance.`);
  }
  if (s.people.checked_in > 0 || s.event.status === "live") out.push(`${s.people.checked_in} checked in${s.people.walk_ins > 0 ? `, including ${n(s.people.walk_ins, "walk-in")}` : ""}; ${s.people.not_arrived} RSVP'd and not here yet.`);
  if (s.lunch.enabled || s.lunch.slots > 0) {
    const seats = s.lunch.unlimited_slots > 0 ? `${s.lunch.seats} counted seats plus ${n(s.lunch.unlimited_slots, "open slot")}` : `${s.lunch.seats} seats`;
    out.push(`Lunch: ${n(s.lunch.slots, "slot")} (${seats}); ${s.lunch.assigned} seated, ${s.lunch.served} served.`);
  }
  if (s.volunteers.shifts > 0) {
    out.push(
      s.volunteers.visible
        ? `Volunteers: ${n(s.volunteers.shifts, "shift")} needing ${s.volunteers.spots_needed}; ${s.volunteers.assigned ?? 0} assigned, ${n(s.volunteers.shifts_empty ?? 0, "shift")} with nobody.`
        : `Volunteers: ${n(s.volunteers.shifts, "shift")} needing ${s.volunteers.spots_needed}. Your role can't see who is assigned.`,
    );
  }
  if (s.checklist.total > 0) out.push(`Checklist: ${s.checklist.done} of ${s.checklist.total} done${s.checklist.overdue > 0 ? `, ${s.checklist.overdue} overdue` : ""}.`);
  return out;
}
