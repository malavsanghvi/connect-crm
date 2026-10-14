// The event builder's rules for one event's settings: what saveEvent (src/app/(app)/events/actions.ts) writes, read from the
// form exactly as the builder submits it. Pure (no server imports), so the guided event creator runs the SAME rules in the
// browser before it saves (src/lib/event-creator/validate.ts): one set of rules and one set of sentences, never a second
// validator that could drift.

import { all, bool, cents, centsList, dateTime, FormError, int, oneOf, reqStr, str } from "./form-fields";
import { AUDIENCES } from "./report";
import { lunchRulesFromCenter } from "./rules";

export const ATTENDEE_FLAGS = ["child_under_12", "senior", "assistance"] as const;

/** Donation commitment at RSVP. Switched on with nothing to offer is refused, not saved as Off (it reads back as Off). */
export function commitmentOptions(fd: FormData) {
  if (!bool(fd, "commitments_enabled")) return { per_person: [], lump_sum: [], open: false };
  const per_person = centsList(str(fd, "commit_per_person"), "Per-person amounts");
  const lump_sum = centsList(str(fd, "commit_lump_sum"), "Lump-sum amounts");
  const open = bool(fd, "commit_open");
  if (per_person.length + lump_sum.length === 0 && !open) {
    throw new FormError("Donation commitment is on but has no amounts. Enter per-person or lump-sum amounts (for example 3, 5, 7), allow an open amount, or turn it off.");
  }
  return { per_person, lump_sum, open };
}

export function eventValues(fd: FormData, tz: string, rules: unknown, publishing: boolean) {
  const startsAt = dateTime(fd, "starts_at", "Starts", tz);
  const endsAt = dateTime(fd, "ends_at", "Ends", tz);
  if (startsAt && endsAt && endsAt <= startsAt) throw new FormError("The event must end after it starts.");
  const rsvpOpens = dateTime(fd, "rsvp_opens_at", "RSVP opens", tz);
  const rsvpCloses = dateTime(fd, "rsvp_closes_at", "RSVP closes", tz);
  if (rsvpOpens && rsvpCloses && rsvpCloses <= rsvpOpens) throw new FormError("RSVPs must close after they open.");
  const lunchEnabled = bool(fd, "lunch_enabled");
  const lunchStarts = dateTime(fd, "lunch_starts_at", "Lunch starts", tz);
  // A draft may leave lunch time for later; a published event needs it.
  if (publishing && lunchEnabled && !lunchStarts) throw new FormError("Set when lunch starts, or turn lunch slots off.");
  const isPaid = bool(fd, "is_paid");
  const reminderOn = bool(fd, "reminder_enabled");
  const lunch = lunchRulesFromCenter(rules);
  return {
    name: reqStr(fd, "name", "Event name"),
    description: str(fd, "description"),
    // flyer_path/flyer_source/flyer_prompt are NOT touched here: they are owned by the
    // Flyer panel's own actions (events/builder/flyer-actions.ts), the same way a
    // leader's photo_path is set by uploadLeaderPhotoAction, never by saveLeaderAction.
    // Including flyer_path here (even as "unchanged") would null it out on every
    // unrelated save, since a removed form field reads as null via str().
    venue: str(fd, "venue"),
    starts_at: startsAt,
    ends_at: endsAt,
    program_year: str(fd, "program_year"),
    capacity: int(fd, "capacity", "Capacity", { min: 0 }),
    waitlist_enabled: bool(fd, "waitlist_enabled"),
    audience: oneOf(fd, "audience", AUDIENCES, "Audience", "members_and_guests"),
    rsvp_opens_at: rsvpOpens,
    rsvp_closes_at: rsvpCloses,
    // 0 = no confirmation reminder.
    confirmation_hours_before: reminderOn ? (int(fd, "confirmation_hours_before", "Confirmation reminder", { min: 1, max: 336 }) ?? 24) : 0,
    attendee_flags: all(fd, "attendee_flags").filter((f) => (ATTENDEE_FLAGS as readonly string[]).includes(f)),
    commitment_options: commitmentOptions(fd),
    lunch_enabled: lunchEnabled,
    lunch_starts_at: lunchStarts,
    lunch_slot_minutes: int(fd, "lunch_slot_minutes", "Slot length", { min: 5, max: 120 }) ?? 15,
    lunch_seats_per_slot: int(fd, "lunch_seats_per_slot", "Seats per slot", { min: 1 }),
    // Priority comes from Settings › Rules (read-only in the builder).
    lunch_priority_rules: { family_with_child_under_12_at_start: lunch.childAtStart, senior_at_start: lunch.seniorAtStart },
    is_paid: isPaid,
    member_price_cents: isPaid ? cents(fd, "member_price", "Member price") : null,
    guest_price_cents: isPaid ? cents(fd, "guest_price", "Guest price") : null,
    owner_person_id: str(fd, "owner_person_id"),
    confidential: bool(fd, "confidential"),
  };
}
