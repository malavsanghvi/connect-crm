// PARITY: where every field and feature of the old event builder lives in the guided creator. The owner's rule (2026-10-11):
// "Ensure ALL features of the current event form are captured one way or another." tests/event-creator-parity.test.ts reads the
// old builder's fields FROM ITS SOURCE (the BuilderEvent type, the form names eventValues/saveEvent read, the builder's cards,
// the event page's tabs and every Events action) and fails when one is not registered here. A place is:
//   a card id ("what" … "review", "more" = More settings), shown in that card (or under More settings when the community's
//   rules skip that card: placeOf), or
//   "link:<href>" a link to the screen that already does it ([id] is the event's id), or
//   "later:<reason>" not in the creator yet, said so honestly on the screen.

import { asked } from "./questions";
import type { CardId, CreatorCtx, Place } from "./types";

/** The builder's event fields (BuilderEvent) and the form names saveEvent reads. */
export const FIELD_MAP: Record<string, Place> = {
  // BuilderEvent and the form, card by card
  id: "what", // the draft row is created when card 1 is answered, so everything after it has an event id
  // The creator's cards always save "draft" (saveEventDraftInPlace); a person publishes, now or at a chosen time, in the flyer
  // panel's publish box beside the cards (after approving the flyer), or on the event page.
  status: "link:/events/new?event=[id]#publish-box",
  intent: "link:/events/new?event=[id]#publish-box",
  name: "what",
  starts_at: "what",
  ends_at: "what",
  venue: "where",
  capacity: "where",
  waitlist_enabled: "where",
  audience: "who",
  attendee_flags: "who",
  commitment: "money",
  commitments_enabled: "money",
  commit_per_person: "money",
  commit_lump_sum: "money",
  commit_open: "money",
  is_paid: "money",
  member_price: "money",
  guest_price: "money",
  lunch_enabled: "help",
  lunch_starts_at: "help",
  lunch_slot_minutes: "help",
  lunch_seats_per_slot: "help",
  description: "words",
  // The flyer panel beside the cards (the slot) makes, approves and saves the flyer; the full flyer maker stays one link away in
  // it ("Open the full flyer maker": words by hand, photos, uploads, downloads).
  flyer_path: "link:/events/new?event=[id]#flyer-panel",
  flyer_source: "link:/events/new?event=[id]#flyer-panel",
  reminder_enabled: "sending",
  confirmation_hours_before: "sending",
  rsvp_opens_at: "more",
  rsvp_closes_at: "more",
  program_year: "more",
  confidential: "more",
  owner: "more",
  owner_person_id: "more",
};

/**
 * The builder's other features (its cards), the event page's tabs (what is set up after saving) and every Events Server
 * Action. Keys are prefixed by where they were read: card:<title>, tab:<key>, action:<name>.
 */
export const FEATURE_MAP: Record<string, Place> = {
  // The builder's cards (events/builder/page.tsx and event-builder.tsx)
  "card:Start from a template": "what",
  "card:Details and audience": "what",
  "card:Lunch slots": "help",
  "card:Preview with these settings": "help", // the slot engine's preview, beside the meal settings
  "card:Publish": "link:/events/new?event=[id]#publish-box", // the publish box beside the cards: publish now or schedule
  "card:More settings": "more",
  "card:Flyer maker": "link:/events/new?event=[id]#flyer-panel", // the flyer panel; it links to the full flyer maker
  // The event page's tabs (events/[id]/page.tsx): what is set up after saving
  "tab:details": "review", // "Open the event page"; custom fields (More details) live there
  "tab:checklist": "help", // checklist items are added on the Help card; lessons learned on the tab
  "tab:rsvps": "link:/events/[id]?tab=rsvps",
  "tab:volunteers": "help", // shifts are created on the Help card; assigning people and their event roles on the tab
  "tab:lunch": "help", // the meal slots are created on the Help card once the times are set
  "tab:survey": "link:/events/[id]?tab=survey",
  "tab:report": "link:/events/[id]?tab=report",
  // Every Server Action in events/actions.ts
  "action:saveEvent": "link:/events/builder?event=[id]", // the Advanced form; the creator uses saveEventDraftInPlace
  "action:saveEventDraftInPlace": "what",
  "action:createEventFromTemplate": "link:/events/builder", // the Advanced form; the creator uses createEventFromTemplateInPlace
  "action:createEventFromTemplateInPlace": "what",
  "action:setEventStatus": "link:/events/[id]",
  "action:setRsvpStatus": "link:/events/[id]?tab=rsvps",
  "action:addGuestRsvp": "link:/events/[id]?tab=rsvps",
  "action:createShift": "help",
  "action:deleteShift": "link:/events/[id]?tab=volunteers",
  "action:assignVolunteer": "link:/events/[id]?tab=volunteers",
  "action:setAssignment": "link:/events/[id]?tab=volunteers",
  "action:grantEventRole": "link:/events/[id]?tab=volunteers",
  "action:generateLunchSlots": "help",
  "action:setSlotStatus": "link:/events/[id]?tab=lunch",
  "action:updateSlotSeats": "link:/events/[id]?tab=lunch",
  "action:setChecklistState": "link:/events/[id]?tab=checklist",
  "action:addChecklistAction": "help",
  "action:addLesson": "link:/events/[id]?tab=checklist",
  "action:removeLesson": "link:/events/[id]?tab=checklist",
  "action:pushLessonsToTemplate": "link:/events/[id]?tab=checklist",
};

export function isCard(place: Place): place is CardId {
  return !place.startsWith("link:") && !place.startsWith("later:");
}

/** Where a field shows for this community: its card, or More settings when the community's rules skip that card. */
export function placeOf(field: string, ctx: CreatorCtx): Place | null {
  const place = FIELD_MAP[field];
  if (!place) return null;
  if (isCard(place) && !asked(place, ctx)) return "more";
  return place;
}

/** The fields a card shows for this community (More settings gathers those of skipped cards too). */
export function fieldsOn(card: CardId, ctx: CreatorCtx): string[] {
  return Object.keys(FIELD_MAP).filter((f) => placeOf(f, ctx) === card);
}

/** A link place with the event's id filled in. */
export function hrefOf(place: Place, eventId: string | null): string | null {
  if (!place.startsWith("link:")) return null;
  const href = place.slice(5);
  if (href.includes("[id]") && !eventId) return null;
  return href.replace("[id]", eventId ?? "");
}
