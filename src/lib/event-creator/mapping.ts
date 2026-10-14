// The creator's draft <-> the builder's form and the events row. toFormData() sends exactly the names and values the old
// builder's form sends (so saveEvent's rules read it the same way); fromEvent() reads a row the way the builder page does.

import { centsToDollarsInput, fromDateTimeLocal, toDateTimeLocal } from "@/lib/events/format";
import type { ReadinessEvent } from "@/lib/events/readiness";
import { commitmentEnabled, readCommitment } from "@/lib/events/report";
import { defaultConfirmationHours, defaultSlotMinutes } from "@/lib/events/rules";
import { parseDollarsToCents } from "@/lib/events/format";

import type { CreatorCtx, EventDraft, HistoryEvent, PersonChoice } from "./types";

/** "3, 5, 7" from cents, as the builder shows a commitment list. */
export function dollarsList(list: number[] | undefined): string {
  return (list ?? []).map((c) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2))).join(", ");
}

/**
 * A new event. The builder's defaults (everyone, waitlist on, its attendee questions, the community's reminder and slot length
 * from Settings > Rules), except two that the builder switched on for every kind: meals and the donation commitment start OFF,
 * and their cards offer them when a similar past event had them ("Serve a meal, like last time").
 */
export function newDraft(ctx: CreatorCtx): EventDraft {
  return {
    id: null,
    status: "draft",
    name: "",
    description: "",
    venue: "",
    starts_at: "",
    ends_at: "",
    program_year: "",
    capacity: "",
    waitlist_enabled: true,
    audience: "members_and_guests",
    rsvp_opens_at: "",
    rsvp_closes_at: "",
    reminder_enabled: true,
    confirmation_hours_before: String(defaultConfirmationHours(ctx.rules)),
    attendee_flags: ["child_under_12", "senior", "assistance"],
    commitments_enabled: false,
    commit_per_person: "",
    commit_lump_sum: "",
    commit_open: false,
    lunch_enabled: false,
    lunch_starts_at: "",
    lunch_slot_minutes: String(defaultSlotMinutes(ctx.rules)),
    lunch_seats_per_slot: "",
    is_paid: false,
    member_price: "",
    guest_price: "",
    confidential: false,
    owner: null,
    flyer_path: "",
  };
}

/** The columns of `events` the creator reads (select these). */
export const EVENT_COLUMNS =
  "id, status, name, description, venue, starts_at, ends_at, program_year, capacity, waitlist_enabled, audience, rsvp_opens_at, rsvp_closes_at, " +
  "confirmation_hours_before, attendee_flags, commitment_options, lunch_enabled, lunch_starts_at, lunch_slot_minutes, lunch_seats_per_slot, " +
  "is_paid, member_price_cents, guest_price_cents, confidential, owner_person_id, flyer_path";

export type EventRowLike = {
  id: string;
  status: string;
  name: string;
  description: string | null;
  venue: string | null;
  starts_at: string | null;
  ends_at: string | null;
  program_year: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  audience: string;
  rsvp_opens_at: string | null;
  rsvp_closes_at: string | null;
  confirmation_hours_before: number;
  attendee_flags: unknown;
  commitment_options: unknown;
  lunch_enabled: boolean;
  lunch_starts_at: string | null;
  lunch_slot_minutes: number;
  lunch_seats_per_slot: number | null;
  is_paid: boolean;
  member_price_cents: number | null;
  guest_price_cents: number | null;
  confidential: boolean;
  owner_person_id: string | null;
  flyer_path: string | null;
};

/** An events row as the creator's draft: the same reading as the builder page (events/builder/page.tsx). */
export function fromEvent(e: EventRowLike, tz: string, owner: PersonChoice | null = null): EventDraft {
  const commitment = readCommitment(e.commitment_options);
  const flags = Array.isArray(e.attendee_flags) ? e.attendee_flags.filter((f): f is string => typeof f === "string") : [];
  return {
    id: e.id,
    status: e.status,
    name: e.name,
    description: e.description ?? "",
    venue: e.venue ?? "",
    starts_at: toDateTimeLocal(e.starts_at, tz),
    ends_at: toDateTimeLocal(e.ends_at, tz),
    program_year: e.program_year ?? "",
    capacity: e.capacity === null ? "" : String(e.capacity),
    waitlist_enabled: e.waitlist_enabled,
    audience: e.audience,
    rsvp_opens_at: toDateTimeLocal(e.rsvp_opens_at, tz),
    rsvp_closes_at: toDateTimeLocal(e.rsvp_closes_at, tz),
    reminder_enabled: e.confirmation_hours_before > 0,
    confirmation_hours_before: String(e.confirmation_hours_before > 0 ? e.confirmation_hours_before : 24),
    attendee_flags: flags,
    commitments_enabled: commitmentEnabled(commitment),
    commit_per_person: dollarsList(commitment.per_person),
    commit_lump_sum: dollarsList(commitment.lump_sum),
    commit_open: commitment.open ?? true,
    lunch_enabled: e.lunch_enabled,
    lunch_starts_at: toDateTimeLocal(e.lunch_starts_at, tz),
    lunch_slot_minutes: String(e.lunch_slot_minutes),
    lunch_seats_per_slot: e.lunch_seats_per_slot === null ? "" : String(e.lunch_seats_per_slot),
    is_paid: e.is_paid,
    member_price: centsToDollarsInput(e.member_price_cents),
    guest_price: centsToDollarsInput(e.guest_price_cents),
    confidential: e.confidential,
    owner: e.owner_person_id ? (owner ?? { id: e.owner_person_id, name: "Event lead", detail: null }) : null,
    flyer_path: e.flyer_path ?? "",
  };
}

