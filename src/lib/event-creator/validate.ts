// Checking a draft before it is saved, with the builder's OWN rules: eventValues (src/lib/events/event-values.ts) runs on the
// very form saveEvent will receive, so the creator says exactly what the builder would say ("The event must end after it
// starts.") and the card that holds the field is the one that shows it.

import { eventValues } from "@/lib/events/event-values";
import { FormError } from "@/lib/events/form-fields";

import { placeOf } from "./fields";
import { toFormData } from "./mapping";
import type { CardId, CreatorCtx, EventDraft } from "./types";

/** Which field a message of eventValues is about (its label starts the sentence, or a rule names it). */
const MESSAGE_FIELD: [RegExp, string][] = [
  [/^Event name /, "name"],
  [/^Starts /, "starts_at"],
  [/^Ends /, "ends_at"],
  [/^The event must end after it starts/, "ends_at"],
  [/^RSVP opens /, "rsvp_opens_at"],
  [/^RSVP closes /, "rsvp_closes_at"],
  [/^RSVPs must close after they open/, "rsvp_closes_at"],
  [/^Lunch starts /, "lunch_starts_at"],
  [/^Set when lunch starts/, "lunch_starts_at"],
  [/^Capacity /, "capacity"],
  [/^Choose a valid audience/, "audience"],
  [/^Confirmation reminder /, "confirmation_hours_before"],
  [/^Per-person amounts/, "commit_per_person"],
  [/^Lump-sum amounts/, "commit_lump_sum"],
  [/^Donation commitment is on/, "commitments_enabled"],
  [/^Slot length /, "lunch_slot_minutes"],
  [/^Seats per slot /, "lunch_seats_per_slot"],
  [/^Member price /, "member_price"],
  [/^Guest price /, "guest_price"],
];

export type DraftProblem = { field: string | null; card: CardId; error: string };

export function fieldOfMessage(message: string): string | null {
  return MESSAGE_FIELD.find(([re]) => re.test(message))?.[1] ?? null;
}

/** The first problem saveEvent would report for this draft, and the card to show it on; null when it would save. */
export function validateDraft(draft: EventDraft, ctx: CreatorCtx): DraftProblem | null {
  try {
    eventValues(toFormData(draft), ctx.tz, ctx.rules, false);
  } catch (error) {
    if (!(error instanceof FormError)) throw error;
    const field = fieldOfMessage(error.message);
    const place = field ? placeOf(field, ctx) : null;
    const card: CardId = place && !place.startsWith("link:") && !place.startsWith("later:") ? (place as CardId) : "more";
    return { field, card, error: error.message };
  }
  return null;
}

/** Card 1 must give the draft a name and a start, so the saved draft has a date (the builder lets a draft go without one). */
export function whatProblem(draft: EventDraft): string | null {
  if (!draft.name.trim()) return "Event name is required.";
  if (!draft.starts_at.trim()) return "Choose when it starts, so the draft has a date.";
  return null;
}

/** The problem to show on one card when Continue is pressed (only the problems that belong to that card). */
export function cardProblem(card: CardId, draft: EventDraft, ctx: CreatorCtx): string | null {
  if (card === "what") {
    const own = whatProblem(draft);
    if (own) return own;
  }
  const p = validateDraft(draft, ctx);
  if (!p) return null;
  // Card 1 creates the row, so every rule must pass there; later cards only stop for their own fields.
  if (card === "what" || p.card === card) return p.error;
  return null;
}
