// Invented communities for the creator's golden tests and its dev preview (/dev/event-creator): a temple, a church, a chamber of
// commerce and a cycling club (no tradition, no calendar, nothing switched on but events). Names, places and numbers are made up.
// Today is fixed at 2026-10-11 so the suggestions are stable.

import type { CreatorCtx, EventDraft, HistoryEvent, HistoryShift } from "./types";
import { newDraft } from "./mapping";

export const FIXTURE_NOW = "2026-10-11T17:00:00Z";
export type FixtureKind = "temple" | "church" | "chamber" | "club";
export const FIXTURE_KINDS: FixtureKind[] = ["temple", "church", "chamber", "club"];

function ev(p: Partial<HistoryEvent> & Pick<HistoryEvent, "id" | "name" | "starts_at">): HistoryEvent {
  return {
    status: "completed",
    ends_at: null,
    venue: null,
    capacity: null,
    attended: null,
    is_paid: false,
    member_price_cents: null,
    guest_price_cents: null,
    audience: "members_and_guests",
    waitlist_enabled: true,
    lunch_enabled: false,
    lunch_slot_minutes: null,
    lunch_seats_per_slot: null,
    confirmation_hours_before: 0,
    commitments_used: false,
    lessons: [],
    ...p,
  };
}

const shift = (event_id: string, station: string, notes: string, capacity: number, from_start_minutes = -60, minutes = 240): HistoryShift => ({ event_id, station, notes, capacity, from_start_minutes, minutes });

const ALL_ON = { giving: true, volunteers: true, comms: true, surveys: true, calendar: true };

