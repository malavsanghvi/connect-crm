// The guided event creator (/events/new, New look): its shared shapes. The creator asks a few cards beside a live preview of
// the event page and saves through the builder's own actions (saveEventDraftInPlace, createShift, generateLunchSlots,
// addChecklistAction). Pure types, no I/O.

/** The cards, in the order they are asked. "more" holds every other setting of the old builder; "review" ends it. */
export const CARD_IDS = ["what", "where", "who", "money", "help", "words", "sending", "more", "review"] as const;
export type CardId = (typeof CARD_IDS)[number];

export type PersonChoice = { id: string; name: string; detail: string | null };

/**
 * One event as the creator holds it: the builder's fields (BuilderEvent in events/builder/event-builder.tsx), written the way
 * the builder's inputs hold them (datetime-local text in the community's time zone, amounts as typed), so toFormData() sends
 * exactly what the builder's form sends.
 */
export type EventDraft = {
  id: string | null;
  status: string;
  name: string;
  description: string;
  venue: string;
  /** datetime-local values in the community's time zone */
  starts_at: string;
  ends_at: string;
  program_year: string;
  capacity: string;
  waitlist_enabled: boolean;
  audience: string;
  rsvp_opens_at: string;
  rsvp_closes_at: string;
  reminder_enabled: boolean;
  confirmation_hours_before: string;
  attendee_flags: string[];
  commitments_enabled: boolean;
  /** Dollar amounts as typed: "3, 5, 7" */
  commit_per_person: string;
  commit_lump_sum: string;
  commit_open: boolean;
  lunch_enabled: boolean;
  lunch_starts_at: string;
  lunch_slot_minutes: string;
  lunch_seats_per_slot: string;
  is_paid: boolean;
  member_price: string;
  guest_price: string;
  confidential: boolean;
  owner: PersonChoice | null;
  /** Set by the flyer panel's own actions, never by a save (read-only here). */
  flyer_path: string;
};

/** A past or upcoming event of this community, as counts and settings only (never who came). */
export type HistoryEvent = {
  id: string;
  name: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  venue: string | null;
  capacity: number | null;
  /** People checked in (a count), or null when not read. */
  attended: number | null;
  is_paid: boolean;
  member_price_cents: number | null;
  guest_price_cents: number | null;
  audience: string;
  waitlist_enabled: boolean;
  lunch_enabled: boolean;
  lunch_slot_minutes: number | null;
  lunch_seats_per_slot: number | null;
  confirmation_hours_before: number;
  commitments_used: boolean;
  /** The lessons written after it (text only). */
  lessons: string[];
};

/** A volunteer shift of a past event: what roles it needed and how many (no names). Times are minutes from the event's start. */
export type HistoryShift = { event_id: string; station: string; notes: string | null; capacity: number | null; from_start_minutes: number | null; minutes: number | null };

/** A day on one of the community's calendar layers (its festivals, holidays, school days, subscribed feeds). */
export type CalendarDay = { title: string; starts_on: string; ends_on: string | null; layer: string };

export type CreatorHistory = {
  /** Past events, newest first. */
  past: HistoryEvent[];
  /** Upcoming events (any status but cancelled), soonest first: for clashes. */
  upcoming: HistoryEvent[];
  shifts: HistoryShift[];
  calendar: CalendarDay[];
  /** Plain sentences for what could not be read (the creator still works; there are just fewer suggestions). */
  problems: string[];
};

export type CreatorModules = {
  giving: boolean;
  volunteers: boolean;
  comms: boolean;
  surveys: boolean;
  calendar: boolean;
};

/** Everything the creator's rules read about the community. Built on the server; plain data. */
export type CreatorCtx = {
  community: { name: string; kindKey: string; kindLabel: string; faithBased: boolean };
  /** The kind's word for its school ("Sunday school", "Pathshala"), or null when the kind has none. */
  school: string | null;
  modules: CreatorModules;
  /** Language codes, the community's main language first. */
  languages: string[];
  tz: string;
  currency: string;
  /** BCP-47 locale for dates and numbers. */
  locale: string;
  /** "now" as an ISO instant (passed in, so the rules are pure and testable). */
  now: string;
  rules: unknown;
  history: CreatorHistory;
  templates: { id: string; name: string; description: string | null }[];
};

/** A suggestion is always shown with where it came from and why; it is applied only when the person picks it. */
export type SuggestionSource = "history" | "calendar" | "rule";
export type Suggestion<T> = { value: T; label: string; why: string; source: SuggestionSource; best?: boolean };

export type Clash = { level: "warn" | "info"; text: string };

/** Where a builder field or feature lives in the creator (see fields.ts). */
export type Place = CardId | `link:${string}` | `later:${string}`;

/** What already hangs off a saved draft (read again after each change). Times are ISO instants. */
export type ExistingShift = { id: string; station: string; notes: string | null; capacity: number | null; starts_at: string | null; ends_at: string | null };
export type ExistingAction = { id: string; name: string; phase: string | null; due_on: string | null; state: string };
export type CreatorExisting = { shifts: ExistingShift[]; checklist: ExistingAction[]; lunchSlots: number; problems: string[] };

export const NO_EXISTING: CreatorExisting = { shifts: [], checklist: [], lunchSlots: 0, problems: [] };