/**
 * The form the builder would submit for this draft, as name/value pairs: switches send "on" only when on (a Toggle with a
 * name), inputs the builder disables while their switch is off are not sent, and `intent` is always "draft".
 */
export function toEntries(d: EventDraft): [string, string][] {
  const out: [string, string][] = [];
  const put = (k: string, v: string) => out.push([k, v]);
  const on = (k: string, v: boolean) => {
    if (v) put(k, "on");
  };
  put("intent", "draft");
  put("name", d.name);
  put("starts_at", d.starts_at);
  put("ends_at", d.ends_at);
  put("venue", d.venue);
  put("audience", d.audience);
  put("capacity", d.capacity);
  on("waitlist_enabled", d.waitlist_enabled);
  on("commitments_enabled", d.commitments_enabled);
  on("reminder_enabled", d.reminder_enabled);
  on("lunch_enabled", d.lunch_enabled);
  put("lunch_starts_at", d.lunch_starts_at);
  put("lunch_slot_minutes", d.lunch_slot_minutes);
  put("lunch_seats_per_slot", d.lunch_seats_per_slot);
  put("rsvp_opens_at", d.rsvp_opens_at);
  put("rsvp_closes_at", d.rsvp_closes_at);
  if (d.reminder_enabled) put("confirmation_hours_before", d.confirmation_hours_before);
  for (const f of d.attendee_flags) put("attendee_flags", f);
  if (d.commitments_enabled) {
    put("commit_per_person", d.commit_per_person);
    put("commit_lump_sum", d.commit_lump_sum);
    on("commit_open", d.commit_open);
  }
  on("is_paid", d.is_paid);
  if (d.is_paid) {
    put("member_price", d.member_price);
    put("guest_price", d.guest_price);
  }
  put("program_year", d.program_year);
  if (d.owner) put("owner_person_id", d.owner.id);
  put("description", d.description);
  on("confidential", d.confidential);
  return out;
}

export function toFormData(d: EventDraft): FormData {
  const fd = new FormData();
  for (const [k, v] of toEntries(d)) fd.append(k, v);
  return fd;
}

/** The draft as eventReadiness (src/lib/events/readiness.ts) reads an event, for the live readiness list. */
export function toReadinessEvent(d: EventDraft, tz: string): ReadinessEvent {
  const cap = /^\d+$/.test(d.capacity.trim()) ? Number(d.capacity.trim()) : null;
  return {
    name: d.name.trim() || "This event",
    status: d.status,
    starts_at: fromDateTimeLocal(d.starts_at, tz),
    ends_at: fromDateTimeLocal(d.ends_at, tz),
    venue: d.venue.trim() || null,
    description: d.description.trim() || null,
    capacity: cap,
    rsvp_opens_at: fromDateTimeLocal(d.rsvp_opens_at, tz),
    rsvp_closes_at: fromDateTimeLocal(d.rsvp_closes_at, tz),
    lunch_enabled: d.lunch_enabled,
    lunch_starts_at: fromDateTimeLocal(d.lunch_starts_at, tz),
    is_paid: d.is_paid,
    member_price_cents: d.is_paid ? parseDollarsToCents(d.member_price) : null,
    guest_price_cents: d.is_paid ? parseDollarsToCents(d.guest_price) : null,
    audience: d.audience,
    owner_person_id: d.owner?.id ?? null,
    flyer_path: d.flyer_path || null,
  };
}

/**
 * "Start like <a past event>": its settings onto this draft (venue, capacity, who, waitlist, meals, reminder). The name and the
 * date stay the person's. Money is never copied: the Money card offers last time's prices with their reason, and the person
 * accepts them (money rule: a suggestion never sets a price silently).
 */
export function likePastEvent(d: EventDraft, past: HistoryEvent): EventDraft {
  return {
    ...d,
    venue: past.venue ?? d.venue,
    capacity: past.capacity === null ? d.capacity : String(past.capacity),
    audience: past.audience,
    waitlist_enabled: past.waitlist_enabled,
    lunch_enabled: past.lunch_enabled,
    lunch_slot_minutes: past.lunch_slot_minutes ? String(past.lunch_slot_minutes) : d.lunch_slot_minutes,
    lunch_seats_per_slot: past.lunch_seats_per_slot ? String(past.lunch_seats_per_slot) : d.lunch_seats_per_slot,
    reminder_enabled: past.confirmation_hours_before > 0,
    confirmation_hours_before: past.confirmation_hours_before > 0 ? String(past.confirmation_hours_before) : d.confirmation_hours_before,
  };
}