export function fixtureCtx(kind: FixtureKind): CreatorCtx {
  switch (kind) {
    case "temple":
      return {
        community: { name: "Lotus Valley Temple", kindKey: "hindu_temple", kindLabel: "Hindu temple", faithBased: true },
        school: "Sunday school",
        modules: ALL_ON,
        languages: ["en", "gu", "hi"],
        tz: "America/Chicago",
        currency: "USD",
        locale: "en-US",
        now: FIXTURE_NOW,
        rules: { lunch: { slot_minutes: 20 }, rsvp: { confirmation_hours_before: 24 } },
        templates: [{ id: "tpl-festival", name: "Festival dinner", description: "Checklist for a festival dinner: hall, kitchen, decorations, cleanup." }],
        history: {
          past: [
            ev({
              id: "t-diwali-25",
              name: "Diwali dinner and cultural program 2025",
              starts_at: "2025-11-09T00:00:00Z",
              ends_at: "2025-11-09T03:30:00Z",
              venue: "Main hall",
              capacity: 260,
              attended: 212,
              is_paid: true,
              member_price_cents: 1200,
              guest_price_cents: 1800,
              lunch_enabled: true,
              lunch_slot_minutes: 20,
              lunch_seats_per_slot: 60,
              confirmation_hours_before: 24,
              commitments_used: true,
              lessons: [
                "The food ran out at 7:30. Plan for 15% more.",
                "Parking was full by 6 pm; ask the school next door for its lot.",
                "Start the cultural program on time; families left before the end.",
              ],
            }),
            ev({ id: "t-garba-25", name: "Navratri garba night", starts_at: "2025-10-04T00:30:00Z", venue: "Main hall", capacity: 300, attended: 281, confirmation_hours_before: 24 }),
            ev({ id: "t-annual-25", name: "Sunday school annual day", starts_at: "2025-05-18T15:00:00Z", venue: "Community room", capacity: 80, attended: 64, audience: "pathshala_families" }),
          ],
          upcoming: [
            ev({ id: "t-garba-26", name: "Navratri garba night", status: "published", starts_at: "2026-10-17T00:30:00Z", venue: "Main hall" }),
            ev({ id: "t-bake-26", name: "Youth bake sale", status: "published", starts_at: "2026-11-07T16:00:00Z", venue: "Community room" }),
          ],
          shifts: [
            shift("t-diwali-25", "entry", "Welcome desk", 4, -30, 180),
            shift("t-diwali-25", "kitchen", "Kitchen", 8, -180, 330),
            shift("t-diwali-25", "food", "Serving line", 6, 60, 120),
            shift("t-diwali-25", "parking", "Parking", 3, -45, 150),
          ],
          calendar: [
            { title: "Sharad Purnima", starts_on: "2026-10-25", ends_on: null, layer: "Festivals" },
            { title: "Diwali", starts_on: "2026-11-08", ends_on: null, layer: "Festivals" },
          ],
          problems: [],
        },
      };
    case "church":
      return {
        community: { name: "Grace Fellowship Church", kindKey: "church", kindLabel: "Church", faithBased: true },
        school: "Sunday school",
        modules: ALL_ON,
        languages: ["en", "es"],
        tz: "America/New_York",
        currency: "USD",
        locale: "en-US",
        now: FIXTURE_NOW,
        rules: {},
        templates: [],
        history: {
          past: [
            ev({ id: "c-picnic-26", name: "Fall church picnic", starts_at: "2026-09-20T16:00:00Z", ends_at: "2026-09-20T20:00:00Z", venue: "Riverside Park pavilion", capacity: 150, attended: 118, lunch_enabled: true, lunch_slot_minutes: 30, confirmation_hours_before: 24 }),
            ev({ id: "c-easter-26", name: "Easter sunrise service", starts_at: "2026-04-05T10:30:00Z", venue: "Sanctuary", capacity: 400, attended: 210 }),
            ev({
              id: "c-xmas-25",
              name: "Christmas Eve candlelight service",
              starts_at: "2025-12-25T00:00:00Z",
              ends_at: "2025-12-25T01:30:00Z",
              venue: "Sanctuary",
              capacity: 400,
              attended: 366,
              confirmation_hours_before: 48,
              lessons: ["The 7 pm service filled by 6:40; open the fellowship hall as an overflow room.", "Candle lighting started late; brief the volunteers at 6:15."],
            }),
          ],
          upcoming: [ev({ id: "c-advent-26", name: "Advent choir concert", status: "published", starts_at: "2026-12-13T23:00:00Z", venue: "Sanctuary" })],
          shifts: [
            shift("c-xmas-25", "entry", "Greeters", 6, -45, 150),
            shift("c-xmas-25", "entry", "Ushers", 8, -30, 135),
            shift("c-xmas-25", "parking", "Parking and traffic", 4, -60, 120),
            shift("c-picnic-26", "food", "Grill team", 5, -60, 240),
          ],
          calendar: [
            { title: "Christmas Eve", starts_on: "2026-12-24", ends_on: null, layer: "Christian year" },
            { title: "Christmas Day", starts_on: "2026-12-25", ends_on: null, layer: "Christian year" },
          ],
          problems: [],
        },
      };
    case "chamber":
      return {
        community: { name: "Riverside Chamber of Commerce", kindKey: "chamber_of_commerce", kindLabel: "Chamber of commerce", faithBased: false },
        school: null,
        modules: { giving: false, volunteers: true, comms: true, surveys: true, calendar: true },
        languages: ["en"],
        tz: "America/Los_Angeles",
        currency: "USD",
        locale: "en-US",
        now: FIXTURE_NOW,
        rules: {},
        templates: [],
        history: {
          past: [
            ev({ id: "m-oct-26", name: "October member mixer", starts_at: "2026-10-09T00:30:00Z", ends_at: "2026-10-09T02:30:00Z", venue: "Chamber hall", capacity: 120, attended: 96, is_paid: true, member_price_cents: 2500, guest_price_cents: 4000, audience: "public", confirmation_hours_before: 24, lessons: ["Name badges ran out; print 20 extra.", "The ticket line was slow; open a second check-in table."] }),
            ev({ id: "m-sep-26", name: "September member mixer", starts_at: "2026-09-11T00:30:00Z", venue: "Partner rooftop", capacity: 80, attended: 74, is_paid: true, member_price_cents: 2500, guest_price_cents: 4000, audience: "public", confirmation_hours_before: 24 }),
            ev({ id: "m-aug-26", name: "August member mixer", starts_at: "2026-08-14T00:30:00Z", venue: "Chamber hall", capacity: 120, attended: 88, is_paid: true, member_price_cents: 2500, guest_price_cents: 4000, audience: "public", confirmation_hours_before: 24 }),
          ],
          upcoming: [ev({ id: "m-dinner-26", name: "County business dinner", status: "published", starts_at: "2026-11-20T02:00:00Z", venue: "Harbor hotel" })],
          shifts: [shift("m-oct-26", "entry", "Registration desk", 3, -30, 150), shift("m-oct-26", "entry", "Greeters", 4, -15, 120)],
          calendar: [
            { title: "Veterans Day", starts_on: "2026-11-11", ends_on: null, layer: "US holidays" },
            { title: "Thanksgiving", starts_on: "2026-11-26", ends_on: null, layer: "US holidays" },
          ],
          problems: [],
        },
      };
    case "club":
      return {
        community: { name: "Northside Cycling Club", kindKey: "club", kindLabel: "Club", faithBased: false },
        school: null,
        modules: { giving: false, volunteers: false, comms: false, surveys: false, calendar: false },
        languages: ["en"],
        tz: "Europe/London",
        currency: "GBP",
        locale: "en-GB",
        now: FIXTURE_NOW,
        rules: {},
        templates: [],
        history: {
          past: [
            ev({ id: "k-hill-26", name: "Autumn hill climb", starts_at: "2026-09-27T08:00:00Z", venue: "Ridge Lane car park", capacity: 60, attended: 41 }),
            ev({ id: "k-social-26", name: "Summer social ride", starts_at: "2026-07-05T08:30:00Z", venue: "Clubhouse", capacity: null, attended: 33 }),
            ev({ id: "k-sportive-26", name: "Spring sportive", starts_at: "2026-04-12T07:30:00Z", venue: "Clubhouse", capacity: 120, attended: 97 }),
          ],
          upcoming: [],
          shifts: [],
          calendar: [],
          problems: [],
        },
      };
  }
}

