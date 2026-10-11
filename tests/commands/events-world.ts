// Test pieces for the Events commands: RSVPs, people on them (children among them), shifts, and the answers of the three read
// functions (migrations 0653 and 0654), added to the community in helpers.ts. Kept apart from helpers.ts so other areas' tests do not
// have to change when this one grows.

import type { FakeDbOptions } from "./helpers";

type Row = Record<string, unknown>;
type World = FakeDbOptions & { tables: Record<string, Row[]>; rpc: NonNullable<FakeDbOptions["rpc"]> };

export const EV = {
  diwali: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001",
  garba: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1002",
  picnic: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1003",
  cancelled: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1004",
  missing: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c9999",
  rsvpShah: "8e100000-0000-4000-8000-000000000001",
  rsvpPatel: "8e100000-0000-4000-8000-000000000002",
  rsvpGuest: "8e100000-0000-4000-8000-000000000003",
  shiftFood: "8e200000-0000-4000-8000-000000000001",
  shiftOther: "8e200000-0000-4000-8000-000000000002",
  adult: "8e300000-0000-4000-8000-000000000001",
  minor: "8e300000-0000-4000-8000-000000000002",
  noDob: "8e300000-0000-4000-8000-000000000003",
  newEvent: "8e400000-0000-4000-8000-000000000001",
} as const;

const center_id = "center-1";

/** What the database returns for event_summary (counts only). */
export const SUMMARY_ANSWER = {
  event: { id: EV.diwali, name: "Diwali Dinner", status: "published", starts_at: "2026-10-24T23:30:00Z", capacity: 300, waitlist_enabled: true, lunch_enabled: false, is_paid: false },
  households: { rsvpd: 1, confirmed: 1, cancelled: 0, waitlisted: 0 },
  people: { households_total: 3, walk_in_households: 0, people_rsvpd: 6, people_confirmed: 2, people_waitlisted: 0, walk_in_people: 0, not_arrived: 6, checked_in: 0, served: 0, gifts_given: 0, children_under_12: 2, seniors: 0, needs_assistance: 0 },
  lunch: { enabled: false, slots: 0, slots_done: 0, seats: 0, unlimited_slots: 0, assigned: 0, served: 0 },
  volunteers: { visible: true, shifts: 2, spots_needed: 4, assigned: 0, shifts_empty: 2, shifts_open: 2 },
  checklist: { total: 4, done: 1, in_progress: 1, not_started: 2, overdue: 1 },
};

export const AUDIENCE_ANSWER = { event_id: EV.diwali, statuses: ["rsvpd", "confirmed"], households: 2, guest_rsvps: 1, people_visible: true, channels_visible: true, adults: 3, email: 2, sms: 1, whatsapp: 0, no_channel: 1 };

