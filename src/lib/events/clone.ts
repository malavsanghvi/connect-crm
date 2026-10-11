// Copy an earlier event as the starting point of a new one. Pure: the draft command events.clone_draft shows what would be copied and
// events.create_from_clone writes it as a DRAFT through the same insert the builder uses. Dates move with the new day: the start and
// end keep their times of day, and the RSVP window, the lunch start and the reminder keep the same distance (in days and time of day)
// from the start. People, RSVPs, volunteers, the checklist, the flyer, the survey and lessons learned are never copied.

import { addDays, daysBetween, isoToLocalDateTime } from "@/lib/dates";
import { fromDateTimeLocal } from "@/lib/events/format";

export type CloneSource = {
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
  lunch_priority_rules: unknown;
  is_paid: boolean;
  member_price_cents: number | null;
  guest_price_cents: number | null;
  owner_person_id: string | null;
  confidential: boolean;
};

/** The columns of the new event: the builder's own, and always a draft. */
export type PreparedEvent = CloneSource & { status: "draft" };

export type CloneResult =
  | { ok: true; prepared: PreparedEvent; copied: string[]; left_out: string[]; notes: string[] }
  | { ok: false; error: string };

/** Years in a name or program year move with the new date: "Diwali Dinner 2025" -> "Diwali Dinner 2026", "2025-26" -> "2026-27". */
export function moveYears(text: string, delta: number): string {
  if (delta === 0) return text;
  return text
    .replace(/\b(20\d{2})\b/g, (y) => String(Number(y) + delta))
    .replace(/(20\d{2})-(\d{2})\b/g, (_m, y: string, yy: string) => `${y}-${String((Number(yy) + delta) % 100).padStart(2, "0")}`);
}

export function prepareClone(source: CloneSource, opts: { newDay: string; name?: string | null; tz: string }): CloneResult {
  const { tz } = opts;
  if (!source.starts_at) return { ok: false, error: `${source.name} has no start date, so there is nothing to base the new dates on.` };
  const old = isoToLocalDateTime(source.starts_at, tz);
  const oldDay = old.slice(0, 10);
  const shift = (iso: string | null): string | null => {
    if (!iso) return null;
    const local = isoToLocalDateTime(iso, tz);
    if (!local) return null;
    return fromDateTimeLocal(`${addDays(opts.newDay, daysBetween(oldDay, local.slice(0, 10)))}T${local.slice(11, 16)}`, tz);
  };
  const starts = shift(source.starts_at);
  if (!starts) return { ok: false, error: "The new date could not be worked out. Use a day like 2026-11-08." };
  const yearDelta = Number(opts.newDay.slice(0, 4)) - Number(oldDay.slice(0, 4));
  const name = (opts.name ?? "").trim() || moveYears(source.name, yearDelta);
  const prepared: PreparedEvent = {
    name,
    description: source.description,
    venue: source.venue,
    starts_at: starts,
    ends_at: shift(source.ends_at),
    program_year: source.program_year ? moveYears(source.program_year, yearDelta) : null,
    capacity: source.capacity,
    waitlist_enabled: source.waitlist_enabled,
    audience: source.audience,
    rsvp_opens_at: shift(source.rsvp_opens_at),
    rsvp_closes_at: shift(source.rsvp_closes_at),
    confirmation_hours_before: source.confirmation_hours_before,
    attendee_flags: source.attendee_flags,
    commitment_options: source.commitment_options,
    lunch_enabled: source.lunch_enabled,
    lunch_starts_at: shift(source.lunch_starts_at),
    lunch_slot_minutes: source.lunch_slot_minutes,
    lunch_seats_per_slot: source.lunch_seats_per_slot,
    lunch_priority_rules: source.lunch_priority_rules,
    is_paid: source.is_paid,
    member_price_cents: source.member_price_cents,
    guest_price_cents: source.guest_price_cents,
    owner_person_id: source.owner_person_id,
    confidential: source.confidential,
    status: "draft",
  };
  const notes: string[] = [];
  if (name === source.name) notes.push("The new event has the same name as the one it was copied from. Give it its own name.");
  if (source.is_paid) notes.push("The prices were copied as they were. Check them for this year.");
  if (source.owner_person_id) notes.push("The same lead is named. Check they are free.");
  if (source.rsvp_opens_at || source.rsvp_closes_at) notes.push("The RSVP dates keep the same distance from the start as before. Check they still suit.");
  const copied = [
    "name" + (name !== source.name ? " (with the new year)" : ""),
    "description",
    "venue",
    "start and end times (on the new day)",
    "capacity and waitlist",
    "who can RSVP",
    "RSVP dates",
    "reminder timing",
    ...(source.lunch_enabled ? ["lunch settings"] : []),
    ...(source.is_paid ? ["prices"] : []),
  ];
  return { ok: true, prepared, copied, left_out: ["RSVPs and attendees", "volunteers and shifts", "the checklist", "the flyer", "the feedback survey", "lessons learned"], notes };
}