/** What the person has typed so far in each preview (the name on card 1, and a date picked from the suggestions). */
export const FIXTURE_NAMES: Record<FixtureKind, string> = {
  temple: "Diwali dinner and cultural program",
  church: "Christmas Eve candlelight service",
  chamber: "November member mixer",
  club: "Winter night ride",
};

/** A draft part-way through the creator, for the dev preview's screenshots. */
export function fixtureDraft(kind: FixtureKind, opts: { saved: boolean }): EventDraft {
  const ctx = fixtureCtx(kind);
  const d = newDraft(ctx);
  const base: Record<FixtureKind, Partial<EventDraft>> = {
    temple: { starts_at: "2026-11-08T18:00", ends_at: "2026-11-08T21:30", venue: "Main hall", capacity: "260", lunch_enabled: true, lunch_starts_at: "2026-11-08T19:00", lunch_slot_minutes: "20", lunch_seats_per_slot: "60", is_paid: true, member_price: "12", guest_price: "18", commitments_enabled: true, commit_per_person: "3, 5, 7", commit_lump_sum: "10, 25, 50", commit_open: true, description: "An evening of lights, music and a shared meal. All families are welcome." },
    church: { starts_at: "2026-12-24T19:00", ends_at: "2026-12-24T20:30", venue: "Sanctuary", capacity: "440", audience: "public", description: "Carols, readings and candlelight. Everyone is welcome." },
    chamber: { starts_at: "2026-11-12T17:30", ends_at: "2026-11-12T19:30", venue: "Chamber hall", capacity: "120", audience: "public" },
    club: { starts_at: "2026-12-05T18:00", venue: "Clubhouse" },
  };
  return { ...d, ...base[kind], name: FIXTURE_NAMES[kind], id: opts.saved ? `preview-${kind}` : null };
}