/** Add the Events pieces to a community from helpers.communityWithChildren(). Mutates and returns the world. */
export function addEventsWorld<W extends World>(world: W): W {
  const t = world.tables;
  // Every event gets the columns the builder keeps.
  for (const e of t.events) {
    e.program_year ??= null;
    e.attendee_flags ??= [];
    e.commitment_options ??= { per_person: [], lump_sum: [], open: false };
    e.lunch_enabled ??= false;
    e.lunch_starts_at ??= null;
    e.lunch_slot_minutes ??= 15;
    e.lunch_seats_per_slot ??= null;
    e.lunch_priority_rules ??= {};
    e.is_paid ??= false;
    e.member_price_cents ??= null;
    e.guest_price_cents ??= null;
    e.owner_person_id ??= null;
    e.confidential ??= false;
    e.flyer_path ??= null;
  }
  t.rsvps = [
    { id: EV.rsvpShah, center_id, event_id: EV.diwali, household_id: "hh-shah", guest_name: null, status: "rsvpd", source: "app", created_at: "2026-10-05T12:00:00Z" },
    { id: EV.rsvpPatel, center_id, event_id: EV.diwali, household_id: "hh-patel", guest_name: null, status: "confirmed", source: "app", created_at: "2026-10-04T12:00:00Z" },
    { id: EV.rsvpGuest, center_id, event_id: EV.diwali, household_id: null, guest_name: "Guest Booker", status: "rsvpd", source: "guest_web", created_at: "2026-10-06T12:00:00Z" },
  ];
  // The people on the RSVPs, children among them (the names a model must never see).
  t.attendees = [
    { id: "at-1", center_id, event_id: EV.diwali, rsvp_id: EV.rsvpShah, display_name: "Priya Shah", status: "rsvpd", checked_in_at: null },
    { id: "at-2", center_id, event_id: EV.diwali, rsvp_id: EV.rsvpShah, display_name: "Zoya Shah", status: "rsvpd", checked_in_at: null },
    { id: "at-3", center_id, event_id: EV.diwali, rsvp_id: EV.rsvpPatel, display_name: "Nikhil Patel", status: "confirmed", checked_in_at: "2026-10-24T23:40:00Z" },
    { id: "at-4", center_id, event_id: EV.diwali, rsvp_id: EV.rsvpPatel, display_name: "Aarav Patel", status: "confirmed", checked_in_at: null },
    { id: "at-5", center_id, event_id: EV.diwali, rsvp_id: EV.rsvpGuest, display_name: "Guest Booker", status: "rsvpd", checked_in_at: null },
    { id: "at-6", center_id, event_id: EV.diwali, rsvp_id: EV.rsvpGuest, display_name: "Tia Mehta", status: "cancelled", checked_in_at: null },
  ];
  t.volunteer_shifts = [
    { id: EV.shiftFood, center_id, event_id: EV.diwali, station: "food", starts_at: "2026-10-24T22:00:00Z", ends_at: "2026-10-25T01:00:00Z", capacity: 2 },
    { id: EV.shiftOther, center_id, event_id: EV.garba, station: "entry", starts_at: null, ends_at: null, capacity: null },
  ];
  t.volunteer_assignments = [];
  // A household of their own, so the people and the household cards the other command tests rely on stay as they are.
  t.households.push({ id: "hh-joshi", center_id, display_name: "Joshi, Meera & Dev", household_number: "H-1004", merged_into_id: null });
  t.people.push(
    { id: EV.adult, center_id, first_name: "Meera", last_name: "Joshi", preferred_name: null, date_of_birth: "1988-04-04", merged_into_id: null },
    { id: EV.minor, center_id, first_name: "Dev", last_name: "Joshi", preferred_name: null, date_of_birth: "2012-02-02", merged_into_id: null },
    { id: EV.noDob, center_id, first_name: "Unknown", last_name: "Person", preferred_name: null, date_of_birth: null, merged_into_id: null },
  );
  t.household_members.push(
    { household_id: "hh-joshi", person_id: EV.adult, center_id, role: "primary", is_primary: true, left_at: null },
    { household_id: "hh-joshi", person_id: EV.minor, center_id, role: "child", is_primary: false, left_at: null },
  );
  const baseCard = world.rpc.household_card as (a: Record<string, unknown>) => unknown;
  const joshi = { household_id: "hh-joshi", household_name: "Joshi, Meera & Dev", household_number: "H-1004", org_household_id: "2044", members: "Meera, Dev", primary_member: "Meera Joshi", primary_org_member_id: "0420", zone: "East", city: "Aurora", last_gift_on: null, open_pledge_cents: 0 };
  world.rpc.household_card = (a: Record<string, unknown>) => (a.p_household === "hh-joshi" ? [joshi] : baseCard(a));
  const known = [EV.diwali, EV.garba, EV.picnic, EV.cancelled] as string[];
  world.rpc.event_summary = (a: Record<string, unknown>) => (known.includes(String(a.p_event)) ? { ...SUMMARY_ANSWER, event: { ...SUMMARY_ANSWER.event, id: a.p_event } } : null);
  world.rpc.event_reminder_audience = (a: Record<string, unknown>) => (known.includes(String(a.p_event)) ? { ...AUDIENCE_ANSWER, event_id: a.p_event } : null);
  const rsvps: string[] = [EV.rsvpShah, EV.rsvpPatel, EV.rsvpGuest];
  world.rpc.event_set_rsvp_status = (a: Record<string, unknown>) => rsvps.includes(String(a.p_rsvp)) && a.p_event === EV.diwali;
  return world;
}

/** Make db.from(...).insert(rows) work in the fake: it records the rows and answers like the database (one new id). */
export function recordInserts(db: { from: (table: string) => unknown }, opts: { fail?: { code?: string; message: string } } = {}) {
  const inserts: { table: string; rows: Row | Row[] }[] = [];
  const original = db.from.bind(db);
  db.from = (table: string) => {
    const builder = original(table) as object;
    return new Proxy(builder, {
      get(target, prop, receiver) {
        if (prop !== "insert") return Reflect.get(target, prop, receiver);
        return (rows: Row | Row[]) => {
          const answer = opts.fail ? { data: null, error: opts.fail } : { data: null, error: null };
          if (!opts.fail) inserts.push({ table, rows });
          const withId = opts.fail ? answer : { data: { id: EV.newEvent }, error: null };
          const chain = {
            select: () => ({ single: () => Promise.resolve(withId), maybeSingle: () => Promise.resolve(withId), then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(opts.fail ? answer : { data: [{ id: EV.newEvent }], error: null }).then(res, rej) }),
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer).then(res, rej),
          };
          return chain;
        };
      },
    });
  };
  return inserts;
}
